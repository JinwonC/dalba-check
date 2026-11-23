"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getT } from "@/lib/lang";
import { getDeal, now, updateDeal, type Deal } from "@/lib/deals";
import { bridgeConfigured, callBridge } from "@/lib/bridge";
import { cleanUrl } from "@/lib/url-check";
import { appendRequestRow, sheetConfigured } from "@/lib/sheets";

// One request for several creators: one Drive folder, one row on the
// work-request sheet, and the same request recorded on every contract.

const MAX = 20;
export type BatchResult = { error: string } | { ok: true; sheet: "added" | "off" | "failed"; folder: string; count: number };

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());
const handles = (list: Deal[]) => list.map((d) => `@${d.fields.handle}`).join(", ");

async function load(ids: string[]): Promise<Deal[]> {
  const out: Deal[] = [];
  for (const id of [...new Set(ids.map(String))].slice(0, MAX)) {
    const deal = await getDeal(id);
    if (deal) out.push(deal);
  }
  return out;
}

async function addRow(row: { date: string; requester: string; kind: string; text: string; folder: string }): Promise<"added" | "off" | "failed"> {
  if (!sheetConfigured()) return "off";
  try {
    await appendRequestRow(row);
    return "added";
  } catch (e) {
    console.error("batch request sheet append failed", e);
    return "failed";
  }
}

/** Stamp request for several signed contracts at once. With no folder link, the signed PDFs go into one new Drive folder. */
export async function batchStampRequest(ids: string[], input: { text: string; folder: string }): Promise<BatchResult> {
  const user = await requireUser();
  const { t } = await getT();
  const text = String(input.text || "").trim().slice(0, 6000);
  if (!text) return { error: t("Enter the request text.") };
  const deals = await load(ids);
  if (deals.length < 2) return { error: t("Pick at least two agreements.") };
  const bad = deals.filter((d) => !d.signed_at || d.cancelled_at);
  if (bad.length) return { error: t("Not signed yet, or cancelled: {names}", { names: handles(bad) }) };

  let folder = String(input.folder || "").trim() ? cleanUrl(input.folder) : "";
  if (String(input.folder || "").trim() && !folder) return { error: t("The folder link must start with https://.") };
  if (!folder) {
    if (!bridgeConfigured()) return { error: t("Google Drive is not connected. Paste the folder link yourself.") };
    // Loaded only here so the page does not pull in the PDF engine.
    const { signedPdfBytes } = await import("@/lib/dealPdf");
    const { pdfFileName } = await import("@/lib/pdf");
    const title = text.split("\n")[0].replace(/[\\/]/g, "-").slice(0, 80);
    const folderName = `${now().slice(0, 10)} ${title} (${user.name})`;
    const used = new Set<string>();
    try {
      for (const deal of deals) {
        const pdf = await signedPdfBytes(deal);
        if (!pdf) return { error: t("Not signed yet, or cancelled: {names}", { names: `@${deal.fields.handle}` }) };
        let fileName = pdfFileName(deal.fields, "Signed");
        // Two contracts with the same creator must not overwrite each other.
        if (used.has(fileName)) fileName = fileName.replace(/\.pdf$/, `_${deal.id.slice(0, 6)}.pdf`);
        used.add(fileName);
        const res = await callBridge({ action: "upload", folderName, fileName, data: pdf.toString("base64"), subfolders: ["날인"] });
        folder = typeof res.url === "string" ? cleanUrl(res.url) : "";
        if (!folder) return { error: t("Google Drive did not return a folder link.") };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const sheet = await addRow({ date: now().slice(0, 10), requester: user.name, kind: "계약서 상신", text, folder });
  for (const deal of deals) {
    await updateDeal(deal.id, user.name, (d) => {
      d.folder = folder;
      d.stamp_requested_at ??= now();
      d.stamp_request = { text, sheet_at: sheet === "added" ? now() : d.stamp_request?.sheet_at };
      return { event: "stamp_requested", detail: `${folder} (with ${deals.length - 1} others)` };
    });
    revalidatePath(`/deals/${deal.id}`);
  }
  revalidatePath("/");
  return { ok: true, sheet, folder, count: deals.length };
}

/** Transfer (지출결의서) request for several contracts at once: same dates and folder on each, one sheet row. */
export async function batchPaymentRequest(ids: string[], input: { text: string; folder: string; requested: string; expected: string }): Promise<BatchResult> {
  const user = await requireUser();
  const { t } = await getT();
  const text = String(input.text || "").trim().slice(0, 6000);
  const req = String(input.requested || "").trim();
  const exp = String(input.expected || "").trim();
  const folder = cleanUrl(String(input.folder || ""));
  if (!text) return { error: t("Enter the request text.") };
  if (!isDate(req)) return { error: t("Enter the date the transfer was requested.") };
  if (!isDate(exp)) return { error: t("Enter the expected transfer date.") };
  if (exp < req) return { error: t("The expected date cannot be before the request date.") };
  if (!folder) return { error: t("Paste the folder link of the stamped agreement (starting with https://).") };
  const deals = await load(ids);
  if (deals.length < 2) return { error: t("Pick at least two agreements.") };
  const bad = deals.filter((d) => !d.content_done_at || d.paid_at || d.cancelled_at);
  if (bad.length) return { error: t("Content not confirmed yet, or already paid: {names}", { names: handles(bad) }) };

  const kind = "지출결의서 상신";
  const sheet = await addRow({ date: req, requester: user.name, kind, text, folder });
  for (const deal of deals) {
    await updateDeal(deal.id, user.name, (d) => {
      const first = !d.payment_requested_at;
      d.payment_requested_at = req;
      d.payment_expected = exp;
      d.request = { kind, purpose: d.request?.purpose ?? "", folder, text, sheet_at: sheet === "added" ? now() : d.request?.sheet_at };
      return { event: first ? "payment_requested" : "payment_date_changed", detail: `requested ${req}, expected ${exp} (with ${deals.length - 1} others)` };
    });
    revalidatePath(`/deals/${deal.id}`);
  }
  revalidatePath("/");
  return { ok: true, sheet, folder, count: deals.length };
}

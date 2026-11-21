"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getT } from "@/lib/lang";
import { getDeal, addVideo, createDeal, now, stampedKey, updateDeal, type Deal } from "@/lib/deals";
import { bridgeConfigured, callBridge } from "@/lib/bridge";
import { cleanUrl } from "@/lib/url-check";
import { REQUEST_KINDS, requestText } from "@/lib/request-text";
import { appendRequestRow, sheetConfigured } from "@/lib/sheets";
import { writeBytes } from "@/lib/store";
import { defaultFields, joinNames, liveFee, type Clause, type Fields, type Item } from "@/lib/template";

function cleanFields(input: Partial<Fields>): Fields {
  const d = defaultFields();
  const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const handle = str(input.handle, 80).replace(/^@+/, "");
  const items: Item[] = (Array.isArray(input.items) ? input.items : [])
    .slice(0, 20)
    .map((i) => ({ product: str(i?.product, 200), count: Math.min(200, Math.round(num(i?.count))) }))
    .filter((i) => i.product || i.count);
  const kind = input.kind === "live" ? "live" : "video";
  if (kind === "live") {
    const live: Fields = {
      ...d,
      kind,
      handle,
      talentName: str(input.talentName, 120) || handle,
      creatorEmail: str(input.creatorEmail, 200),
      country: str(input.country, 20) || d.country,
      startDate: str(input.startDate, 10),
      endDate: str(input.endDate, 10),
      effectiveDate: str(input.startDate, 10),
      liveSchedule: str(input.liveSchedule, 300),
      sessionLength: str(input.sessionLength, 200) || "Minimum 1 hour per session",
      hourlyRate: num(input.hourlyRate),
      hours: num(input.hours),
      items: [],
      deliverableCount: 0,
      deliverableType: "TikTok Live",
      product: "",
      paidUsageDays: 0,
      currency: (["USD", "GBP", "EUR"] as const).includes(input.currency as Fields["currency"]) ? (input.currency as Fields["currency"]) : "USD",
      fee: 0,
      commissionPct: num(input.commissionPct),
      invoiceDescription: "Livestream hourly service",
    };
    live.fee = liveFee(live);
    return live;
  }
  return {
    kind,
    handle,
    talentName: str(input.talentName, 120) || handle,
    creatorEmail: str(input.creatorEmail, 200),
    country: str(input.country, 20) || d.country,
    effectiveDate: str(input.effectiveDate, 10),
    startDate: str(input.startDate, 10),
    endDate: str(input.endDate, 10),
    items,
    deliverableCount: items.reduce((n, i) => n + i.count, 0),
    deliverableType: str(input.deliverableType, 120) || d.deliverableType,
    paidUsageDays: Math.round(num(input.paidUsageDays)),
    product: joinNames(items.map((i) => i.product)),
    currency: (["USD", "GBP", "EUR"] as const).includes(input.currency as Fields["currency"]) ? (input.currency as Fields["currency"]) : "USD",
    fee: num(input.fee),
    commissionPct: num(input.commissionPct),
    invoiceDescription: str(input.invoiceDescription, 200) || d.invoiceDescription,
  };
}

function cleanClauses(input: Clause[]): Clause[] {
  return (Array.isArray(input) ? input : [])
    .map((c) => ({
      id: String(c.id || "").slice(0, 60),
      title: String(c.title || "").trim().slice(0, 200),
      body: String(c.body || "").slice(0, 20000),
    }))
    .filter((c) => c.id && c.title && c.body.trim());
}

function missingForSend(f: Fields, clauses: Clause[]): string[] {
  const miss: string[] = [];
  if (f.kind === "live") {
    if (!f.handle) miss.push("TikTok handle");
    if (!f.startDate) miss.push("start date");
    if (!f.endDate) miss.push("end date");
    if (!(Number(f.hourlyRate) > 0)) miss.push("hourly rate");
    if (!(Number(f.hours) > 0)) miss.push("total hours");
    if (!clauses.length) miss.push("at least one clause");
    return miss;
  }
  if (!f.handle) miss.push("TikTok handle");
  if (!f.effectiveDate) miss.push("effective date");
  if (!f.startDate) miss.push("start date");
  if (!f.endDate) miss.push("end date");
  if (!f.items.length || f.items.some((i) => !i.product)) miss.push("product name");
  if (!f.items.length || f.items.some((i) => !i.count)) miss.push("number of videos per product");
  if (!(f.fee > 0)) miss.push("fee");
  if (!clauses.length) miss.push("at least one clause");
  return miss;
}

export type SaveResult = { error: string } | undefined;

/** Create or update a deal. With `send`, the creator link goes live. */
export async function saveDeal(id: string | null, rawFields: Partial<Fields>, rawClauses: Clause[], send: boolean): Promise<SaveResult> {
  const user = await requireUser();
  const fields = cleanFields(rawFields);
  const clauses = cleanClauses(rawClauses);
  const { t } = await getT();
  if (!fields.handle) return { error: t("Enter the creator's TikTok handle.") };
  if (send) {
    const miss = missingForSend(fields, clauses);
    if (miss.length) return { error: t("Before creating the link, fill in: {list}.", { list: miss.map((m) => t(m)).join(", ") }) };
  }

  let dealId = id;
  if (!dealId) {
    dealId = (await createDeal(user.name, user.email, fields, clauses, send)).id;
  } else {
    const res = await updateDeal(dealId, user.name, (d) => {
      if (d.signed_at) return { error: "This agreement is already signed and can no longer be edited." };
      if (d.cancelled_at) return { error: "This deal is cancelled." };
      const wasSent = !!d.sent_at;
      d.fields = fields;
      d.clauses = clauses;
      // Editing a live agreement resets "opened" so the creator re-reviews the new version.
      d.change_request = null;
      d.change_requested_at = null;
      d.viewed_at = null;
      if (send && !wasSent) d.sent_at = now();
      return { event: wasSent ? "revised" : send ? "link_created" : "edited" };
    });
    if ("error" in res) return { error: t(res.error) };
  }
  revalidatePath("/");
  redirect(`/deals/${dealId}`);
}

async function change(id: string, fn: (d: Deal) => { error: string } | { event: string; detail?: string }) {
  const user = await requireUser();
  const res = await updateDeal(id, user.name, fn);
  if ("error" in res) throw new Error(res.error);
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
}

export type FolderResult = { error: string } | { url: string };

/** Put the creator-signed PDF in the team Google Drive (one folder per contract) and return the folder link. */
export async function uploadSignedToDrive(id: string): Promise<FolderResult> {
  const user = await requireUser();
  const { t } = await getT();
  if (!bridgeConfigured()) return { error: t("Google Drive is not connected. Paste the folder link yourself.") };
  const deal = await getDeal(id);
  if (!deal) return { error: t("Deal not found.") };
  // Loaded only here so pages that share this file do not pull in the PDF engine.
  const { signedPdfBytes } = await import("@/lib/dealPdf");
  const { pdfFileName } = await import("@/lib/pdf");
  const pdf = await signedPdfBytes(deal);
  if (!pdf) return { error: t("The creator has not signed yet.") };
  try {
    const res = await callBridge({
      action: "upload",
      folderName: `@${deal.fields.handle} ${(deal.signed_at ?? "").slice(0, 10)} (${deal.id.slice(0, 6)})`,
      fileName: pdfFileName(deal.fields, "Signed"),
      data: pdf.toString("base64"),
    });
    const url = typeof res.url === "string" ? cleanUrl(res.url) : "";
    if (!url) return { error: t("Google Drive did not return a folder link.") };
    await updateDeal(id, user.name, (d) => {
      d.folder = url;
      return { event: "drive_uploaded", detail: url };
    });
    revalidatePath(`/deals/${id}`);
    return { url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: /unknown action/.test(msg) ? t("Google Drive is not connected. Paste the folder link yourself.") : msg };
  }
}

export type StampResult = { error: string } | { ok: true; sheet: "added" | "off" | "failed" | "kept" };

/** Request the company stamp: records the folder link and adds a "계약서 상신" row to the work-request sheet. */
export async function requestStamp(id: string, rawFolder: string): Promise<StampResult> {
  const user = await requireUser();
  const { t } = await getT();
  const folder = cleanUrl(rawFolder);
  if (!folder) return { error: t("Paste the folder link that holds the signed agreement (starting with https://).") };
  let text = "";
  let already = false;
  const res = await updateDeal(id, user.name, (d) => {
    if (!d.signed_at) return { error: "The creator has not signed yet." };
    text = `계약서 1건 날인 요청 @${d.fields.handle}`;
    already = !!d.stamp_request?.sheet_at;
    d.folder = folder;
    d.stamp_requested_at ??= now();
    d.stamp_request = { text, sheet_at: d.stamp_request?.sheet_at };
    return { event: "stamp_requested", detail: folder };
  });
  if ("error" in res) return { error: t(res.error) };

  let sheet: "added" | "off" | "failed" | "kept" = already ? "kept" : "off";
  if (!already && sheetConfigured()) {
    try {
      await appendRequestRow({ date: now().slice(0, 10), requester: user.name, kind: "계약서 상신", text, folder });
      await updateDeal(id, user.name, (d) => {
        if (d.stamp_request) d.stamp_request.sheet_at = now();
        return { event: "sheet_row_added" };
      });
      sheet = "added";
    } catch (e) {
      console.error("stamp request sheet append failed", e);
      sheet = "failed";
    }
  }
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true, sheet };
}

export async function markStamped(id: string) {
  await change(id, (d) => {
    if (!d.signed_at) return { error: "Not signed yet" };
    d.executed_at ??= now();
    return { event: "stamped" };
  });
}

export async function undoStamped(id: string) {
  await change(id, (d) => {
    if (d.content_done_at) return { error: "Content already confirmed" };
    d.executed_at = null;
    return { event: "stamped_undone" };
  });
}

export async function markContentDone(id: string) {
  await change(id, (d) => {
    if (!d.executed_at) return { error: "Mark the company stamp as received first" };
    d.content_done_at ??= now();
    return { event: "content_done" };
  });
}

export async function undoContentDone(id: string) {
  await change(id, (d) => {
    if (d.payment_requested_at) return { error: "Transfer already requested" };
    d.content_done_at = null;
    return { event: "content_done_undone" };
  });
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());

export type TransferInput = { requested: string; expected: string; purpose: string; folder: string; kind: string };
export type TransferResult = { error: string } | { ok: true; sheet: "added" | "off" | "failed" | "kept" };

/**
 * Record the transfer request: when it was requested, when it is expected, the
 * purpose and the folder link of the stamped copy. The first time, the same
 * information is added to the internal work-request sheet (if connected).
 */
export async function setPaymentRequest(id: string, input: TransferInput): Promise<TransferResult> {
  const user = await requireUser();
  const { t } = await getT();
  const req = String(input.requested || "").trim();
  const exp = String(input.expected || "").trim();
  const purpose = String(input.purpose || "").trim().slice(0, 500);
  const folder = String(input.folder || "").trim() ? cleanUrl(input.folder) : "";
  const kind = (REQUEST_KINDS as readonly string[]).includes(input.kind) ? input.kind : REQUEST_KINDS[0];
  if (!isDate(req)) return { error: t("Enter the date the transfer was requested.") };
  if (!isDate(exp)) return { error: t("Enter the expected transfer date.") };
  if (exp < req) return { error: t("The expected date cannot be before the request date.") };
  if (!purpose) return { error: t("Enter the purpose and expected effect.") };
  if (!folder) return { error: t("Paste the folder link of the stamped agreement (starting with https://).") };

  let text = "";
  let alreadyOnSheet = false;
  const res = await updateDeal(id, user.name, (d) => {
    if (!d.content_done_at) return { error: "Confirm the content is complete first." };
    if (d.paid_at) return { error: "This deal is already marked as paid." };
    const first = !d.payment_requested_at;
    text = requestText(d.fields, { purpose, expected: exp, videos: (d.videos ?? []).map((v) => v.url) });
    alreadyOnSheet = !!d.request?.sheet_at;
    d.payment_requested_at = req;
    d.payment_expected = exp;
    d.request = { kind, purpose, folder, text, sheet_at: d.request?.sheet_at };
    return { event: first ? "payment_requested" : "payment_date_changed", detail: `requested ${req}, expected ${exp}` };
  });
  if ("error" in res) return { error: t(res.error) };

  let sheet: "added" | "off" | "failed" | "kept" = alreadyOnSheet ? "kept" : "off";
  if (!alreadyOnSheet && sheetConfigured()) {
    try {
      await appendRequestRow({ date: req, requester: user.name, kind, text, folder });
      await updateDeal(id, user.name, (d) => {
        if (d.request) d.request.sheet_at = now();
        return { event: "sheet_row_added" };
      });
      sheet = "added";
    } catch (e) {
      console.error("work-request sheet append failed", e);
      sheet = "failed";
    }
  }
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true, sheet };
}

export async function clearPaymentRequest(id: string) {
  await change(id, (d) => {
    if (d.paid_at) return { error: "Already marked as paid" };
    d.payment_requested_at = null;
    d.payment_expected = null;
    // Keep the purpose and folder link so they do not have to be typed again.
    return { event: "payment_request_cleared" };
  });
}

export async function markPaid(id: string) {
  await change(id, (d) => {
    if (!d.payment_requested_at) return { error: "Transfer not requested yet" };
    d.paid_at ??= now();
    return { event: "paid" };
  });
}

export async function cancelDeal(id: string) {
  await change(id, (d) => {
    if (d.signed_at) return { error: "Signed agreements cannot be cancelled here" };
    d.cancelled_at = now();
    return { event: "cancelled" };
  });
}

export async function reassignToMe(id: string) {
  const user = await requireUser();
  await change(id, (d) => {
    d.manager = user.name;
    d.manager_email = user.email;
    return { event: "reassigned", detail: user.name };
  });
}

export type UploadResult = { error: string } | { ok: true };

/** Upload the company-stamped PDF that came back from the internal system. */
export async function uploadStamped(id: string, _prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  const file = formData.get("file");
  const { t } = await getT();
  if (!(file instanceof File) || file.size === 0) return { error: t("Choose the stamped PDF file.") };
  if (file.size > 4 * 1024 * 1024) return { error: t("File is larger than 4 MB. Compress the PDF and try again.") };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: t("That file is not a PDF.") };
  const name = file.name.slice(0, 200);
  // Check state first, store the file, then record it on the deal.
  const check = await updateDeal(id, user.name, (d) => (d.signed_at ? null : { error: "The creator has not signed yet." }));
  if ("error" in check) return { error: t(check.error) };
  await writeBytes(stampedKey(id), bytes, "application/pdf");
  const res = await updateDeal(id, user.name, (d) => {
    d.stamped_pdf_name = name;
    d.executed_at ??= now();
    return { event: "stamped_uploaded", detail: name };
  });
  if ("error" in res) return res;
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true };
}

type VideoResult = { error: string } | { ok: true };

/** Record a posted-video link on the creator's behalf (for links sent outside the site). */
export async function addVideoLink(id: string, item: number, rawUrl: string): Promise<VideoResult> {
  const user = await requireUser();
  const { t } = await getT();
  const url = cleanUrl(rawUrl);
  if (!url) return { error: t("Enter a full link starting with https://") };
  const res = await updateDeal(id, user.name, (d) => {
    if (!d.signed_at) return { error: "The creator has not signed yet." };
    const problem = addVideo(d, item, url, user.name);
    return problem ? { error: problem } : { event: "video_added", detail: url };
  });
  if ("error" in res) return { error: t(res.error) };
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true };
}

export async function removeVideoLink(id: string, videoId: string): Promise<VideoResult> {
  const user = await requireUser();
  const { t } = await getT();
  const res = await updateDeal(id, user.name, (d) => {
    const hit = (d.videos ?? []).find((v) => v.id === videoId);
    if (!hit) return { error: "Deal not found." };
    d.videos = (d.videos ?? []).filter((v) => v.id !== videoId);
    return { event: "video_removed", detail: hit.url };
  });
  if ("error" in res) return { error: t(res.error) };
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true };
}

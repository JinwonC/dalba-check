"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { createDeal, now, stampedKey, updateDeal, type Deal } from "@/lib/deals";
import { writeBytes } from "@/lib/store";
import { defaultFields, type Clause, type Fields } from "@/lib/template";

function cleanFields(input: Partial<Fields>): Fields {
  const d = defaultFields();
  const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const handle = str(input.handle, 80).replace(/^@+/, "");
  return {
    handle,
    talentName: str(input.talentName, 120) || handle,
    creatorEmail: str(input.creatorEmail, 200),
    country: str(input.country, 20) || d.country,
    effectiveDate: str(input.effectiveDate, 10),
    startDate: str(input.startDate, 10),
    endDate: str(input.endDate, 10),
    deliverableCount: Math.round(num(input.deliverableCount)),
    deliverableType: str(input.deliverableType, 120) || d.deliverableType,
    paidUsageDays: Math.round(num(input.paidUsageDays)),
    product: str(input.product, 300),
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
  if (!f.handle) miss.push("TikTok handle");
  if (!f.effectiveDate) miss.push("effective date");
  if (!f.startDate) miss.push("start date");
  if (!f.endDate) miss.push("end date");
  if (!f.product) miss.push("product");
  if (!f.deliverableCount) miss.push("number of deliverables");
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
  if (!fields.handle) return { error: "Enter the creator's TikTok handle." };
  if (send) {
    const miss = missingForSend(fields, clauses);
    if (miss.length) return { error: `Before creating the link, fill in: ${miss.join(", ")}.` };
  }

  let dealId = id;
  if (!dealId) {
    dealId = (await createDeal(user.name, fields, clauses, send)).id;
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
    if ("error" in res) return res;
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

/** Record when the transfer was requested internally and when it is expected to go out. */
export async function setPaymentRequest(id: string, requested: string, expected: string): Promise<{ error: string } | undefined> {
  const user = await requireUser();
  const req = String(requested || "").trim();
  const exp = String(expected || "").trim();
  if (!isDate(req)) return { error: "Enter the date the transfer was requested." };
  if (!isDate(exp)) return { error: "Enter the expected transfer date." };
  if (exp < req) return { error: "The expected date cannot be before the request date." };
  const res = await updateDeal(id, user.name, (d) => {
    if (!d.content_done_at) return { error: "Confirm the content is complete first." };
    if (d.paid_at) return { error: "This deal is already marked as paid." };
    const first = !d.payment_requested_at;
    d.payment_requested_at = req;
    d.payment_expected = exp;
    return { event: first ? "payment_requested" : "payment_date_changed", detail: `requested ${req}, expected ${exp}` };
  });
  if ("error" in res) return res;
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
}

export async function clearPaymentRequest(id: string) {
  await change(id, (d) => {
    if (d.paid_at) return { error: "Already marked as paid" };
    d.payment_requested_at = null;
    d.payment_expected = null;
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
    return { event: "reassigned", detail: user.name };
  });
}

export type UploadResult = { error: string } | { ok: true };

/** Upload the company-stamped PDF that came back from the internal system. */
export async function uploadStamped(id: string, _prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the stamped PDF file." };
  if (file.size > 4 * 1024 * 1024) return { error: "File is larger than 4 MB. Compress the PDF and try again." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "That file is not a PDF." };
  const name = file.name.slice(0, 200);
  // Check state first, store the file, then record it on the deal.
  const check = await updateDeal(id, user.name, (d) => (d.signed_at ? null : { error: "The creator has not signed yet." }));
  if ("error" in check) return check;
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

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { q } from "@/lib/db";
import { newToken } from "@/lib/crypto";
import { getDeal, logEvent } from "@/lib/deals";
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
    const rows = await q<{ id: string }>(
      `insert into deals (token, manager_email, manager_name, fields, clauses, sent_at)
       values ($1, $2, $3, $4, $5, ${send ? "now()" : "null"}) returning id`,
      [newToken(), user.email, user.name, JSON.stringify(fields), JSON.stringify(clauses)],
    );
    dealId = rows[0].id;
    await logEvent(dealId, user.email, "created");
    if (send) await logEvent(dealId, user.email, "link_created");
  } else {
    const deal = await getDeal(dealId);
    if (!deal) return { error: "Deal not found." };
    if (deal.signed_at) return { error: "This agreement is already signed and can no longer be edited." };
    if (deal.cancelled_at) return { error: "This deal is cancelled." };
    const wasSent = !!deal.sent_at;
    // Editing a live agreement resets "opened" so the creator re-reviews the new version.
    await q(
      `update deals set fields = $2, clauses = $3, updated_at = now(),
         change_request = null, change_requested_at = null,
         viewed_at = null,
         sent_at = case when $4::boolean then coalesce(sent_at, now()) else sent_at end
       where id = $1`,
      [dealId, JSON.stringify(fields), JSON.stringify(clauses), send],
    );
    await logEvent(dealId, user.email, wasSent ? "revised" : "edited");
    if (send && !wasSent) await logEvent(dealId, user.email, "link_created");
  }
  revalidatePath("/");
  redirect(`/deals/${dealId}`);
}

async function mutate(id: string, sql: string, event: string, guard: (d: NonNullable<Awaited<ReturnType<typeof getDeal>>>) => string | null) {
  const user = await requireUser();
  const deal = await getDeal(id);
  if (!deal) throw new Error("Deal not found");
  const problem = guard(deal);
  if (problem) throw new Error(problem);
  await q(`update deals set ${sql}, updated_at = now() where id = $1`, [id]);
  await logEvent(id, user.email, event);
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
}

export async function markStampRequested(id: string) {
  await mutate(id, "stamp_requested_at = now()", "stamp_requested", (d) => (d.signed_at ? null : "Not signed yet"));
}

export async function markContentDone(id: string) {
  await mutate(id, "content_done_at = now()", "invoice_issued", (d) =>
    !d.signed_at ? "Not signed yet" : d.content_done_at ? "Invoice already issued" : null,
  );
}

export async function markPaid(id: string) {
  await mutate(id, "paid_at = now()", "paid", (d) => (d.content_done_at ? null : "Invoice not issued yet"));
}

export async function cancelDeal(id: string) {
  await mutate(id, "cancelled_at = now()", "cancelled", (d) => (d.signed_at ? "Signed agreements cannot be cancelled here" : null));
}

export async function reassignToMe(id: string) {
  const user = await requireUser();
  await q(`update deals set manager_email = $2, manager_name = $3, updated_at = now() where id = $1`, [id, user.email, user.name]);
  await logEvent(id, user.email, "reassigned", user.email);
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
}

export type UploadResult = { error: string } | { ok: true };

/** Upload the company-stamped PDF that came back from the internal system. */
export async function uploadStamped(id: string, _prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  const deal = await getDeal(id);
  if (!deal) return { error: "Deal not found." };
  if (!deal.signed_at) return { error: "The creator has not signed yet." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the stamped PDF file." };
  if (file.size > 4 * 1024 * 1024) return { error: "File is larger than 4 MB. Compress the PDF and try again." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "That file is not a PDF." };
  await q(
    `update deals set stamped_pdf = $2, stamped_pdf_name = $3, executed_at = now(),
       stamp_requested_at = coalesce(stamp_requested_at, now()), updated_at = now() where id = $1`,
    [id, bytes, file.name.slice(0, 200)],
  );
  await logEvent(id, user.email, "stamped_uploaded", file.name.slice(0, 200));
  revalidatePath("/");
  revalidatePath(`/deals/${id}`);
  return { ok: true };
}

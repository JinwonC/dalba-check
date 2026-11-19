import { q } from "./db";
import { decryptJson } from "./crypto";
import type { Billing, Clause, Fields, Signature } from "./template";

export type Deal = {
  id: string;
  token: string;
  manager_email: string;
  manager_name: string | null;
  fields: Fields;
  clauses: Clause[];
  billing_enc: string | null;
  signature: Signature | null;
  invoice_number: string | null;
  change_request: string | null;
  change_requested_at: Date | null;
  stamped_pdf_name: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  viewed_at: Date | null;
  signed_at: Date | null;
  stamp_requested_at: Date | null;
  executed_at: Date | null;
  content_done_at: Date | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
};

// Everything except the uploaded PDF bytes.
const COLS = `id, token, manager_email, manager_name, fields, clauses, billing_enc, signature,
  invoice_number, change_request, change_requested_at, stamped_pdf_name, created_at, updated_at,
  sent_at, viewed_at, signed_at, stamp_requested_at, executed_at, content_done_at, paid_at, cancelled_at`;

export async function listDeals(): Promise<Deal[]> {
  return q<Deal>(`select ${COLS} from deals order by created_at desc`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getDeal(id: string): Promise<Deal | null> {
  if (!UUID.test(id)) return null;
  const rows = await q<Deal>(`select ${COLS} from deals where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getDealByToken(token: string): Promise<Deal | null> {
  const rows = await q<Deal>(`select ${COLS} from deals where token = $1`, [token]);
  return rows[0] ?? null;
}

export function billingOf(deal: Deal): Billing | null {
  return deal.billing_enc ? decryptJson<Billing>(deal.billing_enc) : null;
}

export async function logEvent(dealId: string, actor: string, type: string, detail?: string) {
  await q(`insert into deal_events (deal_id, actor, type, detail) values ($1, $2, $3, $4)`, [dealId, actor, type, detail ?? null]);
}

export type DealEvent = { id: string; at: Date; actor: string; type: string; detail: string | null };

export async function listEvents(dealId: string): Promise<DealEvent[]> {
  return q<DealEvent>(`select id, at, actor, type, detail from deal_events where deal_id = $1 order by at desc, id desc`, [dealId]);
}

// ---- Status -----------------------------------------------------------------

export type ContractStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "changes"
  | "stamp_needed"
  | "stamp_requested"
  | "executed"
  | "cancelled";

export type InvoiceStatus = "none" | "prepared" | "issued" | "paid";

export function contractStatus(d: Deal): ContractStatus {
  if (d.cancelled_at) return "cancelled";
  if (d.executed_at) return "executed";
  if (d.signed_at) return d.stamp_requested_at ? "stamp_requested" : "stamp_needed";
  if (d.change_requested_at) return "changes";
  if (d.viewed_at) return "viewed";
  if (d.sent_at) return "sent";
  return "draft";
}

export function invoiceStatus(d: Deal): InvoiceStatus {
  if (d.paid_at) return "paid";
  if (d.content_done_at) return "issued";
  if (d.signed_at) return "prepared";
  return "none";
}

export const CONTRACT_LABEL: Record<ContractStatus, string> = {
  draft: "Draft",
  sent: "Sent, not opened",
  viewed: "Opened, not signed",
  changes: "Changes requested",
  stamp_needed: "Signed · stamp needed",
  stamp_requested: "Signed · stamp requested",
  executed: "Executed",
  cancelled: "Cancelled",
};

export const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  none: "—",
  prepared: "Ready · content in progress",
  issued: "Issued · awaiting payment",
  paid: "Paid",
};

/** Who has to act next. Drives the dashboard queues. */
export type Queue = "creator" | "us" | "payment" | "done" | "draft";

export function queueOf(d: Deal): Queue {
  const c = contractStatus(d);
  if (c === "cancelled") return "done";
  if (c === "draft") return "draft";
  if (c === "sent" || c === "viewed") return "creator";
  if (c === "changes" || c === "stamp_needed" || c === "stamp_requested") return "us";
  const i = invoiceStatus(d);
  if (i === "prepared") return "us";
  if (i === "issued") return "payment";
  return "done";
}

/** When the deal entered its current state, for "waiting N days". */
export function waitingSince(d: Deal): Date {
  const candidates = [
    d.paid_at,
    d.content_done_at,
    d.executed_at,
    d.stamp_requested_at,
    d.signed_at,
    d.change_requested_at,
    d.viewed_at,
    d.sent_at,
    d.created_at,
  ].filter(Boolean) as Date[];
  return new Date(Math.max(...candidates.map((x) => new Date(x).getTime())));
}

export function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

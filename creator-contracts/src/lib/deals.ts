import crypto from "node:crypto";
import { decryptJson } from "./crypto";
import { mutate, readText } from "./store";
import { customCount, type Billing, type Clause, type Fields, type Signature } from "./template";

// Storage layout (private store):
//   deals/<id>.json   full deal document, including its activity log
//   index.json        one summary row per deal, for the dashboard
//   stamped/<id>.pdf  company-stamped final PDF

export type Stamps = {
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  stamp_requested_at: string | null;
  executed_at: string | null;
  content_done_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  change_requested_at: string | null;
};

export type DealEvent = { at: string; actor: string; type: string; detail?: string };

export type Deal = Stamps & {
  id: string;
  secret: string; // second half of the creator link
  manager: string;
  fields: Fields;
  clauses: Clause[];
  billing_enc: string | null;
  signature: Signature | null;
  invoice_number: string | null;
  change_request: string | null;
  stamped_pdf_name: string | null;
  events: DealEvent[];
};

/** Dashboard row: everything except the long or sensitive parts. */
export type Summary = Stamps & {
  id: string;
  secret: string;
  manager: string;
  fields: Fields;
  custom: number;
};

const ID = /^[A-Za-z0-9_-]{16}$/;
const dealKey = (id: string) => `deals/${id}.json`;
export const stampedKey = (id: string) => `stamped/${id}.pdf`;
const INDEX = "index.json";

export const now = () => new Date().toISOString();
export const linkToken = (d: { id: string; secret: string }) => `${d.id}.${d.secret}`;

function summarize(d: Deal): Summary {
  const { clauses, billing_enc, signature, invoice_number, change_request, stamped_pdf_name, events, ...rest } = d;
  void billing_enc, signature, invoice_number, change_request, stamped_pdf_name, events;
  return { ...rest, custom: customCount(clauses) };
}

async function reindex(d: Deal) {
  await mutate<Summary[]>(INDEX, (list) => [summarize(d), ...(list ?? []).filter((x) => x.id !== d.id)]);
}

export async function listDeals(): Promise<Summary[]> {
  const entry = await readText(INDEX);
  const list = entry ? (JSON.parse(entry.text) as Summary[]) : [];
  return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDeal(id: string): Promise<Deal | null> {
  if (!ID.test(id)) return null;
  const entry = await readText(dealKey(id));
  return entry ? (JSON.parse(entry.text) as Deal) : null;
}

/** Resolve a creator link token ("<id>.<secret>"). */
export async function getDealByToken(token: string): Promise<Deal | null> {
  const [id, secret] = String(token).split(".");
  if (!id || !secret) return null;
  const deal = await getDeal(id);
  if (!deal) return null;
  const a = crypto.createHash("sha256").update(secret).digest();
  const b = crypto.createHash("sha256").update(deal.secret).digest();
  return crypto.timingSafeEqual(a, b) ? deal : null;
}

export async function createDeal(manager: string, fields: Fields, clauses: Clause[], send: boolean): Promise<Deal> {
  const t = now();
  const deal: Deal = {
    id: crypto.randomBytes(12).toString("base64url"),
    secret: crypto.randomBytes(18).toString("base64url"),
    manager,
    fields,
    clauses,
    billing_enc: null,
    signature: null,
    invoice_number: null,
    change_request: null,
    stamped_pdf_name: null,
    created_at: t,
    updated_at: t,
    sent_at: send ? t : null,
    viewed_at: null,
    signed_at: null,
    stamp_requested_at: null,
    executed_at: null,
    content_done_at: null,
    paid_at: null,
    cancelled_at: null,
    change_requested_at: null,
    events: [{ at: t, actor: manager, type: "created" }, ...(send ? [{ at: t, actor: manager, type: "link_created" }] : [])],
  };
  await mutate<Deal>(dealKey(deal.id), () => deal);
  await reindex(deal);
  return deal;
}

/**
 * Apply a change to a deal. `fn` mutates the deal in place and returns an
 * error message to abort, or the event to log.
 */
export async function updateDeal(
  id: string,
  actor: string,
  fn: (d: Deal) => { error: string } | { event: string; detail?: string } | null,
): Promise<{ deal: Deal } | { error: string }> {
  if (!ID.test(id)) return { error: "Deal not found." };
  const res = await mutate<Deal>(dealKey(id), (cur) => {
    if (!cur) return { error: "Deal not found." };
    const out = fn(cur);
    if (out && "error" in out) return out;
    const t = now();
    cur.updated_at = t;
    if (out) cur.events.push({ at: t, actor, type: out.event, ...(out.detail ? { detail: out.detail } : {}) });
    return cur;
  });
  if ("error" in res) return res;
  await reindex(res.value);
  return { deal: res.value };
}

export function billingOf(deal: Deal): Billing | null {
  return deal.billing_enc ? decryptJson<Billing>(deal.billing_enc) : null;
}

// ---- Status -----------------------------------------------------------------

export type ContractStatus = "draft" | "sent" | "viewed" | "changes" | "stamp_needed" | "stamp_requested" | "executed" | "cancelled";
export type InvoiceStatus = "none" | "prepared" | "issued" | "paid";

export function contractStatus(d: Stamps): ContractStatus {
  if (d.cancelled_at) return "cancelled";
  if (d.executed_at) return "executed";
  if (d.signed_at) return d.stamp_requested_at ? "stamp_requested" : "stamp_needed";
  if (d.change_requested_at) return "changes";
  if (d.viewed_at) return "viewed";
  if (d.sent_at) return "sent";
  return "draft";
}

export function invoiceStatus(d: Stamps): InvoiceStatus {
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

/** True when nothing more needs to happen on the deal. */
export function isDone(d: Stamps): boolean {
  return !!d.cancelled_at || (!!d.executed_at && !!d.paid_at);
}

/** When the deal entered its current state, for "waiting N days". */
export function waitingSince(d: Stamps): string {
  const all = [d.paid_at, d.content_done_at, d.executed_at, d.stamp_requested_at, d.signed_at, d.change_requested_at, d.viewed_at, d.sent_at, d.created_at];
  return (all.filter(Boolean) as string[]).sort().pop()!;
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

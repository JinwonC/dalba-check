import crypto from "node:crypto";
import { decryptJson } from "./crypto";
import { listKeys, mutate, readText, remove } from "./store";
import { customCount, itemsOf, type Billing, type Clause, type Fields, type Signature } from "./template";

// Storage layout (private store):
//   deals/<id>.json   full deal document, including its activity log
//   stamped/<id>.pdf  company-stamped final PDF

export type Stamps = {
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  stamp_requested_at: string | null;
  executed_at: string | null;
  content_done_at: string | null; // creator fulfilled the deliverables
  payment_requested_at: string | null;
  payment_expected: string | null; // yyyy-mm-dd, the expected transfer date
  paid_at: string | null;
  cancelled_at: string | null;
  change_requested_at: string | null;
};

// ---- Video links -------------------------------------------------------------
// After signing, the creator pastes the link of each posted video so we can see
// how many of the contracted videos are still to come. No approval step.

export type Video = { id: string; item: number; url: string; at: string; by: string };
export type VideoGroup = { item: number; product: string; count: number; videos: Video[] };

export function videoGroups(d: { fields: Fields; videos?: Video[] }): VideoGroup[] {
  const all = Array.isArray(d.videos) ? d.videos : [];
  return itemsOf(d.fields).map((it, i) => ({ item: i, product: it.product, count: it.count, videos: all.filter((v) => v.item === i) }));
}

export function videoProgress(d: { fields: Fields; videos?: Video[] }): { done: number; total: number } {
  const groups = videoGroups(d);
  return { done: groups.reduce((n, g) => n + Math.min(g.videos.length, g.count), 0), total: groups.reduce((n, g) => n + g.count, 0) };
}

/** Add a posted-video link to a deal document (mutates). Returns an error message or null. */
export function addVideo(d: Deal, item: number, url: string, by: string): string | null {
  const group = videoGroups(d).find((g) => g.item === item);
  if (!group) return "Product not found.";
  if (group.videos.length >= group.count) return "All videos for this product are already submitted.";
  const all = Array.isArray(d.videos) ? d.videos : [];
  if (all.some((v) => v.url === url)) return "This link was already submitted.";
  d.videos = [...all, { id: crypto.randomBytes(6).toString("base64url"), item, url, at: now(), by }];
  return null;
}

export type DealEvent = { at: string; actor: string; type: string; detail?: string };

export type Deal = Stamps & {
  id: string;
  secret: string; // second half of the creator link
  manager: string;
  manager_email?: string;
  /** What was sent to the internal work-request sheet for the transfer. */
  request?: { kind: string; purpose: string; folder: string; text: string; sheet_at?: string };
  /** Drive folder holding the creator-signed PDF; finance adds the stamped copy to the same folder. */
  folder?: string;
  /** The stamp request sent to the work-request sheet. */
  stamp_request?: { text: string; sheet_at?: string };
  fields: Fields;
  clauses: Clause[];
  billing_enc: string | null;
  signature: Signature | null;
  invoice_number: string | null;
  change_request: string | null;
  stamped_pdf_name: string | null;
  videos?: Video[];
  events: DealEvent[];
};

/** Dashboard row: everything except the long or sensitive parts. */
export type Summary = Stamps & {
  id: string;
  secret: string;
  manager: string;
  manager_email?: string;
  fields: Fields;
  custom: number;
  vp: { done: number; total: number };
};

const ID = /^[A-Za-z0-9_-]{16}$/;
const dealKey = (id: string) => `deals/${id}.json`;
export const stampedKey = (id: string) => `stamped/${id}.pdf`;

export const now = () => new Date().toISOString();
export const linkToken = (d: { id: string; secret: string }) => `${d.id}.${d.secret}`;

function summarize(d: Deal): Summary {
  const { clauses, billing_enc, signature, invoice_number, change_request, stamped_pdf_name, events, videos, ...rest } = d;
  void billing_enc, signature, invoice_number, change_request, stamped_pdf_name, events, videos;
  return { ...rest, custom: customCount(clauses, d.fields.kind), vp: videoProgress(d) };
}

// Dashboard cache, per server instance: a deal is re-read only when the
// store reports a new version of its document.
const g = globalThis as unknown as { __deals?: Map<string, { version: string; summary: Summary }>; __fresh?: Map<string, Summary>; __gone?: Set<string> };
const cache = (g.__deals ??= new Map());
// Deals this instance just wrote, in case the listing lags behind the write.
const fresh = (g.__fresh ??= new Map());

// Deals this instance just deleted, in case the listing still shows them for a moment.
const gone = (g.__gone ??= new Set<string>());

function remember(d: Deal) {
  fresh.set(d.id, summarize(d));
}

export async function listDeals(): Promise<Summary[]> {
  const keys = await listKeys("deals/");
  const todo = keys.filter((k) => cache.get(k.key)?.version !== k.version);
  for (let i = 0; i < todo.length; i += 25) {
    await Promise.all(
      todo.slice(i, i + 25).map(async (k) => {
        const entry = await readText(k.key);
        if (entry) cache.set(k.key, { version: k.version, summary: summarize(JSON.parse(entry.text) as Deal) });
      }),
    );
  }
  const byId = new Map<string, Summary>();
  for (const k of keys) {
    const hit = cache.get(k.key);
    if (hit) byId.set(hit.summary.id, hit.summary);
  }
  for (const [id, s] of fresh) {
    const listed = byId.get(id);
    if (!listed || listed.updated_at < s.updated_at) byId.set(id, s);
    else fresh.delete(id);
  }
  for (const id of gone) byId.delete(id);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Permanently delete a deal and its uploaded stamped copy. */
export async function destroyDeal(id: string): Promise<void> {
  if (!ID.test(id)) return;
  await remove(dealKey(id));
  await remove(stampedKey(id));
  cache.delete(dealKey(id));
  fresh.delete(id);
  gone.add(id);
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

export async function createDeal(manager: string, email: string, fields: Fields, clauses: Clause[], send: boolean): Promise<Deal> {
  const t = now();
  const deal: Deal = {
    id: crypto.randomBytes(12).toString("base64url"),
    secret: crypto.randomBytes(18).toString("base64url"),
    manager,
    manager_email: email,
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
    payment_requested_at: null,
    payment_expected: null,
    paid_at: null,
    cancelled_at: null,
    change_requested_at: null,
    events: [{ at: t, actor: manager, type: "created" }, ...(send ? [{ at: t, actor: manager, type: "link_created" }] : [])],
  };
  await mutate<Deal>(dealKey(deal.id), () => deal);
  remember(deal);
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
  remember(res.value);
  return { deal: res.value };
}

export function billingOf(deal: Deal): Billing | null {
  return deal.billing_enc ? decryptJson<Billing>(deal.billing_enc) : null;
}

// ---- Process ----------------------------------------------------------------
//
// One linear process per creator:
//   1 creator signs agreement + invoice  ->  2 we get approval and the company stamp
//   ->  3 creator delivers the content  ->  4 we request the transfer  ->  5 transfer goes out

export const STEPS = ["Signed", "Stamped", "Content done", "Transfer requested", "Paid"] as const;

export type Stage = "draft" | "sign" | "changes" | "stamp" | "content" | "transfer" | "payout" | "done" | "cancelled";

export function stageOf(d: Stamps): Stage {
  if (d.cancelled_at) return "cancelled";
  if (!d.sent_at) return "draft";
  if (!d.signed_at) return d.change_requested_at ? "changes" : "sign";
  if (!d.executed_at) return "stamp";
  if (!d.content_done_at) return "content";
  if (!d.payment_requested_at) return "transfer";
  if (!d.paid_at) return "payout";
  return "done";
}

/** How many of the five steps are complete. */
export function stepsDone(d: Stamps): number {
  const i = [d.signed_at, d.executed_at, d.content_done_at, d.payment_requested_at, d.paid_at].findIndex((x) => !x);
  return i === -1 ? 5 : i;
}

export const STAGE_LABEL: Record<Stage, string> = {
  draft: "Draft",
  sign: "Awaiting creator signature",
  changes: "Creator requested changes",
  stamp: "Company approval and stamp",
  content: "Content in progress",
  transfer: "Ready to request transfer",
  payout: "Transfer requested",
  done: "Completed",
  cancelled: "Cancelled",
};

export function transferOverdue(d: Stamps): boolean {
  return stageOf(d) === "payout" && !!d.payment_expected && d.payment_expected < new Date().toISOString().slice(0, 10);
}

/** Who has to move next, and what they have to do. */
export type Next = { owner: "you" | "creator" | "finance" | "none"; text: string; vars?: Record<string, number> };

export function nextAction(d: Stamps, vp?: { done: number; total: number }): Next {
  switch (stageOf(d)) {
    case "draft":
      return { owner: "you", text: "Finish the terms and create the link" };
    case "sign":
      return { owner: "creator", text: d.viewed_at ? "Opened the link, has not signed yet" : "Has not opened the link yet" };
    case "changes":
      return { owner: "you", text: "Revise the agreement" };
    case "stamp":
      return d.stamp_requested_at
        ? { owner: "finance", text: "Stamp requested. Mark it received when the stamped copy is in the folder" }
        : { owner: "you", text: "Request the company stamp" };
    case "content":
      if (vp && vp.total > 0 && vp.done >= vp.total) return { owner: "you", text: "All video links are in. Mark content complete" };
      if (vp && vp.total > 0) return { owner: "creator", text: "Posting videos: {a} of {b} links in, {n} left", vars: { a: vp.done, b: vp.total, n: vp.total - vp.done } };
      return { owner: "creator", text: "Delivering content. Mark complete when done" };
    case "transfer":
      return { owner: "you", text: "Request the transfer and record the dates" };
    case "payout":
      return transferOverdue(d) ? { owner: "you", text: "Expected date passed. Check and mark as sent" } : { owner: "finance", text: "Transfer in progress" };
    default:
      return { owner: "none", text: "" };
  }
}

export function isDone(d: Stamps): boolean {
  const s = stageOf(d);
  return s === "done" || s === "cancelled";
}

/** When the deal entered its current state, for "waiting N days". */
export function waitingSince(d: Stamps): string {
  const all = [d.paid_at, d.payment_requested_at, d.content_done_at, d.executed_at, d.stamp_requested_at, d.signed_at, d.change_requested_at, d.viewed_at, d.sent_at, d.created_at];
  return (all.filter(Boolean) as string[]).sort().pop()!;
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

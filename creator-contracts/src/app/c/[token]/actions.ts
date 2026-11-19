"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { encryptJson, sha256 } from "@/lib/crypto";
import { getDealByToken, updateDeal, videoSlots } from "@/lib/deals";
import { cleanUrl } from "@/lib/url-check";
import { EMPTY_BILLING, canonicalDocument, type Billing, type Signature } from "@/lib/template";

export type CreatorResult = { error: string } | { ok: true };

const REQUIRED: (keyof Billing)[] = ["beneficiaryName", "beneficiaryAddress", "bankName", "accountNumber"];

export async function signDeal(
  token: string,
  rawBilling: Billing,
  sig: { signature: string; name: string; title: string; consent: boolean },
): Promise<CreatorResult> {
  const deal = await getDealByToken(token);
  if (!deal || !deal.sent_at || deal.cancelled_at) return { error: "This link is no longer active. Please contact your d'Alba manager." };
  if (deal.signed_at) return { error: "This agreement has already been signed." };

  const billing = { ...EMPTY_BILLING };
  for (const k of Object.keys(EMPTY_BILLING) as (keyof Billing)[]) billing[k] = String(rawBilling?.[k] ?? "").trim().slice(0, 300);
  if (REQUIRED.some((k) => !billing[k])) return { error: "Please complete the required payment details." };
  if (!billing.swift && !billing.routingNumber && !billing.iban) return { error: "Enter at least one of: routing number, SWIFT code or IBAN." };

  const signature = String(sig?.signature ?? "").trim().slice(0, 120);
  const name = String(sig?.name ?? "").trim().slice(0, 120);
  const title = String(sig?.title ?? "").trim().slice(0, 120) || "Content Creator";
  if (!signature || !name) return { error: "Type your full legal name and your signature." };
  if (!sig?.consent) return { error: "Please confirm that you agree to sign electronically." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim();
  const userAgent = (h.get("user-agent") || "").slice(0, 300);
  const billingEnc = encryptJson(billing);

  // Re-checked inside the update so a double submit or a concurrent edit cannot slip through.
  const res = await updateDeal(deal.id, `creator:${name}`, (d) => {
    if (d.signed_at) return { error: "This agreement has already been signed." };
    if (d.cancelled_at) return { error: "This link is no longer active." };
    const signedAt = new Date().toISOString();
    const record: Signature = { signature, name, title, signedAt, ip, userAgent, docHash: sha256(canonicalDocument(d.fields, d.clauses)) };
    d.billing_enc = billingEnc;
    d.signature = record;
    d.signed_at = signedAt;
    d.change_request = null;
    d.change_requested_at = null;
    d.invoice_number = `INV-${signedAt.slice(2, 4)}${signedAt.slice(5, 7)}-${sha256(d.id).slice(0, 6).toUpperCase()}`;
    return { event: "signed" };
  });
  if ("error" in res) return res;
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

export async function requestChanges(token: string, message: string): Promise<CreatorResult> {
  const deal = await getDealByToken(token);
  if (!deal || !deal.sent_at || deal.cancelled_at) return { error: "This link is no longer active." };
  if (deal.signed_at) return { error: "This agreement has already been signed." };
  const text = String(message ?? "").trim().slice(0, 2000);
  if (text.length < 5) return { error: "Please describe what should be changed." };
  const res = await updateDeal(deal.id, "creator", (d) => {
    if (d.signed_at) return { error: "This agreement has already been signed." };
    d.change_request = text;
    d.change_requested_at = new Date().toISOString();
    return { event: "changes_requested", detail: text };
  });
  if ("error" in res) return res;
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

/** Creator submits (or resubmits) a draft link for one video. */
export async function submitDraft(token: string, slotId: string, draftUrl: string, note: string): Promise<CreatorResult> {
  const deal = await getDealByToken(token);
  if (!deal || !deal.signed_at || deal.cancelled_at) return { error: "This link is not active." };
  const url = cleanUrl(draftUrl);
  if (!url) return { error: "Paste a full link to your draft, starting with https://" };
  const text = String(note || "").trim().slice(0, 500);
  const res = await updateDeal(deal.id, "creator", (d) => {
    const slot = videoSlots(d).find((v) => v.id === slotId);
    if (!slot) return { error: "Video not found." };
    if (slot.status === "approved" || slot.status === "posted") return { error: "This draft is already approved." };
    d.videos = { ...d.videos, [slotId]: { status: "review", draft_url: url, draft_note: text || undefined, draft_at: new Date().toISOString() } };
    return { event: "draft_submitted", detail: `${slot.product} #${slot.n}` };
  });
  if ("error" in res) return res;
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

/** Creator submits the live TikTok link (and Spark Ads code) once an approved video is posted. */
export async function submitLive(token: string, slotId: string, liveUrl: string, sparkCode: string): Promise<CreatorResult> {
  const deal = await getDealByToken(token);
  if (!deal || !deal.signed_at || deal.cancelled_at) return { error: "This link is not active." };
  const url = cleanUrl(liveUrl);
  if (!url) return { error: "Paste the full link to your posted video, starting with https://" };
  const code = String(sparkCode || "").trim().slice(0, 200);
  const res = await updateDeal(deal.id, "creator", (d) => {
    const slot = videoSlots(d).find((v) => v.id === slotId);
    if (!slot) return { error: "Video not found." };
    if (slot.status !== "approved" && slot.status !== "posted") return { error: "Your draft needs to be approved before posting." };
    const { id: _i, product, n, of: _o, ...state } = slot;
    void _i, _o;
    d.videos = { ...d.videos, [slotId]: { ...state, status: "posted", live_url: url, spark_code: code || state.spark_code, posted_at: state.posted_at ?? new Date().toISOString() } };
    return { event: "video_posted", detail: `${product} #${n}` };
  });
  if ("error" in res) return res;
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

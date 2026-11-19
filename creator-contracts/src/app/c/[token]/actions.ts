"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db";
import { encryptJson, sha256 } from "@/lib/crypto";
import { getDealByToken, logEvent } from "@/lib/deals";
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
  const record: Signature = {
    signature,
    name,
    title,
    signedAt: new Date().toISOString(),
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim(),
    userAgent: (h.get("user-agent") || "").slice(0, 300),
    docHash: sha256(canonicalDocument(deal.fields, deal.clauses)),
  };

  // "signed_at is null" makes a double submit a no-op.
  const rows = await q(
    `update deals set billing_enc = $2, signature = $3, signed_at = now(), updated_at = now(),
       change_request = null, change_requested_at = null,
       invoice_number = 'INV-' || to_char(now(), 'YYMM') || '-' || nextval('invoice_seq')
     where id = $1 and signed_at is null returning id`,
    [deal.id, encryptJson(billing), JSON.stringify(record)],
  );
  if (!rows.length) return { error: "This agreement has already been signed." };
  await logEvent(deal.id, `creator:${name}`, "signed");
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

export async function requestChanges(token: string, message: string): Promise<CreatorResult> {
  const deal = await getDealByToken(token);
  if (!deal || !deal.sent_at || deal.cancelled_at) return { error: "This link is no longer active." };
  if (deal.signed_at) return { error: "This agreement has already been signed." };
  const text = String(message ?? "").trim().slice(0, 2000);
  if (text.length < 5) return { error: "Please describe what should be changed." };
  await q(`update deals set change_request = $2, change_requested_at = now(), updated_at = now() where id = $1`, [deal.id, text]);
  await logEvent(deal.id, "creator", "changes_requested", text);
  revalidatePath(`/c/${token}`);
  return { ok: true };
}

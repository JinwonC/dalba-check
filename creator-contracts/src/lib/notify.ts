import nodemailer from "nodemailer";
import { findByEmail } from "./accounts";
import { bridgeConfigured, callBridge } from "./bridge";

// Notification email to a manager. If the manager has a staff account, it is
// sent from their own NAVER WORKS mailbox to themselves (so it is never treated
// as spam). Otherwise it falls back to the Google Apps Script bridge.

const SMTP_HOST = process.env.NW_SMTP_HOST || "smtp.worksmobile.com";
const SMTP_PORT = Number(process.env.NW_SMTP_PORT || 465);

export function emailRoute(to: string): "works" | "bridge" | "off" {
  if (findByEmail(to)) return "works";
  return bridgeConfigured() ? "bridge" : "off";
}

export async function sendToManager(to: string, subject: string, html: string): Promise<"works" | "bridge" | "off"> {
  const account = findByEmail(to);
  if (account) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      requireTLS: SMTP_PORT !== 465,
      auth: { user: account.email, pass: account.appPassword },
      connectionTimeout: 15000,
      socketTimeout: 20000,
    });
    await transporter.sendMail({ from: { name: "d'Alba Creator Contracts", address: account.email }, to: account.email, subject, html });
    return "works";
  }
  if (bridgeConfigured() && to) {
    await callBridge({ action: "email", to, subject, html });
    return "bridge";
  }
  return "off";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function notifySigned(opts: { to: string; manager: string; handle: string; signer: string; dealUrl: string }): Promise<void> {
  if (!opts.to) return;
  const subject = `[d'Alba] @${opts.handle} 계약서 서명 완료 / signed`;
  const html = `<p>${esc(opts.manager)}님,</p>
<p><b>@${esc(opts.handle)}</b> (${esc(opts.signer)}) 님이 계약서와 인보이스에 서명했습니다.<br>다음 단계: 서명본을 내려받아 회사 직인을 받으세요.</p>
<p><b>@${esc(opts.handle)}</b> (${esc(opts.signer)}) has signed the agreement and invoice.<br>Next: download the signed PDF and get the company stamp.</p>
<p><a href="${esc(opts.dealUrl)}">${esc(opts.dealUrl)}</a></p>`;
  await sendToManager(opts.to, subject, html);
}

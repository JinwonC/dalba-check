// Email to the manager when their creator signs. Off unless RESEND_API_KEY and
// NOTIFY_FROM are set (Resend, https://resend.com).

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function notifySigned(opts: { to: string; manager: string; handle: string; signer: string; dealUrl: string }): Promise<void> {
  if (!emailConfigured() || !opts.to) return;
  const subject = `[d'Alba] @${opts.handle} 계약서 서명 완료 / signed`;
  const html = `<p>${esc(opts.manager)}님,</p>
<p><b>@${esc(opts.handle)}</b> (${esc(opts.signer)}) 님이 계약서와 인보이스에 서명했습니다.<br>다음 단계: 서명본을 내려받아 회사 직인을 받으세요.</p>
<p><b>@${esc(opts.handle)}</b> (${esc(opts.signer)}) has signed the agreement and invoice.<br>Next: download the signed PDF and get the company stamp.</p>
<p><a href="${esc(opts.dealUrl)}">${esc(opts.dealUrl)}</a></p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM, to: [opts.to], subject, html }),
  });
  if (!res.ok) throw new Error(`Email send failed (${res.status})`);
}

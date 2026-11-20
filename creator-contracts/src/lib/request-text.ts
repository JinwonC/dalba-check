import { itemsOf, money, totalVideos, type Fields } from "./template";

// Text for the internal work-request sheet ("요청 업무 내용" column). Pure, so
// the form can preview exactly what will be written.

export const REQUEST_KINDS = ["지출결의서 상신", "계약서 상신"] as const;

/** "11월" or "11~12월" from the contract's start and end dates. */
export function contractMonths(f: Fields): string {
  const a = Number((f.startDate || "").slice(5, 7));
  const b = Number((f.endDate || "").slice(5, 7));
  if (!a && !b) return "";
  if (!b || a === b) return `${a || b}월`;
  if (!a) return `${b}월`;
  return `${a}~${b}월`;
}

export function requestText(f: Fields, opts: { purpose: string; expected?: string; videos?: string[] }): string {
  const products = itemsOf(f)
    .map((i) => i.product)
    .filter(Boolean)
    .join(", ");
  const months = contractMonths(f);
  const terms = [`틱톡샵 영상 ${totalVideos(f)}개`, `비용 ${money(f.fee, f.currency)}`];
  if (Number(f.commissionPct) > 0) terms.push(`커미션 ${f.commissionPct}%`);
  const lines = [
    `${months} ${products} 송금 1건 요청`.trim(),
    "",
    `1. ${f.handle} 계약기간: ${months} | 계약 조건: ${terms.join(", ")} | 제품: ${products} | 추진 목적 및 기대효과: ${opts.purpose.trim() || "-"}`,
  ];
  if (opts.expected) lines.push(`송금 예상일: ${opts.expected}`);
  if (opts.videos?.length) lines.push("", ...opts.videos);
  return lines.join("\n");
}

/** Accept only absolute http(s) links; returns the normalized URL or "" if unusable. */
export function cleanUrl(input: string): string {
  let raw = String(input || "").trim();
  if (!raw || raw.length > 600) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (!u.hostname.includes(".")) return "";
    return u.toString();
  } catch {
    return "";
  }
}

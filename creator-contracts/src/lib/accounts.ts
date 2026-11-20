import crypto from "node:crypto";

// Staff accounts, shared with the outreach tool: the same NW_ACCOUNTS
// environment variable, so a manager signs in here with the same ID and
// password, and removing their line there blocks them here too.
//
// Format 1 (one per line):  id|loginPassword|name|worksEmail|appPassword|title
// Format 2 (JSON):          [{"id","pw","name","email","appPassword","title"}]
//
// The NAVER WORKS app password never leaves the server.

export type Account = { id: string; pw: string; name: string; email: string; appPassword: string; title: string };

export function parseAccounts(): Account[] {
  const raw = (process.env.NW_ACCOUNTS || "").trim();
  if (!raw) return [];
  const str = (v: unknown) => String(v ?? "").trim();
  let list: Account[];
  if (raw[0] === "[" || raw[0] === "{") {
    try {
      const arr = JSON.parse(raw);
      list = (Array.isArray(arr) ? arr : [arr]).map((a) => ({
        id: str(a.id || a.loginId).toLowerCase(),
        pw: String(a.pw || a.password || a.loginPw || ""),
        name: str(a.name),
        email: str(a.email).toLowerCase(),
        appPassword: String(a.appPassword || a.appPw || a.smtpPassword || ""),
        title: str(a.title),
      }));
    } catch {
      return [];
    }
  } else {
    list = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && l[0] !== "#")
      .map((l) => {
        const f = l.split("|").map((s) => s.trim());
        return { id: (f[0] || "").toLowerCase(), pw: f[1] || "", name: f[2] || "", email: (f[3] || "").toLowerCase(), appPassword: f[4] || "", title: f[5] || "" };
      });
  }
  return list.filter((a) => a.id && a.pw && a.email && a.appPassword);
}

export const accountsEnabled = () => parseAccounts().length > 0;

function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
}

export function findByLogin(id: string, pw: string): Account | null {
  const wanted = String(id || "").trim().toLowerCase();
  if (!wanted || !pw) return null;
  // Walk the whole list so a wrong ID takes as long as a wrong password.
  let found: Account | null = null;
  for (const a of parseAccounts()) if (a.id === wanted && safeEqual(a.pw, pw)) found = a;
  return found;
}

export function findByEmail(email: string | null | undefined): Account | null {
  const e = String(email || "").trim().toLowerCase();
  return e ? (parseAccounts().find((a) => a.email === e) ?? null) : null;
}

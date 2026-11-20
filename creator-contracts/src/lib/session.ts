import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// No accounts: a manager enters the shared team access code and their name
// once per browser. The name is what "My deals" and the activity log use.

const COOKIE = "dalba_manager";
export type Manager = { name: string; email: string };

const emailDomains = () =>
  (process.env.ALLOWED_EMAIL_DOMAINS || "dalbausa.com,dalba.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

/** Normalized work email, or "" if it is not on a company domain. */
export function workEmail(input: string): string {
  const email = String(input || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return "";
  return emailDomains().includes(email.split("@")[1]) ? email : "";
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/** True when an access code is configured. Production refuses to run without one. */
export const accessCodeSet = () => !!process.env.APP_KEY;
export const misconfigured = () => !process.env.APP_KEY && process.env.VERCEL_ENV === "production";

export function checkAccessCode(code: string): boolean {
  if (misconfigured()) return false;
  if (!process.env.APP_KEY) return true;
  return safeEqual(code.trim(), process.env.APP_KEY);
}

export async function startSession(name: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ name, email })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<Manager | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const { name, email } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Sessions from before emails were collected are asked to enter again.
    return typeof name === "string" && name && typeof email === "string" && email ? { name, email } : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<Manager> {
  const user = await currentUser();
  if (!user) redirect("/enter");
  return user;
}

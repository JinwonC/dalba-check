import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// No accounts: a manager enters the shared team access code and their name
// once per browser. The name is what "My deals" and the activity log use.

const COOKIE = "dalba_manager";
export type Manager = { name: string };

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

export async function startSession(name: string) {
  const payload = Buffer.from(JSON.stringify({ name })).toString("base64url");
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
    const { name } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof name === "string" && name ? { name } : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<Manager> {
  const user = await currentUser();
  if (!user) redirect("/enter");
  return user;
}

import crypto from "node:crypto";

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return crypto.createHash("sha256").update(k).digest();
}

/** AES-256-GCM. Used for creator bank details at rest. */
export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T>(enc: string): T {
  const [iv, tag, data] = enc.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

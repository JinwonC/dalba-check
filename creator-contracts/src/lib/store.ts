import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

// Tiny document store. On Vercel it is a private Vercel Blob store; locally
// (no Blob credentials) it falls back to files under .data/ for development.

const useBlob = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const localDir = path.join(process.cwd(), ".data");

export type Entry = { text: string; etag: string };

export async function readText(key: string): Promise<Entry | null> {
  if (useBlob) {
    const r = await get(key, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { text: await new Response(r.stream).text(), etag: r.blob.etag };
  }
  try {
    const text = await fs.readFile(path.join(localDir, key), "utf8");
    return { text, etag: crypto.createHash("sha1").update(text).digest("hex") };
  } catch {
    return null;
  }
}

/** Write a document. With `ifMatch`, returns false if someone else changed it first. */
export async function writeText(key: string, text: string, ifMatch?: string): Promise<boolean> {
  if (useBlob) {
    try {
      await put(key, text, { access: "private", allowOverwrite: true, contentType: "application/json", ...(ifMatch ? { ifMatch } : {}) });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false;
      throw e;
    }
  }
  if (ifMatch) {
    const cur = await readText(key);
    if (cur && cur.etag !== ifMatch) return false;
  }
  const file = path.join(localDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  return true;
}

export async function readBytes(key: string): Promise<Buffer | null> {
  if (useBlob) {
    const r = await get(key, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  try {
    return await fs.readFile(path.join(localDir, key));
  } catch {
    return null;
  }
}

export async function writeBytes(key: string, data: Buffer, contentType: string): Promise<void> {
  if (useBlob) {
    await put(key, data, { access: "private", allowOverwrite: true, contentType });
    return;
  }
  const file = path.join(localDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

/** Read-modify-write with optimistic concurrency. `fn` may return an error string to abort. */
export async function mutate<T>(key: string, fn: (current: T | null) => T | { error: string }): Promise<{ value: T } | { error: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readText(key);
    const next = fn(cur ? (JSON.parse(cur.text) as T) : null);
    if (next && typeof next === "object" && "error" in next && Object.keys(next).length === 1) return next as { error: string };
    if (await writeText(key, JSON.stringify(next), cur?.etag)) return { value: next as T };
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  return { error: "The record is busy. Please try again." };
}

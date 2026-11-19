import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { get, list, put } from "@vercel/blob";

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

export async function writeText(key: string, text: string): Promise<void> {
  if (useBlob) {
    await put(key, text, { access: "private", allowOverwrite: true, contentType: "application/json" });
    return;
  }
  const file = path.join(localDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

/** Keys under a prefix, each with a version string that changes whenever the document is rewritten. */
export async function listKeys(prefix: string): Promise<{ key: string; version: string }[]> {
  if (useBlob) {
    const out: { key: string; version: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      for (const b of page.blobs) out.push({ key: b.pathname, version: `${b.etag ?? ""}:${new Date(b.uploadedAt).getTime()}:${b.size}` });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  try {
    const dir = path.join(localDir, prefix);
    const names = await fs.readdir(dir);
    return Promise.all(
      names.map(async (n) => {
        const st = await fs.stat(path.join(dir, n));
        return { key: `${prefix}${n}`, version: `${st.mtimeMs}:${st.size}` };
      }),
    );
  } catch {
    return [];
  }
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

/**
 * Read the latest version, apply `fn`, write it back. `fn` may return an error
 * to abort. Each deal is its own document, so writers only collide when two
 * people change the same deal within the same instant.
 */
export async function mutate<T>(key: string, fn: (current: T | null) => T | { error: string }): Promise<{ value: T } | { error: string }> {
  const cur = await readText(key);
  const next = fn(cur ? (JSON.parse(cur.text) as T) : null);
  if (next && typeof next === "object" && "error" in next && Object.keys(next).length === 1) return next as { error: string };
  await writeText(key, JSON.stringify(next));
  return { value: next as T };
}

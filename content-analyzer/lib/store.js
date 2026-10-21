import { Redis } from '@upstash/redis';
import { get as blobGet, list as blobList, del as blobDel } from '@vercel/blob';
import { reportToPlainText } from './reportText.js';
import { pushToDrive, driveEnabled } from './drive.js';
import { deleteVideo } from './videos.js';

// History/reports live in Upstash Redis (tiny JSON, well within the free tier),
// deliberately separate from Vercel Blob so a video data-transfer limit can never
// take the history down with it. Videos stay in the public Blob store (videos.js).
//
// Keys:
//   report:<id>   → full analysis record (object)
//   summary:<id>  → history-list summary (object)
//   history_z     → sorted set, score = savedAt, member = id (for ordering)

let _redis = null;
function redis() {
  if (!_redis) _redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  return _redis;
}
export const storeEnabled = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// Optional per-team key prefix, so several deployments can share one Upstash DB
// while keeping completely separate histories. Unset = the original keys.
const ns = () => {
  const n = (process.env.STORE_NAMESPACE || '').trim();
  return n ? `${n}:` : '';
};
const ZKEY = () => `${ns()}history_z`;
const RKEY = (id) => `${ns()}report:${id}`;
const SKEY = (id) => `${ns()}summary:${id}`;
const validId = (id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id);

/** Build a history-list summary from a full stored record. */
function summaryOf(rec) {
  return {
    id: rec.id,
    creator: rec.meta?.author || '',
    title: rec.meta?.title || '',
    manager: rec.meta?.manager || '',
    product: rec.meta?.product || '',
    country: rec.meta?.country || '',
    thumbnail: rec.meta?.thumbnail || '',
    url: rec.meta?.url || rec.embed?.url || '',
    driveUrl: rec.driveUrl || '',
    savedAt: rec.savedAt || 0,
  };
}

/**
 * Save (or overwrite) an analysis, keyed by videoId so re-analyzing the same
 * video updates the same entry. Returns { id, driveUrl }, or null if unconfigured.
 */
export async function saveAnalysis(record) {
  if (!storeEnabled()) return null;
  const id = record?.embed?.videoId || record?.id;
  if (!validId(id)) throw new Error('Cannot save: missing/invalid video id.');

  const rec = { ...record, id, savedAt: Date.now() };

  // Export to Google Drive first so we can store the Doc link with the record.
  let driveUrl = record.driveUrl || null;
  if (driveEnabled()) {
    const title = `[분석] ${rec.meta?.author || ''} — ${(rec.meta?.title || id).slice(0, 60)}`;
    driveUrl = (await pushToDrive({ title, text: reportToPlainText(rec) }).catch(() => null)) || driveUrl;
  }
  rec.driveUrl = driveUrl;

  // Atomic per-key writes — no read-modify-write index to race/clobber.
  await Promise.all([
    redis().set(RKEY(id), rec),
    redis().set(SKEY(id), summaryOf(rec)),
    redis().zadd(ZKEY(), { score: rec.savedAt, member: id }),
  ]);

  return { id, driveUrl };
}

/** List saved analyses (newest first), summary fields only. */
export async function listAnalyses() {
  if (!storeEnabled()) return [];
  const ids = await redis().zrange(ZKEY(), 0, 999, { rev: true });
  if (!ids || !ids.length) return [];
  // Chunk the MGET so a large history cannot exceed the REST request limit.
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const vals = await redis().mget(...ids.slice(i, i + 200).map(SKEY));
    out.push(...(vals || []).filter(Boolean));
  }
  return out;
}

/** Fetch one full saved analysis by id (Upstash, then legacy Blob if present). */
export async function getAnalysis(id) {
  if (!validId(id)) return null;
  if (storeEnabled()) {
    const rec = await redis().get(RKEY(id));
    if (rec) return rec;
  }
  return legacyGet(id);
}

/** Delete an analysis: Redis entries + stored video (best-effort). */
export async function deleteAnalysis(id) {
  if (!storeEnabled() || !validId(id)) return false;
  try {
    await Promise.all([
      redis().del(RKEY(id), SKEY(id)),
      redis().zrem(ZKEY(), id),
    ]);
  } catch (e) {
    console.warn('Delete failed:', e.message);
  }
  await deleteVideo(id).catch(() => {});
  await legacyDelete(id).catch(() => {});
  return true;
}

// ---- legacy Vercel Blob store (read-only migration path) ----
// Older history lived in a private Blob store as reports/<id>.json. That store is
// suspended while the account's Blob usage is over the free tier, but the data is
// intact and returns after the monthly reset. These helpers let us recover it.

const legacyEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const legacyToken = () => process.env.BLOB_READ_WRITE_TOKEN;

async function legacyReadJSON(pathname) {
  try {
    const g = await blobGet(pathname, { token: legacyToken(), access: 'private' });
    if (g.statusCode !== 200 || !g.stream) return null;
    const reader = g.stream.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

async function legacyGet(id) {
  if (!legacyEnabled() || !validId(id)) return null;
  return legacyReadJSON(`reports/${id}.json`);
}

async function legacyDelete(id) {
  if (!legacyEnabled() || !validId(id)) return;
  const { blobs } = await blobList({ prefix: `reports/${id}`, token: legacyToken() });
  for (const b of blobs) if (b.pathname === `reports/${id}.json`) await blobDel(b.url, { token: legacyToken() });
}

/**
 * One-time recovery: import every legacy Blob report into Upstash. Safe to re-run
 * (skips ids that already exist). Returns { migrated, skipped }. Only works once
 * the legacy Blob store is readable again (after the monthly usage reset).
 */
export async function migrateLegacyToUpstash() {
  if (!storeEnabled()) throw new Error('Upstash is not configured.');
  if (!legacyEnabled()) return { migrated: 0, skipped: 0 };
  const { blobs } = await blobList({ prefix: 'reports/', token: legacyToken() });
  const reportBlobs = blobs.filter((b) => /^reports\/[\w-]+\.json$/.test(b.pathname));
  let migrated = 0, skipped = 0;
  for (const b of reportBlobs) {
    const rec = await legacyReadJSON(b.pathname);
    if (!rec || !validId(rec.id)) { skipped += 1; continue; }
    if (await redis().exists(RKEY(rec.id))) { skipped += 1; continue; }
    rec.savedAt = rec.savedAt || 0;
    await Promise.all([
      redis().set(RKEY(rec.id), rec),
      redis().set(SKEY(rec.id), summaryOf(rec)),
      redis().zadd(ZKEY(), { score: rec.savedAt, member: rec.id }),
    ]);
    migrated += 1;
  }
  return { migrated, skipped };
}

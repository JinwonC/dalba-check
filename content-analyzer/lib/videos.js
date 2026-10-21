import { put, list, del } from '@vercel/blob';

// Public Blob store (separate from the private reports store) so the browser
// can stream the mp4 directly with range/seek support.
const token = () => process.env.VIDEOS_READ_WRITE_TOKEN;
export const videosEnabled = () => Boolean(process.env.VIDEOS_READ_WRITE_TOKEN);

/**
 * Save an mp4 to the public videos store and return its public URL.
 * Keyed by videoId so re-analysis overwrites. Returns null if not configured.
 */
export async function saveVideo(videoId, buffer, contentType = 'video/mp4') {
  if (!videosEnabled() || !videoId || !buffer) return null;
  const safe = String(videoId).replace(/[^\w-]/g, '');
  if (!safe) return null;
  const blob = await put(`videos/${safe}.mp4`, buffer, {
    access: 'public',
    token: token(),
    contentType,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000, // videos are immutable per id
  });
  return blob.url;
}

/** All blobs under a prefix (list() pages at 1000). */
async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: token() });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// Manual uploads are stored as videos/up_<ts>_<i>-<random>.mp4 (client upload adds a random suffix).
const isUpload = (pathname) => /^videos\/up_/.test(pathname);

/** Delete a stored video by id (best-effort). Matches both videos/<id>.mp4 and suffixed uploads. */
export async function deleteVideo(id) {
  if (!videosEnabled() || !id) return;
  const safe = String(id).replace(/[^\w-]/g, '');
  if (!safe) return;
  const blobs = await listAll(`videos/${safe}`);
  const mine = blobs.filter((b) => b.pathname === `videos/${safe}.mp4` || b.pathname.startsWith(`videos/${safe}-`));
  if (mine.length) await del(mine.map((b) => b.url), { token: token() });
}

// Link videos (TikTok/Instagram) fall back to the platform embed once deleted, so they're kept briefly.
const LINK_MAX_AGE_DAYS = Number(process.env.VIDEO_MAX_AGE_DAYS || 7);
const LINK_MAX_COUNT = Number(process.env.VIDEO_MAX_COUNT || 40);
const LINK_MAX_BYTES = Number(process.env.VIDEO_MAX_TOTAL_MB || 800) * 1e6;
// Manual uploads have no other copy to fall back to, so they're kept much longer and never count
// toward the link-video caps; a separate size budget bounds storage.
export const UPLOAD_MAX_AGE_DAYS = Number(process.env.UPLOAD_MAX_AGE_DAYS || 30);
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_TOTAL_MB || 20000) * 1e6;

/** Oldest-first deletions for one group: past maxAge, beyond maxCount newest, or beyond maxBytes. */
function overBudget(items, { maxAgeDays, maxCount = Infinity, maxBytes }) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const doomed = [];
  let kept = 0, bytes = 0;
  for (const it of [...items].sort((a, b) => b.t - a.t)) { // newest first
    if (it.t < cutoff || kept + 1 > maxCount || bytes + it.size > maxBytes) doomed.push(it.url);
    else { kept += 1; bytes += it.size; }
  }
  return doomed;
}

/**
 * Prune stored videos so storage stays bounded. Link videos: older than LINK_MAX_AGE_DAYS, beyond the
 * newest LINK_MAX_COUNT, or beyond LINK_MAX_BYTES. Uploads: older than UPLOAD_MAX_AGE_DAYS or beyond
 * UPLOAD_MAX_BYTES. Best-effort; never throws.
 */
export async function pruneOldVideos() {
  if (!videosEnabled()) return;
  try {
    const items = (await listAll('videos/')).map((b) => ({
      url: b.url, upload: isUpload(b.pathname), size: Number(b.size) || 0, t: new Date(b.uploadedAt).getTime(),
    }));
    const toDelete = [
      ...overBudget(items.filter((i) => !i.upload), { maxAgeDays: LINK_MAX_AGE_DAYS, maxCount: LINK_MAX_COUNT, maxBytes: LINK_MAX_BYTES }),
      ...overBudget(items.filter((i) => i.upload), { maxAgeDays: UPLOAD_MAX_AGE_DAYS, maxBytes: UPLOAD_MAX_BYTES }),
    ];
    if (toDelete.length) await del(toDelete, { token: token() });
  } catch (e) {
    console.warn('Video prune skipped:', e.message);
  }
}

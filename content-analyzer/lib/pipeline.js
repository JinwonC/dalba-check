import { detectPlatform, scrapeContent, scrapeTikTokComments, apifyToken } from './apify.js';
import { downloadVideo, fetchSubtitles } from './vision.js';
import { generateReport } from './report.js';
import { analyzeComments } from './comments.js';
import { saveVideo, pruneOldVideos } from './videos.js';
import { generateGuide } from './guide.js';
import { extractDna, analyzeVisualStyle } from './dna.js';
import { stackHooks } from './hookstack.js';

/** Stable id for a piece of content (TikTok video id or Instagram shortcode). */
export function contentId(url) {
  const s = String(url || '');
  let m = s.match(/\/video\/(\d+)/);
  if (m) return m[1]; // tiktok
  m = s.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
  if (m) return 'ig_' + m[1]; // instagram
  return null;
}
// Backwards-compatible alias.
export const tiktokVideoId = contentId;

/** Error with an attached HTTP status, so callers can map it cleanly. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OUR_BLOB = /(^|\.)public\.blob\.vercel-storage\.com$/;
const TIKTOK_HOST = /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com|ibyteimg\.com)$/;
const IG_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

/** Allowlist the hosts the report stage is allowed to fetch (anti-SSRF). */
function assertAllowedMediaUrl(videoUrl, subtitleUrl) {
  const vh = hostOf(videoUrl);
  if (!vh) throw new HttpError(400, 'Invalid videoUrl.');
  // Apify store (TikTok), Instagram CDN, or our own uploaded blob.
  if (vh !== 'api.apify.com' && !TIKTOK_HOST.test(vh) && !IG_HOST.test(vh) && !OUR_BLOB.test(vh)) {
    throw new HttpError(400, `videoUrl host not allowed: ${vh}`);
  }
  if (subtitleUrl) {
    const sh = hostOf(subtitleUrl);
    if (!sh || (!TIKTOK_HOST.test(sh) && sh !== 'api.apify.com')) {
      throw new HttpError(400, `subtitleUrl host not allowed: ${sh}`);
    }
  }
}

/**
 * Stage 1 — scrape only (Apify). Supports TikTok + Instagram. Returns everything
 * the client needs to render the video + the media URLs for stage 2.
 */
export async function runScrape({ url }) {
  url = (url || '').trim();
  if (!url) throw new HttpError(400, 'Missing "url" in request body.');
  const platform = detectPlatform(url);
  if (platform !== 'tiktok' && platform !== 'instagram') {
    throw new HttpError(400, '틱톡 또는 인스타그램 링크를 입력하세요.');
  }
  if (!apifyToken()) throw new HttpError(500, 'APIFY_TOKEN is not set on the server.');

  const content = await scrapeContent(url);
  if (!content.videoUrl) {
    throw new HttpError(502, '동영상 URL을 찾지 못했습니다. (동영상 게시물인지 확인해 주세요)');
  }

  const meta = {
    platform,
    url: content.url,
    title: content.title,
    author: content.author,
    durationSeconds: content.durationSeconds,
    stats: content.stats,
    thumbnail: content.thumbnail,
    hashtags: content.hashtags,
  };

  return {
    platform,
    meta,
    embed: { platform, videoId: contentId(url), url: content.url, thumbnail: content.thumbnail || '' },
    media: { videoUrl: content.videoUrl, subtitleUrl: content.subtitleUrl || '' },
    comments: content.comments || null, // Instagram returns comments inline
  };
}

/**
 * Stage 3 — comment analysis (Gemini text-only). TikTok: scrape by url. Instagram:
 * comments are passed in from stage 1. Uploads: no comments.
 */
export async function runComments({ url, meta = {}, comments = null }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');

  let list = Array.isArray(comments) ? comments : null;
  if (!list) {
    url = (url || meta.url || '').trim();
    if (detectPlatform(url) === 'tiktok') {
      if (!apifyToken()) throw new HttpError(500, 'APIFY_TOKEN is not set on the server.');
      list = await scrapeTikTokComments(url, 40);
    } else {
      list = [];
    }
  }
  list = (list || []).slice(0, 60).map((c) => ({
    text: String(c?.text || '').slice(0, 300),
    likes: Number(c?.likes) || 0,
    author: String(c?.author || '').slice(0, 80),
    pinned: Boolean(c?.pinned),
  })).filter((c) => c.text);

  if (!list.length) return { comments_analysis: await analyzeComments({ comments: [], meta }), count: 0 };
  return { comments_analysis: await analyzeComments({ comments: list, meta }), count: list.length };
}

/**
 * Stage 2 — download media + Gemini report. If the video is already in our public
 * store (an upload), reuse it; otherwise download + persist it. Single Gemini
 * attempt (the client retries) so each call stays under the serverless cap.
 */
export async function runReport({ videoUrl, subtitleUrl = '', meta = {}, videoId = null }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  if (!videoUrl) throw new HttpError(400, 'Missing "videoUrl".');
  assertAllowedMediaUrl(videoUrl, subtitleUrl);

  const [videoBuffer, transcriptVtt] = await Promise.all([
    downloadVideo(videoUrl),
    fetchSubtitles(subtitleUrl),
  ]);

  const alreadyStored = OUR_BLOB.test(hostOf(videoUrl) || '');
  const id = videoId || contentId(meta.url || '');
  const [report, video] = await Promise.all([
    generateReport({ videoBuffer, transcriptVtt, meta, tries: 1 }),
    alreadyStored
      ? Promise.resolve(videoUrl)
      : saveVideo(id, videoBuffer).catch((e) => { console.warn('Video save skipped:', e.message); return null; }),
  ]);
  await pruneOldVideos();

  return { report, video };
}

/** Combined one-shot (used locally / for tests; too slow for a single serverless call). */
export async function runAnalysis({ url }) {
  const { platform, meta, embed, media } = await runScrape({ url });
  const { report } = await runReport({ ...media, meta });
  return { platform, meta, embed, report };
}




/** Stage: stack proven hooks from several videos into 3 combined options. */
export async function runHookStack({ hookReports = [], productInfo = '', language = '', meta = {} }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  if (!Array.isArray(hookReports) || !hookReports.length) throw new HttpError(400, '훅 영상이 최소 1개 필요합니다.');
  return await stackHooks({ hookReports, productInfo, language, meta });
}

/** Stage: extract creator style DNA from pre-analyzed reports (text-only, fast). */
export async function runDna({ creatorReports = [] }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  if (!Array.isArray(creatorReports) || !creatorReports.length) {
    throw new HttpError(400, '크리에이터 영상 분석이 최소 1개 필요합니다.');
  }
  return { dna: await extractDna({ creatorReports }) };
}

/** Stage: visual style pass — Gemini watches one creator video (visuals only). */
export async function runStylePass({ videoUrl }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  if (!videoUrl) throw new HttpError(400, 'Missing "videoUrl".');
  assertAllowedMediaUrl(videoUrl);
  const videoBuffer = await downloadVideo(videoUrl);
  return { style: await analyzeVisualStyle({ videoBuffer }) };
}

/** Stage: synthesize a shooting guide from pre-analyzed reports (text-only, fast). */
export async function runGuide({ stackedHooks = [], bodyReport = null, styleDna = null, productInfo = '', meta = {} }) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  if (!Array.isArray(stackedHooks) || !stackedHooks.length) throw new HttpError(400, '훅(레이어 1)이 필요합니다.');
  if (!bodyReport) throw new HttpError(400, '바디 레퍼런스 영상(레이어 2)이 필요합니다.');
  const guide = await generateGuide({ stackedHooks, bodyReport, styleDna, productInfo, meta });
  return { guide };
}

export { HttpError };

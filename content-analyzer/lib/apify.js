import { ApifyClient } from 'apify-client';

const YOUTUBE_ACTOR = process.env.APIFY_YOUTUBE_ACTOR || 'streamers/youtube-scraper';
const YOUTUBE_TRANSCRIPT_ACTOR =
  process.env.APIFY_YOUTUBE_TRANSCRIPT_ACTOR || 'pintostudio/youtube-transcript-scraper';
const TIKTOK_ACTOR = process.env.APIFY_TIKTOK_ACTOR || 'clockworks/tiktok-scraper';
const TIKTOK_COMMENTS_ACTOR = process.env.APIFY_TIKTOK_COMMENTS_ACTOR || 'clockworks/tiktok-comments-scraper';
const INSTAGRAM_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-scraper';

// Trimmed: a token pasted into Vercel with a stray space/newline is otherwise rejected by Apify
// with the same "User was not found or authentication token is not valid" as a wrong token.
export const apifyToken = () => String(process.env.APIFY_TOKEN || '').trim();

const AUTH_HELP =
  'Apify 토큰이 유효하지 않습니다 (User was not found or authentication token is not valid). ' +
  'Vercel → Settings → Environment Variables에서 Production의 APIFY_TOKEN을 Apify 콘솔(Settings → API & Integrations)의 ' +
  '현재 토큰으로 바꾼 뒤 Redeploy 하세요. /api/health?check=apify 로 확인할 수 있어요.';

/** Turn Apify's auth failure into an actionable message; pass other errors through. */
export function explainApifyError(err) {
  if (err?.statusCode === 401 || err?.type === 'user-or-token-not-found' || /authentication token is not valid/i.test(String(err?.message))) {
    const e = new Error(AUTH_HELP);
    e.status = 502;
    return e;
  }
  return err;
}

let _client = null;
let _clientToken = '';
function client() {
  const token = apifyToken();
  if (!token) throw new Error('APIFY_TOKEN is not set. Add it to your .env file.');
  if (!_client || _clientToken !== token) {
    _client = new ApifyClient({ token });
    _clientToken = token;
  }
  return _client;
}

/**
 * Check the configured token against Apify (GET /v2/users/me). Never returns the token itself.
 * → { configured, valid, username?, hadWhitespace, error? }
 */
export async function checkApifyToken() {
  const raw = String(process.env.APIFY_TOKEN || '');
  const token = raw.trim();
  const out = { configured: Boolean(token), valid: false, hadWhitespace: raw !== token };
  if (!token) return out;
  try {
    const res = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ...out, valid: true, username: body?.data?.username || '' };
    return { ...out, error: body?.error?.type || `HTTP ${res.status}` };
  } catch (e) {
    return { ...out, error: e.message };
  }
}

/** Detect which platform a URL belongs to. Returns 'youtube' | 'tiktok' | null. */
export function detectPlatform(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('youtube-nocookie.com')) {
    return 'youtube';
  }
  if (host.endsWith('tiktok.com')) {
    return 'tiktok';
  }
  if (host.endsWith('instagram.com')) {
    return 'instagram';
  }
  return null;
}

/** Run an actor and return its dataset items. */
async function runActor(actorId, input) {
  try {
    const run = await client().actor(actorId).call(input);
    const { items } = await client().dataset(run.defaultDatasetId).listItems();
    return items;
  } catch (err) {
    throw explainApifyError(err);
  }
}

/** Pull the first non-empty value across a list of candidate keys. */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Extract hashtags from text and/or a structured hashtags array. */
function extractHashtags(text, structured) {
  const tags = new Set();
  if (Array.isArray(structured)) {
    for (const h of structured) {
      const name = typeof h === 'string' ? h : h?.name || h?.title;
      if (name) tags.add(String(name).replace(/^#/, ''));
    }
  }
  if (typeof text === 'string') {
    for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      tags.add(m[1]);
    }
  }
  return [...tags];
}

/** Join transcript/subtitle segments into a single string. */
function flattenTranscript(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((seg) => (typeof seg === 'string' ? seg : seg?.text || seg?.caption || ''))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

async function scrapeYouTube(url) {
  const items = await runActor(YOUTUBE_ACTOR, {
    startUrls: [{ url }],
    maxResults: 1,
    maxResultsShorts: 1,
    subtitlesLanguage: 'en',
    downloadSubtitles: true,
  });
  const v = items[0] || {};

  let transcript = flattenTranscript(pick(v, ['subtitles', 'transcript', 'captions']));

  // Fall back to a dedicated transcript actor if the main one returned none.
  if (!transcript) {
    try {
      const t = await runActor(YOUTUBE_TRANSCRIPT_ACTOR, { videoUrl: url, url });
      transcript = flattenTranscript(t[0]?.transcript || t[0]?.data || t);
    } catch {
      /* transcript is best-effort */
    }
  }

  const description = pick(v, ['text', 'description']) || '';
  return {
    platform: 'youtube',
    url,
    title: pick(v, ['title']) || '',
    author: pick(v, ['channelName', 'channelUsername', 'author']) || '',
    description,
    transcript,
    hashtags: extractHashtags(description, v.hashtags),
    durationSeconds: pick(v, ['duration', 'lengthSeconds']),
    stats: {
      views: pick(v, ['viewCount', 'views']),
      likes: pick(v, ['likes', 'likeCount']),
      comments: pick(v, ['commentsCount', 'commentCount']),
    },
    thumbnail: pick(v, ['thumbnailUrl', 'thumbnail']),
    raw: v,
  };
}

/** Pick the best subtitle link (prefer English ASR) from videoMeta.subtitleLinks. */
function pickSubtitleUrl(videoMeta) {
  const links = videoMeta?.subtitleLinks;
  if (!Array.isArray(links) || links.length === 0) return undefined;
  const isEng = (l) => /^eng/i.test(l?.language || '');
  const eng = links.find(isEng);
  const chosen = eng || links[0];
  return chosen?.downloadLink || chosen?.tiktokLink;
}

async function scrapeTikTok(url) {
  const items = await runActor(TIKTOK_ACTOR, {
    postURLs: [url],
    resultsPerPage: 1,
    shouldDownloadSubtitles: true,
    shouldDownloadVideos: true,
    shouldDownloadCovers: false,
  });
  const v = items[0] || {};

  const caption = pick(v, ['text', 'description', 'desc']) || '';
  const transcript = flattenTranscript(
    pick(v, ['subtitles', 'transcript', 'videoSubtitles'])
  );
  // mediaUrls (Apify-hosted mp4) is the reliable download source.
  const videoUrl =
    (Array.isArray(v.mediaUrls) && v.mediaUrls[0]) ||
    pick(v?.videoMeta || v, ['downloadAddr', 'playAddr']) ||
    pick(v, ['videoUrl']);
  const subtitleUrl = pickSubtitleUrl(v?.videoMeta);

  return {
    platform: 'tiktok',
    videoUrl,
    subtitleUrl,
    url,
    title: caption.split('\n')[0] || '',
    author: pick(v?.authorMeta || v, ['name', 'nickName', 'authorName', 'author']) || '',
    description: caption,
    transcript,
    hashtags: extractHashtags(caption, v.hashtags),
    durationSeconds: pick(v?.videoMeta || v, ['duration']),
    stats: {
      views: pick(v, ['playCount', 'views']),
      likes: pick(v, ['diggCount', 'likes']),
      comments: pick(v, ['commentCount', 'comments']),
      shares: pick(v, ['shareCount', 'shares']),
    },
    thumbnail: pick(v?.videoMeta || v, ['coverUrl', 'cover', 'originalCoverUrl']),
    raw: v,
  };
}

/** Scrape top TikTok comments for a post. Best-effort: returns [] on failure. */
export async function scrapeTikTokComments(url, max = 40) {
  try {
    const items = await runActor(TIKTOK_COMMENTS_ACTOR, {
      postURLs: [url],
      commentsPerPost: max,
      maxRepliesPerComment: 0,
    });
    return items
      .map((c) => ({
        text: pick(c, ['text', 'comment']) || '',
        likes: pick(c, ['diggCount', 'likesCount', 'likes']) ?? 0,
        author: pick(c, ['uniqueId', 'username', 'nickName']) || '',
        likedByAuthor: Boolean(c.likedByAuthor),
        pinned: Boolean(c.pinnedByAuthor || c.pinned),
        replies: pick(c, ['replyCommentTotal', 'repliesCount']) ?? 0,
      }))
      .filter((c) => c.text)
      .sort((a, b) => (b.likes || 0) - (a.likes || 0));
  } catch (e) {
    console.warn('Comment scrape skipped:', e.message);
    return [];
  }
}

async function scrapeInstagram(url) {
  const items = await runActor(INSTAGRAM_ACTOR, {
    directUrls: [url],
    resultsType: 'posts',
    resultsLimit: 1,
    addParentData: false,
  });
  const v = items[0] || {};
  const caption = pick(v, ['caption', 'text']) || '';
  const videoUrl = pick(v, ['videoUrl']) || (Array.isArray(v.videoUrls) && v.videoUrls[0]) || undefined;
  // Instagram scraper returns comments inline (no separate actor needed).
  const comments = (v.latestComments || [])
    .map((c) => ({
      text: c.text || '',
      likes: c.likesCount ?? 0,
      author: c.ownerUsername || '',
      pinned: false,
      replies: c.repliesCount ?? (Array.isArray(c.replies) ? c.replies.length : 0),
    }))
    .filter((c) => c.text)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0));

  return {
    platform: 'instagram',
    videoUrl,
    subtitleUrl: '', // Instagram has no VTT — Gemini transcribes from audio.
    url: pick(v, ['url']) || url,
    title: caption.split('\n')[0] || '',
    author: v.ownerUsername || '',
    description: caption,
    hashtags: extractHashtags(caption, v.hashtags),
    durationSeconds: v.videoDuration ? Math.round(v.videoDuration) : undefined,
    stats: {
      views: pick(v, ['videoViewCount', 'videoPlayCount']),
      likes: pick(v, ['likesCount']),
      comments: pick(v, ['commentsCount']),
    },
    thumbnail: pick(v, ['displayUrl']),
    comments,
    raw: v,
  };
}

/** Scrape a YouTube, TikTok, or Instagram URL into a normalized content object. */
export async function scrapeContent(url) {
  const platform = detectPlatform(url);
  if (platform === 'youtube') return scrapeYouTube(url);
  if (platform === 'tiktok') return scrapeTikTok(url);
  if (platform === 'instagram') return scrapeInstagram(url);
  throw new Error('Unsupported URL. Provide a TikTok or Instagram link.');
}

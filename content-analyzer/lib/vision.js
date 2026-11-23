import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let _ai = null;
function ai() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set.');
    }
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VISION_PROMPT = `You are analyzing a short social-media video frame-by-frame as it plays.
Watch the whole clip and report what is actually on screen — do not guess beyond what is visible.
Produce a concise but complete rundown covering:

1. ON-SCREEN TEXT: every caption, title card, subtitle, or graphic text that appears, quoted verbatim, in the order it appears.
2. PEOPLE & ACTIONS: who is on screen and what they physically do, as a short timeline (e.g. "0:00-0:03 …").
3. SETTING & BACKGROUND: location, environment, props, lighting, and overall mood.
4. PRODUCTS / OBJECTS: any visible products, brands, or notable objects.
5. VISUAL STYLE: shot types, editing pace, transitions, color/aesthetic.

Keep it factual and specific. If something is unclear, say so.`;

/**
 * Analyze a video's visual content with Gemini.
 * @param {Buffer} videoBuffer - the mp4 bytes
 * @param {string} mimeType
 * @returns {Promise<string>} a text description of the on-screen content
 */
export async function analyzeVideoVisual(videoBuffer, mimeType = 'video/mp4') {
  const client = ai();

  // Upload via the Files API and wait until it finishes processing.
  let file = await client.files.upload({
    file: new Blob([videoBuffer], { type: mimeType }),
    config: { mimeType },
  });

  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await sleep(2000);
    file = await client.files.get({ name: file.name });
  }
  if (file.state !== 'ACTIVE') {
    throw new Error(`Gemini could not process the video (state: ${file.state}).`);
  }

  const response = await client.models.generateContent({
    model: MODEL,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      VISION_PROMPT,
    ]),
  });

  return response.text;
}

const BROWSER_HEADERS = {
  // Some CDNs reject default fetch UAs.
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.tiktok.com/',
};

/** Apify key-value-store records may require the token appended. */
function withApifyToken(url) {
  try {
    const u = new URL(url);
    const token = String(process.env.APIFY_TOKEN || '').trim();
    if (u.hostname === 'api.apify.com' && token && !u.searchParams.has('token')) {
      u.searchParams.set('token', token);
      return u.toString();
    }
  } catch {
    /* leave url as-is */
  }
  return url;
}

/** Download a video file from a direct URL into a Buffer. */
export async function downloadVideo(url) {
  const res = await fetch(withApifyToken(url), { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Video download failed (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fetch a subtitle/VTT file as text (best-effort). Returns '' on failure. */
export async function fetchSubtitles(url) {
  if (!url) return '';
  try {
    const res = await fetch(withApifyToken(url), { headers: BROWSER_HEADERS });
    if (!res.ok) return '';
    return (await res.text()).trim();
  } catch {
    return '';
  }
}

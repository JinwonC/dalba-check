import { checkApifyToken } from '../lib/apify.js';

// GET /api/health → which keys are set. Add ?check=apify to verify the Apify token against Apify
// (reports the Apify username it belongs to, never the token).
export default async function handler(req, res) {
  const out = {
    ok: true,
    apify: Boolean(String(process.env.APIFY_TOKEN || '').trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
  if (req.query?.check === 'apify') out.apifyCheck = await checkApifyToken();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}

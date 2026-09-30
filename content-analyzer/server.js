import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runScrape, runReport, runComments, runAnalysis, runGuide, runHookStack, runDna, runStylePass, HttpError } from './lib/pipeline.js';
import { pushToDrive, driveEnabled } from './lib/drive.js';
import { guideToPlainText } from './lib/guideText.js';
import { saveAnalysis, listAnalyses, getAnalysis, deleteAnalysis, migrateLegacyToUpstash } from './lib/store.js';
import uploadHandler from './api/upload.js';
import { loadRates } from './lib/rates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const send = (res, err) => {
  const status = err instanceof HttpError ? err.status : 502;
  if (status >= 500) console.error('Request failed:', err);
  res.status(status).json({ error: err.message || 'Request failed.' });
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, apify: Boolean(process.env.APIFY_TOKEN), gemini: Boolean(process.env.GEMINI_API_KEY) });
});

app.post('/api/scrape', async (req, res) => {
  try { res.json(await runScrape({ url: req.body?.url })); }
  catch (err) { send(res, err); }
});

app.post('/api/upload', (req, res) => uploadHandler(req, res));

app.post('/api/report', async (req, res) => {
  try {
    const { videoUrl, subtitleUrl, meta, videoId } = req.body || {};
    res.json(await runReport({ videoUrl, subtitleUrl, meta, videoId }));
  } catch (err) { send(res, err); }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { url, meta, comments } = req.body || {};
    res.json(await runComments({ url, meta, comments }));
  } catch (err) { send(res, err); }
});

app.post('/api/save', async (req, res) => {
  try {
    const { meta, embed, report, comments, video } = req.body || {};
    res.json(await saveAnalysis({ meta, embed, report, comments, video }));
  } catch (err) { send(res, err); }
});

app.get('/api/history', async (_req, res) => {
  try { res.json({ items: await listAnalyses() }); }
  catch (err) { send(res, err); }
});

app.get('/api/rates', async (req, res) => {
  try { res.json(await loadRates({ refresh: req.query.refresh === '1' })); }
  catch (err) { send(res, err); }
});

app.get('/api/analysis', async (req, res) => {
  try {
    const rec = await getAnalysis(String(req.query.id || ''));
    if (!rec) return res.status(404).json({ error: 'Not found.' });
    res.json(rec);
  } catch (err) { send(res, err); }
});

app.post('/api/delete', async (req, res) => {
  try {
    const ok = await deleteAnalysis(String(req.body?.id || ''));
    res.json({ ok });
  } catch (err) { send(res, err); }
});

app.post('/api/migrate', async (_req, res) => {
  try { res.json({ ok: true, ...(await migrateLegacyToUpstash()) }); }
  catch (err) { send(res, err); }
});


app.post('/api/hookstack', async (req, res) => {
  try {
    const { hookReports, productInfo, language, meta } = req.body || {};
    res.json(await runHookStack({ hookReports, productInfo, language, meta }));
  } catch (err) { send(res, err); }
});

app.post('/api/dna', async (req, res) => {
  try { res.json(await runDna({ creatorReports: req.body?.creatorReports })); }
  catch (err) { send(res, err); }
});

app.post('/api/stylepass', async (req, res) => {
  try { res.json(await runStylePass({ videoUrl: req.body?.videoUrl })); }
  catch (err) { send(res, err); }
});

app.post('/api/guide', async (req, res) => {
  try {
    const { stackedHooks, bodyReport, styleDna, productInfo, meta } = req.body || {};
    res.json(await runGuide({ stackedHooks, bodyReport, styleDna, productInfo, meta }));
  } catch (err) { send(res, err); }
});

app.post('/api/guide-save', async (req, res) => {
  try {
    const { guide = {}, meta = {} } = req.body || {};
    if (!driveEnabled()) return res.json({ driveUrl: null });
    const title = `[가이드] ${guide.creator ? '@' + guide.creator + ' 스타일' : ''} — ${meta.product || guide?.product?.name || 'Contents Brief'}`.slice(0, 90);
    const driveUrl = await pushToDrive({ title, text: guideToPlainText(guide, meta) }).catch(() => null);
    res.json({ driveUrl });
  } catch (err) { send(res, err); }
});

// One-shot (local/testing only; too slow for a single serverless call).
app.post('/api/analyze', async (req, res) => {
  try { res.json(await runAnalysis({ url: req.body?.url })); }
  catch (err) { send(res, err); }
});

app.listen(PORT, () => {
  console.log(`d'Alba Content Analyzer running at http://localhost:${PORT}`);
  if (!process.env.APIFY_TOKEN) console.warn('⚠  APIFY_TOKEN not set — scraping will fail');
  if (!process.env.GEMINI_API_KEY) console.warn('⚠  GEMINI_API_KEY not set — report generation will fail');
});

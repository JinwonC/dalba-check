// GET /api/videos?from=YYYY-MM-DD&to=YYYY-MM-DD&minGmv=0
import { readVideoTable, readReviews } from '../../lib/sheets';

function num(x) {
  const v = parseFloat(String(x == null ? '' : x).replace(/[$,%\s]/g, ''));
  return isNaN(v) ? 0 : v;
}
// "2023-11-09 19:03:59" / "2024-1-5 6:15" 등 → "YYYY-MM-DD"
function toDate(x) {
  const s = String(x == null ? '' : x).trim();
  if (!s) return '';
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return s.slice(0, 10);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const { header, rows } = await readVideoTable();
    const reviews = await readReviews();
    const H = {};
    header.forEach((h, i) => { H[String(h).trim()] = i; });
    const g = (row, name) => (H[name] != null ? row[H[name]] : '');

    const from = req.query.from || '2000-01-01';
    const to = req.query.to || '2999-12-31';
    const minGmv = num(req.query.minGmv || '0');

    const out = [];
    for (const row of rows) {
      const id = String(g(row, 'id') || '').replace(/^'/, '').trim();
      if (!id) continue;
      const post = toDate(g(row, 'video_post_time'));
      if (!post || post < from || post > to) continue;
      const gmv = num(g(row, 'gmv.amount'));
      if (gmv < minGmv) continue;
      const rv = reviews[id] || {};
      out.push({
        id,
        title: g(row, 'title') || '',
        handle: g(row, 'username') || '',
        creator: g(row, 'creator.nick_name') || '',
        product: g(row, 'products') || '',
        postDate: post,
        views: num(g(row, 'views')),
        gmv,
        gpm: num(g(row, 'gpm.amount')),
        units: num(g(row, 'items_sold')),
        orders: num(g(row, 'sku_orders')),
        ctr: g(row, 'click_through_rate') || '',
        link: g(row, 'Video Link') || `https://www.tiktok.com/@${g(row, 'username')}/video/${id}`,
        rating: rv.rating || '',
        note: rv.note || '',
      });
    }
    out.sort((a, b) => b.gmv - a.gmv);
    res.status(200).json({ count: out.length, videos: out.slice(0, 2000) });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e), detail: String((e && e.stack) || '').split('\n').slice(0, 4) });
  }
}

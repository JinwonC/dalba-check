// Creator rate card — reads the casting tab of the team sheet (link-shared) as CSV.
// Only rate-related columns leave this module; PII tabs/columns are never read or returned.

const SHEET_ID = process.env.RATE_SHEET_ID || '1JFq6m2-rvSpiGKQsTpr91Hj-RckHpqFfEl_BLkQI_hs';
const SHEET_TAB = process.env.RATE_SHEET_TAB || '유가 캐스팅 (casting)';
const TTL_MS = 5 * 60 * 1000;

let _cache = null; // { at, data }

/** RFC4180-ish CSV parser (handles quoted commas, quotes and newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toNum(s) {
  const t = String(s ?? '').trim().replace(/[$,\s]/g, '');
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let v = Number(m[0]);
  if (/k$/i.test(t)) v *= 1000;
  return Number.isFinite(v) ? v : null;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// Header name → fallback column letter (used if the header text is changed).
const COLS = {
  type: ['협업유형', 'I'],
  persona: ['페르소나', 'K'],
  month: ['월', 'L'],
  manager: ['담당자', 'M'],
  handle: ['creatorhandle', 'N'],
  round: ['회차', 'Q'],
  status: ['진행현황', 'R'],
  videos: ['계약영상수', 'X'],
  ratePre: ['네고전rate', 'Y'],
  ratePost: ['네고후rate', 'Z'],
  perVideo: ['개당단가', 'AA'],
  commission: ['commission', 'AB'],
  gmv: ['gmv', 'AC'],
  avgViews: ['평균조회수', 'AE'],
};

const letterIdx = (L) => [...L].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

function resolveColumns(header) {
  const h = header.map(norm);
  const out = {};
  for (const [key, [name, letter]] of Object.entries(COLS)) {
    // exact match first (e.g. "월" must not match "8월 목표수량"), then prefix match.
    let i = h.findIndex((x) => x === name);
    if (i < 0) i = h.findIndex((x) => x.startsWith(name));
    out[key] = i >= 0 ? i : letterIdx(letter);
  }
  return out;
}

// Deals that actually happened vs. asks that never closed.
const CLOSED = ['협업진행중', '협업진행완료', 'confirmed', '컨펌완료', 'collaborationinprogress', 'collaborationcompleted'];

export async function loadRates({ refresh = false } = {}) {
  if (!refresh && _cache && Date.now() - _cache.at < TTL_MS) return _cache.data;

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`시트를 읽지 못했어요 (HTTP ${res.status}). 시트 공유 설정(링크 있는 사용자 보기)을 확인해주세요.`);
  const text = await res.text();
  if (/^\s*<!doctype html/i.test(text)) throw new Error('시트가 비공개라 읽을 수 없어요. "링크가 있는 모든 사용자 – 뷰어"로 공유해주세요.');

  const rows = parseCsv(text);
  const c = resolveColumns(rows[0] || []);
  const cell = (r, k) => String(r[c[k]] ?? '').trim();

  const deals = [];
  for (const r of rows.slice(1)) {
    const gmv = toNum(cell(r, 'gmv'));
    const perVideo = toNum(cell(r, 'perVideo'));
    const handle = cell(r, 'handle').replace(/^@/, '');
    if (!handle || gmv === null || perVideo === null || perVideo <= 0) continue;
    const status = cell(r, 'status');
    deals.push({
      handle,
      gmv,
      perVideo,
      videos: toNum(cell(r, 'videos')),
      total: toNum(cell(r, 'ratePost')) ?? toNum(cell(r, 'ratePre')),
      commission: cell(r, 'commission'),
      type: cell(r, 'type'),
      status,
      closed: CLOSED.includes(norm(status)),
      month: cell(r, 'month'),
      round: cell(r, 'round'),
      manager: cell(r, 'manager'),
      persona: cell(r, 'persona'),
      avgViews: toNum(cell(r, 'avgViews')),
    });
  }

  const data = { deals, tab: SHEET_TAB, fetchedAt: new Date().toISOString() };
  _cache = { at: Date.now(), data };
  return data;
}

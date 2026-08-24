// Google Sheets 접근 (google-auth-library + REST fetch, 경량)
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID = process.env.SHEET_ID || '1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g';
// 영상 데이터 원본 탭. 헤더가 1행이 아니라 2행에 있음(1행은 배너), 데이터는 3행부터.
const TAB_NAME = process.env.SHEET_TAB || 'pickdi video list';
const HEADER_ROW = parseInt(process.env.SHEET_HEADER_ROW || '2', 10);
// 상/중/하 평가 + 특이사항은 별도 탭에 저장(매일 자동적재가 원본을 덮어써도 안전).
const REVIEW_TAB = process.env.REVIEW_TAB || '영상리뷰';
// 원본이 사라져도 완결되도록 크리에이터/핸들/링크/제목/게시일까지 스냅샷 저장.
const REVIEW_HEADER = ['id', 'video_post_time', 'creator', 'handle', 'video_link', 'title', '평가', '특이사항', 'updated'];
const RC = REVIEW_HEADER.length; // 9 (A:I)
const LAST_COL = 'I';

const enc = encodeURIComponent;
const q = (name) => "'" + String(name).replace(/'/g, "''") + "'";

async function token() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env 없음');
  const creds = JSON.parse(raw);
  const auth = new GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: (creds.private_key || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return typeof t === 'string' ? t : t.token;
}

async function api(path, opts = {}) {
  const tk = await token();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

export function colLetter(i) {
  let n = i + 1, s = '';
  while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// 원본 영상 탭을 읽어 { header, rows } 반환 (header=HEADER_ROW행, rows=그 아래 데이터행)
export async function readVideoTable() {
  const j = await api(`/values/${enc(q(TAB_NAME))}`);
  const all = j.values || [];
  const header = all[HEADER_ROW - 1] || [];
  const rows = all.slice(HEADER_ROW);
  return { header, rows };
}

// ── 별도 리뷰 탭 (자기완결: id·게시일·크리에이터·핸들·링크·제목·평가·특이사항) ──
async function batchUpdate(body) {
  const tk = await token();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function updateRange(rangeA1, values) {
  await api(`/values/${enc(rangeA1)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
}

async function appendRow(values) {
  await api(`/values/${enc(q(REVIEW_TAB))}!A:${LAST_COL}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [values] }),
  });
}

// 리뷰 탭 읽기 + 신 스키마 보장(구 4열이면 자동 마이그레이션). { header, rows(데이터만) } 반환.
async function readReviewRows() {
  let all;
  try {
    all = (await api(`/values/${enc(q(REVIEW_TAB))}!A:${LAST_COL}`)).values || [];
  } catch (e) {
    if (/Unable to parse range/i.test(String(e.message || ''))) {
      await batchUpdate({ requests: [{ addSheet: { properties: { title: REVIEW_TAB } } }] });
      await updateRange(`${q(REVIEW_TAB)}!A1:${LAST_COL}1`, [REVIEW_HEADER]);
      return { rows: [] };
    }
    throw e;
  }
  if (!all.length) {
    await updateRange(`${q(REVIEW_TAB)}!A1:${LAST_COL}1`, [REVIEW_HEADER]);
    return { rows: [] };
  }
  const header = all[0];
  const data = all.slice(1);
  const isNew = header[6] === '평가' && header[7] === '특이사항' && header.length >= RC;
  if (isNew) return { rows: data };
  // 구 스키마 → 신 스키마 마이그레이션 (평가/특이사항 보존)
  const oId = header.indexOf('id'), oRate = header.indexOf('평가'), oNote = header.indexOf('특이사항');
  const migrated = data
    .filter((r) => r && String(r[oId >= 0 ? oId : 0] || '').trim())
    .map((r) => {
      const row = new Array(RC).fill('');
      row[0] = r[oId >= 0 ? oId : 0] || '';
      row[6] = oRate >= 0 ? (r[oRate] || '') : '';
      row[7] = oNote >= 0 ? (r[oNote] || '') : '';
      return row;
    });
  await updateRange(`${q(REVIEW_TAB)}!A1:${LAST_COL}${migrated.length + 1}`, [REVIEW_HEADER, ...migrated]);
  return { rows: migrated };
}

// 리뷰 탭 전체를 { id: {rating, note} } 맵으로 (조회용, 헤더명 기준으로 구/신 모두 대응)
export async function readReviews() {
  let all;
  try {
    all = (await api(`/values/${enc(q(REVIEW_TAB))}!A:${LAST_COL}`)).values || [];
  } catch (e) {
    if (/Unable to parse range/i.test(String(e.message || ''))) return {};
    throw e;
  }
  if (all.length < 1) return {};
  const header = all[0];
  const iId = header.indexOf('id'), iRate = header.indexOf('평가'), iNote = header.indexOf('특이사항');
  const map = {};
  for (let r = 1; r < all.length; r++) {
    const row = all[r] || [];
    const id = String(row[iId >= 0 ? iId : 0] || '').replace(/^'/, '');
    if (id) map[id] = { rating: row[iRate >= 0 ? iRate : 1] || '', note: row[iNote >= 0 ? iNote : 2] || '' };
  }
  return map;
}

// id 기준 upsert. rating/note 는 전달된 것만 갱신, meta(스냅샷)는 항상 최신값으로 보강.
export async function upsertReview(id, rating, note, meta = {}) {
  const { rows } = await readReviewRows();
  let rowNum = -1, cur = null;
  for (let r = 0; r < rows.length; r++) {
    const v = String((rows[r] && rows[r][0]) || '').replace(/^'/, '');
    if (v === String(id)) { rowNum = r + 2; cur = rows[r]; break; } // +2: 헤더(1행) + 0-index
  }
  const keep = (i) => (cur && cur[i] != null ? cur[i] : '');
  const pick = (val, i) => (val !== undefined && val !== '' ? val : keep(i));
  const rowVals = [
    String(id),
    pick(meta.postDate, 1),
    pick(meta.creator, 2),
    pick(meta.handle, 3),
    pick(meta.link, 4),
    pick(meta.title, 5),
    rating !== undefined ? rating : keep(6),
    note !== undefined ? note : keep(7),
    new Date().toISOString(),
  ];
  if (rowNum === -1) { await appendRow(rowVals); return { created: true }; }
  await updateRange(`${q(REVIEW_TAB)}!A${rowNum}:${LAST_COL}${rowNum}`, [rowVals]);
  return { updated: true, row: rowNum };
}

export { SHEET_ID, TAB_NAME as TAB, REVIEW_TAB };

import { useState, useEffect, useCallback, useRef, memo } from 'react';

const RATINGS = ['상', '중', '하'];
const fmt = (n) => (n || 0).toLocaleString();
const money = (n) => '$' + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const PAGE = 300;

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const [from, setFrom] = useState(todayStr(-30));
  const [to, setTo] = useState(todayStr(0));
  const [minGmv, setMinGmv] = useState(0);
  const [rows, setRows] = useState([]);          // 영상 데이터 (로드 후 불변)
  const [reviews, setReviews] = useState({});    // { id: {rating, note} } — 평가/특이사항만 따로
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(0);     // 진행 중인 백그라운드 저장 수
  const [err, setErr] = useState('');
  const [appKey, setAppKey] = useState('');

  useEffect(() => {
    try { setAppKey(localStorage.getItem('appKey') || ''); } catch (e) {}
  }, []);

  const headers = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (appKey) h['x-app-key'] = appKey;
    return h;
  }, [appKey]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const q = new URLSearchParams({ from, to, minGmv: String(minGmv) });
      const r = await fetch('/api/videos?' + q, { headers: headers() });
      if (r.status === 401) {
        const k = prompt('접근 키를 입력하세요');
        if (k) { localStorage.setItem('appKey', k); setAppKey(k); }
        setLoading(false); return;
      }
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const vids = j.videos || [];
      setRows(vids);
      setCount(j.count || 0);
      setVisible(PAGE);
      const rv = {}; const mt = {};
      for (const v of vids) {
        rv[v.id] = { rating: v.rating || '', note: v.note || '' };
        mt[v.id] = {
          postDate: v.postDate || '', creator: v.creator || '', handle: v.handle || '',
          link: v.link || (v.handle ? `https://www.tiktok.com/@${v.handle}/video/${v.id}` : ''),
          title: v.title || '',
        };
      }
      setReviews(rv);
      metaRef.current = mt;
    } catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }, [from, to, minGmv, headers]);

  // 날짜/최소GMV 변경 시 자동 재조회(400ms 디바운스)
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 400);
    return () => clearTimeout(t);
  }, [from, to, minGmv, load]);

  // ── 배치 저장 큐 ──────────────────────────────────────────
  const pendingRef = useRef({});   // { id: {rating?, note?} }
  const timerRef = useRef(null);
  const metaRef = useRef({});       // { id: {postDate,creator,handle,link,title} } — 스냅샷

  const flush = useCallback(async () => {
    const batch = pendingRef.current;
    pendingRef.current = {};
    const ids = Object.keys(batch);
    if (!ids.length) return;
    setSyncing((s) => s + ids.length);
    await Promise.all(ids.map((id) =>
      fetch('/api/review', { method: 'POST', headers: headers(), body: JSON.stringify({ id, ...batch[id], meta: metaRef.current[id] }) })
        .then((r) => r.json())
        .then((j) => { if (!j.ok) throw new Error(j.error || 'fail'); })
        .catch((e) => { setErr('저장 실패: ' + (e.message || e)); })
        .finally(() => setSyncing((s) => Math.max(0, s - 1)))
    ));
  }, [headers]);

  // 낙관적 로컬 반영 + 700ms 디바운스 후 백그라운드 배치 저장 (UI는 안 기다림)
  const queueSave = useCallback((id, patch) => {
    setReviews((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
    pendingRef.current[id] = { ...(pendingRef.current[id] || {}), ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 700);
  }, [flush]);

  const onRate = useCallback((id, rt) => {
    setReviews((prev) => {
      const curr = (prev[id] && prev[id].rating) || '';
      const next = curr === rt ? '' : rt;
      pendingRef.current[id] = { ...(pendingRef.current[id] || {}), rating: next };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 700);
      return { ...prev, [id]: { ...(prev[id] || {}), rating: next } };
    });
  }, [flush]);

  const onNote = useCallback((id, note) => { queueSave(id, { note }); }, [queueSave]);

  const shown = Math.min(visible, rows.length);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20, maxWidth: 1400, margin: '0 auto', color: '#111' }}>
      <h2 style={{ margin: '0 0 4px' }}>d'Alba 영상 성과 · 크리에이터 평가</h2>
      <div style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        pickdi video list 시트 기반 · 평가·특이사항은 백그라운드로 리뷰 탭에 자동 저장됩니다
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label>게시일 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <span>~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <label style={{ marginLeft: 8 }}>
          최소 GMV $<input type="number" value={minGmv} onChange={(e) => setMinGmv(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <button onClick={load} disabled={loading} style={btn}>{loading ? '불러오는 중…' : '새로고침'}</button>
        <span style={{ color: '#888', fontSize: 13 }}>{count.toLocaleString()}건 (표시 {shown.toLocaleString()})</span>
        <span style={{ fontSize: 13, color: syncing ? '#9a6700' : '#1a7f37' }}>
          {syncing ? `● 동기화 중 ${syncing}` : '✓ 저장됨'}
        </span>
      </div>

      {err && <div style={{ color: '#c00', marginBottom: 10 }}>오류: {err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f5f5f7', textAlign: 'left' }}>
              {['영상', '핸들', '상품ID', '게시일', '조회수', 'GMV', 'GPM', '주문수', '평가', '특이사항'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visible).map((v) => (
              <VideoRow key={v.id} v={v} review={reviews[v.id]} onRate={onRate} onNote={onNote} />
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={10} style={{ ...td, color: '#999', padding: 30, textAlign: 'center' }}>데이터 없음 — 날짜/최소GMV를 조정하세요</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {visible < rows.length && (
        <div style={{ textAlign: 'center', margin: '16px 0' }}>
          <button onClick={() => setVisible((n) => n + PAGE)} style={btn}>더 보기 (+{Math.min(PAGE, rows.length - visible)})</button>
        </div>
      )}
    </div>
  );
}

// 행 memo: v(불변)·review(해당 id만 새 참조)·onRate/onNote(고정) → 바뀐 행 1개만 리렌더
const VideoRow = memo(function VideoRow({ v, review, onRate, onNote }) {
  const rating = (review && review.rating) || '';
  const note = (review && review.note) || '';
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ ...td, maxWidth: 260 }}>
        <a href={v.link || `https://www.tiktok.com/@${v.handle}/video/${v.id}`} target="_blank" rel="noreferrer"
           style={{ color: '#0a58ca', textDecoration: 'none' }} title={v.title}>
          {v.title ? v.title.slice(0, 40) : '(제목없음)'}
        </a>
      </td>
      <td style={td}>{v.handle}</td>
      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.product}>{v.product}</td>
      <td style={td}>{v.postDate}</td>
      <td style={tdR}>{fmt(v.views)}</td>
      <td style={{ ...tdR, fontWeight: 600 }}>{money(v.gmv)}</td>
      <td style={tdR}>{v.gpm ? '$' + v.gpm.toFixed(2) : '-'}</td>
      <td style={tdR}>{fmt(v.orders)}</td>
      <td style={td}>
        <div style={{ display: 'flex', gap: 3 }}>
          {RATINGS.map((rt) => (
            <button key={rt} onClick={() => onRate(v.id, rt)}
              style={{ ...pill, ...(rating === rt ? pillOn(rt) : {}) }}>{rt}</button>
          ))}
        </div>
      </td>
      <td style={td}><NoteCell id={v.id} value={note} onNote={onNote} /></td>
    </tr>
  );
});

// 타이핑은 100% 로컬. 포커스 아웃(blur) 시에만 상위로 올려 백그라운드 저장.
const NoteCell = memo(function NoteCell({ id, value, onNote }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  const commit = () => { if (draft !== (value || '')) onNote(id, draft); };
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      rows={1}
      placeholder="특이사항… (칸 밖 클릭 시 저장)"
      style={{ width: 210, resize: 'vertical', fontSize: 12, padding: 4 }}
    />
  );
});

const th = { padding: '8px 8px', borderBottom: '2px solid #ddd', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', verticalAlign: 'top' };
const tdR = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const btn = { padding: '6px 14px', border: '1px solid #ccc', borderRadius: 6, background: '#111', color: '#fff', cursor: 'pointer' };
const pill = { padding: '3px 9px', border: '1px solid #ccc', borderRadius: 12, background: '#fff', cursor: 'pointer', fontSize: 12 };
const pillOn = (rt) => ({
  background: rt === '상' ? '#1a7f37' : rt === '중' ? '#9a6700' : '#b62324',
  color: '#fff', borderColor: 'transparent', fontWeight: 700,
});

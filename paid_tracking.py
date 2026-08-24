"""PAID 성과 트래킹 (GMV) 탭 자동 채움

- 소스: Ads 시트 '광고소재성과' 탭 (소재ID=영상ID, 일별). TikTok API 호출 없음.
- 대상: 트래킹 시트 'PAID 성과 트래킹 (GMV)' (2행 헤더, 3행부터 데이터). J열 Video ID 기준.

(1) 총합 M~T  : 영상ID별 전체기간 합산
(2) 주차별 블록: U열부터 오른쪽에 '최근 N주(ISO, 월~일)' 블록을 자동 생성/갱신.
      각 블록 8열 = Impression·Click·CTR·CVR·광고비·Revenue·ROI·Order
      1행=주차 라벨(예 '34주차 8/17~8/23'), 2행=지표명, 3행부터 그 주 값.
      매 실행 시 U열부터 싹 지우고 최근 N주만 다시 씀(롤링 → 폭 안 늘어남).

집계(각 지표):
    Impression=Σ상품노출수  Click=Σ상품클릭수  CTR=Click/Imp*100  CVR=Order/Click*100
    광고비=Σ지출금액  Revenue=Σ총매출  ROI=Revenue/광고비  Order=Σ주문수

사용:
  python paid_tracking.py            # dry-run (샘플 로그만)
  python paid_tracking.py write      # 실제 기록
"""
import sys
import time
from datetime import date, datetime, timedelta, timezone

import gspread
from google.oauth2.service_account import Credentials

SERVICE_ACCOUNT_FILE = "service_account.json"

ADS_SPREADSHEET_ID = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"
ADS_TAB = "광고소재성과"

DST_SPREADSHEET_ID = "1JFq6m2-rvSpiGKQsTpr91Hj-RckHpqFfEl_BLkQI_hs"
DST_TAB = "PAID 성과 트래킹 (GMV)"
DST_HEADER_ROW = 2          # 1행 배너 / 2행 헤더 / 3행부터 데이터
DST_VIDEO_COL = "J"         # Video ID
TOTAL_FIRST_C = 12          # M (0-based) 총합 첫 열
WEEK_FIRST_C = 20           # U (0-based) 주차 블록 시작 열
WEEKS_N = 8                 # 최근 몇 주
LA_TZ = timezone(timedelta(hours=-8))

METRICS = ["Impression", "Click", "CTR", "CVR", "광고비", "Revenue", "ROI", "Order"]
# 열별 숫자서식(총합/주차 공통, 8열 반복)
PATTERNS = ["#,##0", "#,##0", '0.00"%"', '0.00"%"', '"$"#,##0.00', '"$"#,##0.00', "0.00", "#,##0"]


def num(x):
    s = str(x if x is not None else "").replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def col_idx(letter):
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def to_letter(idx0):
    n, s = idx0 + 1, ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def metrics_from(a):
    """a=[imp,clk,cost,ord,rev] → [Imp,Clk,CTR,CVR,광고비,Rev,ROI,Order]"""
    imp, clk, cost, ordc, rev = a
    ctr = (clk / imp * 100) if imp else 0
    cvr = (ordc / clk * 100) if clk else 0
    roi = (rev / cost) if cost else 0
    return [round(imp), round(clk), round(ctr, 2), round(cvr, 2),
            round(cost, 2), round(rev, 2), round(roi, 2), round(ordc)]


def recent_weeks(n):
    """오늘(LA) 기준 최근 n개 ISO주. 오래된→최신 순. 각: (key, label, mon, sun)."""
    today = datetime.now(LA_TZ).date()
    monday = today - timedelta(days=today.weekday())
    out = []
    for i in range(n - 1, -1, -1):
        mon = monday - timedelta(days=7 * i)
        sun = mon + timedelta(days=6)
        iso = mon.isocalendar()
        key = (iso[0], iso[1])
        label = f"{iso[1]}주차\n{mon.month}/{mon.day}~{sun.month}/{sun.day}"
        out.append((key, label, mon, sun))
    return out


def with_retry(fn, label):
    for attempt in range(1, 9):
        try:
            return fn()
        except Exception as e:
            if attempt == 8:
                raise
            wait = min(3 * attempt, 30)
            print(f"    {label} 실패 (시도 {attempt}/8), {wait}초 후 재시도... ({e})", flush=True)
            time.sleep(wait)


def main():
    write = (len(sys.argv) > 1 and sys.argv[1] == "write")
    print(f"=== PAID 트래킹 [{'실제기록' if write else 'DRY-RUN'}] ===", flush=True)

    weeks = recent_weeks(WEEKS_N)
    wk_keys = {k for k, _, _, _ in weeks}
    print("  주차:", ", ".join(f"{lb.splitlines()[0]}({mo}~{su})" for _, lb, mo, su in weeks), flush=True)

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    gc = gspread.authorize(creds)

    # 1) 광고소재성과 1패스 집계 (총합 + 주차별)
    ads = gc.open_by_key(ADS_SPREADSHEET_ID).worksheet(ADS_TAB)
    ads_vals = with_retry(lambda: ads.get_all_values(), "광고소재성과 읽기")
    if not ads_vals:
        print("  광고소재성과 비어있음"); return
    ah = ads_vals[0]

    def a_idx(name):
        return ah.index(name) if name in ah else -1
    i_date = a_idx("날짜")
    i_id = a_idx("소재ID")
    i_cost = a_idx("지출금액")
    i_ord = a_idx("주문수")
    i_rev = a_idx("총매출(GMV)")
    i_imp = a_idx("상품노출수")
    i_clk = a_idx("상품클릭수")
    if min(i_date, i_id, i_cost, i_ord, i_rev, i_imp, i_clk) < 0:
        print(f"  ❌ 광고소재성과 헤더 열 못 찾음: {ah}"); sys.exit(1)

    def blank():
        return [0.0, 0.0, 0.0, 0.0, 0.0]

    total = {}                      # vid -> [imp,clk,cost,ord,rev]
    weekly = {k: {} for k in wk_keys}   # wk_key -> {vid: [...]}
    for row in ads_vals[1:]:
        if len(row) <= i_id:
            continue
        vid = str(row[i_id]).strip().lstrip("'")
        if not (vid.isdigit() and len(vid) >= 18):
            continue
        imp = num(row[i_imp]) if len(row) > i_imp else 0
        clk = num(row[i_clk]) if len(row) > i_clk else 0
        cost = num(row[i_cost]) if len(row) > i_cost else 0
        ordc = num(row[i_ord]) if len(row) > i_ord else 0
        rev = num(row[i_rev]) if len(row) > i_rev else 0

        t = total.setdefault(vid, blank())
        t[0] += imp; t[1] += clk; t[2] += cost; t[3] += ordc; t[4] += rev

        ds = str(row[i_date])[:10] if len(row) > i_date else ""
        try:
            wk = datetime.strptime(ds, "%Y-%m-%d").date().isocalendar()
            wkey = (wk[0], wk[1])
        except ValueError:
            continue
        if wkey in weekly:
            w = weekly[wkey].setdefault(vid, blank())
            w[0] += imp; w[1] += clk; w[2] += cost; w[3] += ordc; w[4] += rev
    print(f"  광고소재성과 {len(ads_vals)-1}행 → 총합 영상 {len(total)}개", flush=True)

    # 2) 트래킹 J열 읽기
    dst = gc.open_by_key(DST_SPREADSHEET_ID).worksheet(DST_TAB)
    col_vals = with_retry(lambda: dst.col_values(col_idx(DST_VIDEO_COL) + 1), "트래킹 J열 읽기")
    last_row = len(col_vals)

    # 3) 총합 M~T
    tot_updates = []
    matched = 0
    for r in range(DST_HEADER_ROW, last_row):
        vid = str(col_vals[r]).strip().lstrip("'")
        if not (vid.isdigit() and len(vid) >= 18):
            continue
        a = total.get(vid)
        if not a:
            continue
        matched += 1
        rng = f"'{DST_TAB}'!{to_letter(TOTAL_FIRST_C)}{r+1}:{to_letter(TOTAL_FIRST_C+7)}{r+1}"
        tot_updates.append({"range": rng, "values": [metrics_from(a)]})
    print(f"  총합 매칭 {matched}개", flush=True)

    # 4) 주차별 블록 매트릭스 (U1부터). 1행 라벨 / 2행 지표명 / 3행+ 값
    n_cols = WEEKS_N * 8
    mat = [["" for _ in range(n_cols)] for _ in range(last_row)]  # 시트행 1..last_row
    for b, (wkey, label, _, _) in enumerate(weeks):
        c0 = b * 8
        mat[0][c0] = label                       # 1행: 블록 첫 칸에 주차 라벨
        for j, m in enumerate(METRICS):          # 2행: 지표명
            mat[1][c0 + j] = m
    for r in range(DST_HEADER_ROW, last_row):
        vid = str(col_vals[r]).strip().lstrip("'")
        if not (vid.isdigit() and len(vid) >= 18):
            continue
        for b, (wkey, _, _, _) in enumerate(weeks):
            a = weekly[wkey].get(vid)
            if not a:
                continue
            vals = metrics_from(a)
            for j, v in enumerate(vals):
                mat[r][b * 8 + j] = v

    # 샘플 로그
    print("  --- 주차 블록 샘플 (총합행3 vid, 주차별 Order) ---", flush=True)
    sample_shown = 0
    for r in range(DST_HEADER_ROW, last_row):
        vid = str(col_vals[r]).strip().lstrip("'")
        if not (vid.isdigit() and len(vid) >= 18) or vid not in total:
            continue
        per_wk = []
        for b, (wkey, label, _, _) in enumerate(weeks):
            a = weekly[wkey].get(vid)
            per_wk.append(f"{label.splitlines()[0]}:{round(a[3]) if a else 0}")
        print(f"    행{r+1} {vid} Order[{' '.join(per_wk)}]", flush=True)
        sample_shown += 1
        if sample_shown >= 5:
            break

    if not write:
        print("  (DRY-RUN — 기록 안 함)", flush=True)
        return

    # 5) 총합 기록
    for i in range(0, len(tot_updates), 500):
        part = tot_updates[i:i + 500]
        with_retry(lambda: dst.spreadsheet.values_batch_update(
            {"valueInputOption": "USER_ENTERED", "data": part}), "총합 기록")
    print(f"  총합 {matched}행 기록", flush=True)

    # 6) 주차 영역: U열부터 넉넉히 비우고 매트릭스 기록
    with_retry(lambda: dst.batch_clear([f"{to_letter(WEEK_FIRST_C)}1:ZZ{last_row}"]), "주차영역 clear")
    wk_range = f"'{DST_TAB}'!{to_letter(WEEK_FIRST_C)}1:{to_letter(WEEK_FIRST_C + n_cols - 1)}{last_row}"
    with_retry(lambda: dst.spreadsheet.values_update(
        wk_range, params={"valueInputOption": "USER_ENTERED"}, body={"values": mat}), "주차 기록")
    print(f"  주차 블록 {WEEKS_N}개 × 8열 기록 ({to_letter(WEEK_FIRST_C)}~{to_letter(WEEK_FIRST_C+n_cols-1)})", flush=True)

    # 7) 숫자 서식 (총합 M~T + 주차 각 블록), 데이터행 3행부터
    reqs = []
    if last_row > DST_HEADER_ROW:
        # 총합
        for j, pat in enumerate(PATTERNS):
            c = TOTAL_FIRST_C + j
            reqs.append({"repeatCell": {
                "range": {"sheetId": dst.id, "startRowIndex": DST_HEADER_ROW, "endRowIndex": last_row,
                          "startColumnIndex": c, "endColumnIndex": c + 1},
                "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": pat}}},
                "fields": "userEnteredFormat.numberFormat"}})
        # 주차 블록들
        for b in range(WEEKS_N):
            for j, pat in enumerate(PATTERNS):
                c = WEEK_FIRST_C + b * 8 + j
                reqs.append({"repeatCell": {
                    "range": {"sheetId": dst.id, "startRowIndex": DST_HEADER_ROW, "endRowIndex": last_row,
                              "startColumnIndex": c, "endColumnIndex": c + 1},
                    "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": pat}}},
                    "fields": "userEnteredFormat.numberFormat"}})
        with_retry(lambda: dst.spreadsheet.batch_update({"requests": reqs}), "서식")
        print("  숫자 서식 적용 완료", flush=True)

    print(f"  ✅ 완료 — 총합 {matched}행 + 주차 {WEEKS_N}블록", flush=True)


if __name__ == "__main__":
    main()

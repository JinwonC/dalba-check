"""PAID 성과 트래킹 (GMV) 탭의 M~T 자동 채움

- 소스: Ads 시트의 '광고소재성과' 탭 (소재ID=영상ID, 일별). TikTok API 호출 없음 — 이미 적재된 시트를 집계만 함.
- 대상: 트래킹 시트 'PAID 성과 트래킹 (GMV)' 탭 (2행 헤더, 3행부터 데이터). J열 Video ID 기준.
- 집계(영상ID별 전체기간 합산) → M~T:
    M Impression = Σ 상품노출수
    N Click      = Σ 상품클릭수
    O CTR(%)     = Click/Impression*100
    P CVR(%)     = Order/Click*100
    Q Sum광고비  = Σ 지출금액
    R Sum Revenue= Σ 총매출(GMV)
    S GMV Max ROI= Revenue/Cost
    T Sum Order  = Σ 주문수

사용:
  python paid_tracking.py            # dry-run (계산·샘플 로그만, 쓰기 없음)
  python paid_tracking.py write      # 실제로 트래킹시트 M~T 기록
"""
import sys
import time

import gspread
from google.oauth2.service_account import Credentials

SERVICE_ACCOUNT_FILE = "service_account.json"

ADS_SPREADSHEET_ID = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"
ADS_TAB = "광고소재성과"

DST_SPREADSHEET_ID = "1JFq6m2-rvSpiGKQsTpr91Hj-RckHpqFfEl_BLkQI_hs"
DST_TAB = "PAID 성과 트래킹 (GMV)"
DST_HEADER_ROW = 2          # 1행 배너 / 2행 헤더 / 3행부터 데이터
DST_VIDEO_COL = "J"         # Video ID
DST_WRITE_FIRST = "M"       # M~T 8칸
DST_WRITE_LAST = "T"


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
    mode = sys.argv[1] if len(sys.argv) > 1 else "dry"
    write = mode == "write"
    print(f"=== PAID 트래킹 M~T 채움 [{'실제기록' if write else 'DRY-RUN'}] ===", flush=True)

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"])
    gc = gspread.authorize(creds)

    # 1) 광고소재성과 읽어서 영상ID별 집계
    ads = gc.open_by_key(ADS_SPREADSHEET_ID).worksheet(ADS_TAB)
    ads_vals = with_retry(lambda: ads.get_all_values(), "광고소재성과 읽기")
    if not ads_vals:
        print("  광고소재성과 비어있음"); return
    ah = ads_vals[0]

    def a_idx(name):
        return ah.index(name) if name in ah else -1
    i_id = a_idx("소재ID")
    i_cost = a_idx("지출금액")
    i_ord = a_idx("주문수")
    i_rev = a_idx("총매출(GMV)")
    i_imp = a_idx("상품노출수")
    i_clk = a_idx("상품클릭수")
    if min(i_id, i_cost, i_ord, i_rev, i_imp, i_clk) < 0:
        print(f"  ❌ 광고소재성과 헤더에서 필요한 열을 못 찾음: {ah}")
        sys.exit(1)

    agg = {}  # video_id -> [imp, clk, cost, ord, rev]
    for row in ads_vals[1:]:
        if len(row) <= i_id:
            continue
        vid = str(row[i_id]).strip().lstrip("'")
        if not (vid.isdigit() and len(vid) >= 18):   # 영상ID 형태만 (프로덕트카드 등 제외)
            continue
        a = agg.setdefault(vid, [0.0, 0.0, 0.0, 0.0, 0.0])
        a[0] += num(row[i_imp]) if len(row) > i_imp else 0
        a[1] += num(row[i_clk]) if len(row) > i_clk else 0
        a[2] += num(row[i_cost]) if len(row) > i_cost else 0
        a[3] += num(row[i_ord]) if len(row) > i_ord else 0
        a[4] += num(row[i_rev]) if len(row) > i_rev else 0
    print(f"  광고소재성과 {len(ads_vals)-1}행 → 영상ID {len(agg)}개 집계", flush=True)

    # 2) 트래킹시트 J열(Video ID) 읽기
    dst = gc.open_by_key(DST_SPREADSHEET_ID).worksheet(DST_TAB)
    j = col_idx(DST_VIDEO_COL)
    col_vals = with_retry(lambda: dst.col_values(j + 1), "트래킹 J열 읽기")

    updates = []
    matched = 0
    samples = []
    for r in range(DST_HEADER_ROW, len(col_vals)):   # 0-based; 데이터는 헤더 다음부터
        vid = str(col_vals[r]).strip().lstrip("'")
        row_no = r + 1
        if not (vid.isdigit() and len(vid) >= 18):
            continue
        a = agg.get(vid)
        if not a:
            continue
        imp, clk, cost, ordc, rev = a
        ctr = (clk / imp * 100) if imp else 0
        cvr = (ordc / clk * 100) if clk else 0
        roi = (rev / cost) if cost else 0
        vals = [round(imp), round(clk), round(ctr, 2), round(cvr, 2),
                round(cost, 2), round(rev, 2), round(roi, 2), round(ordc)]
        updates.append({"range": f"'{DST_TAB}'!{DST_WRITE_FIRST}{row_no}:{DST_WRITE_LAST}{row_no}",
                        "values": [vals]})
        matched += 1
        if len(samples) < 8:
            samples.append((row_no, vid, vals))

    print(f"  트래킹 데이터행 중 매칭 {matched}개", flush=True)
    print("  --- 샘플(행/영상ID/[Imp,Clk,CTR%,CVR%,광고비,Revenue,ROI,Order]) ---", flush=True)
    for row_no, vid, vals in samples:
        print(f"    행{row_no} {vid} -> {vals}", flush=True)

    if not write:
        print("  (DRY-RUN — 실제 기록 안 함. 확인 후 'write'로 실행)", flush=True)
        return

    for i in range(0, len(updates), 500):
        part = updates[i:i + 500]
        with_retry(lambda: dst.spreadsheet.values_batch_update(
            {"valueInputOption": "USER_ENTERED", "data": part}), "트래킹 기록")
        print(f"    기록 진행 {min(i+500, len(updates))}/{len(updates)}", flush=True)

    # 숫자 서식 정리 (값은 그대로, 표시형식만): M,N=정수 / O,P=퍼센트 / Q,R=$ / S=소수 / T=정수
    last_row = len(col_vals)                     # 0-based exclusive end == 시트 마지막 데이터행
    if last_row > DST_HEADER_ROW:
        fmt_map = {
            12: "#,##0", 13: "#,##0",            # M Impression, N Click
            14: '0.00"%"', 15: '0.00"%"',        # O CTR, P CVR
            16: '"$"#,##0.00', 17: '"$"#,##0.00',  # Q 광고비, R Revenue
            18: "0.00", 19: "#,##0",             # S ROI, T Order
        }
        reqs = [{
            "repeatCell": {
                "range": {"sheetId": dst.id, "startRowIndex": DST_HEADER_ROW, "endRowIndex": last_row,
                          "startColumnIndex": c, "endColumnIndex": c + 1},
                "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": pat}}},
                "fields": "userEnteredFormat.numberFormat",
            }
        } for c, pat in fmt_map.items()]
        with_retry(lambda: dst.spreadsheet.batch_update({"requests": reqs}), "서식")
        print("  숫자 서식 적용 완료 (M·N 정수 / O·P %  / Q·R $ / S·T 숫자)", flush=True)

    print(f"  ✅ 완료 — {matched}개 행 M~T 기록", flush=True)


if __name__ == "__main__":
    main()

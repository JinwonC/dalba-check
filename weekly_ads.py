"""34주차(8/17~23) vs 35주차(8/24~30) 광고비 집계 (GMV Max + 스파크애즈).

- 소스: Ads 시트 '광고소재성과'(GMV Max, 일별) + '스파크애즈'(Spark, 일별)
- 각 탭 헤더를 이름으로 매칭해 날짜/지출/매출/주문 합산.
"""
import sys
from datetime import date

import gspread
from google.oauth2.service_account import Credentials

ADS_SPREADSHEET_ID = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"
SA = "service_account.json"

WEEKS = {
    "34주차 (8/17~8/23)": ("2026-08-17", "2026-08-23"),
    "35주차 (8/24~8/30)": ("2026-08-24", "2026-08-30"),
}


def num(x):
    s = str(x if x is not None else "").replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def find(header, *cands):
    low = [str(h).strip().lower() for h in header]
    for i, h in enumerate(low):
        for c in cands:
            if c in h:
                return i
    return -1


def summarize(ws, label):
    vals = ws.get_all_values()
    if not vals:
        print(f"  [{label}] 비어있음"); return {}
    hd = vals[0]
    i_d = find(hd, "날짜", "date")
    i_cost = find(hd, "지출", "비용", "cost", "spend")
    i_rev = find(hd, "총매출", "매출", "revenue", "gmv")
    i_ord = find(hd, "주문", "order")
    print(f"  [{label}] 헤더: date={hd[i_d] if i_d>=0 else '?'} cost={hd[i_cost] if i_cost>=0 else '?'} "
          f"rev={hd[i_rev] if i_rev>=0 else '?'} ord={hd[i_ord] if i_ord>=0 else '?'} (총 {len(vals)-1}행)", flush=True)
    if min(i_d, i_cost) < 0:
        print(f"    ⚠️ 날짜/지출 컬럼 못 찾음"); return {}
    out = {}
    dmin, dmax = "9999", "0000"
    for row in vals[1:]:
        if len(row) <= i_d:
            continue
        d = str(row[i_d])[:10]
        if len(d) != 10:
            continue
        dmin = min(dmin, d); dmax = max(dmax, d)
        for wk, (a, b) in WEEKS.items():
            if a <= d <= b:
                o = out.setdefault(wk, [0.0, 0.0, 0.0])
                o[0] += num(row[i_cost]) if len(row) > i_cost else 0
                o[1] += num(row[i_rev]) if i_rev >= 0 and len(row) > i_rev else 0
                o[2] += num(row[i_ord]) if i_ord >= 0 and len(row) > i_ord else 0
    print(f"    데이터 날짜범위: {dmin} ~ {dmax}", flush=True)
    return out


def main():
    creds = Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    ss = gspread.authorize(creds).open_by_key(ADS_SPREADSHEET_ID)

    print("=== 광고비 주차 집계 ===", flush=True)
    gmax = summarize(ss.worksheet("광고소재성과"), "GMV Max")
    try:
        spark = summarize(ss.worksheet("스파크애즈"), "스파크애즈")
    except Exception as e:
        print(f"  스파크애즈 읽기 실패: {e}"); spark = {}

    print("\n=== 결과 (지출 / 매출 / 주문 / ROI) ===", flush=True)
    for wk in WEEKS:
        g = gmax.get(wk, [0, 0, 0])
        s = spark.get(wk, [0, 0, 0])
        tot_cost = g[0] + s[0]
        tot_rev = g[1] + s[1]
        tot_ord = g[2] + s[2]
        roi = (tot_rev / tot_cost) if tot_cost else 0
        print(f"\n[{wk}]", flush=True)
        print(f"  GMV Max : 지출 ${g[0]:,.2f} / 매출 ${g[1]:,.2f} / 주문 {g[2]:,.0f}", flush=True)
        print(f"  스파크   : 지출 ${s[0]:,.2f} / 매출 ${s[1]:,.2f} / 주문 {s[2]:,.0f}", flush=True)
        print(f"  합계     : 지출 ${tot_cost:,.2f} / 매출 ${tot_rev:,.2f} / 주문 {tot_ord:,.0f} / ROI {roi:.2f}", flush=True)


if __name__ == "__main__":
    main()

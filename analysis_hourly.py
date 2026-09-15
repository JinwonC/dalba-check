"""7~9월 요일×시간대 매출/주문 + 요일별 광고비 + 과거 브랜드 라이브 성과 집계 → JSON 출력."""
import json, re
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials

SA = "service_account.json"
US = "15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o"
ADS = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"

ORD_TAB = "(중요,수동) 주문별 AF 매출 RAW"
LIVE_TAB = "(수동) 브랜드 라이브 RAW"

FROM, TO = "2026-07-01", "2026-09-30"


def numf(x):
    s = re.sub(r"[^0-9.\-]", "", str(x or ""))
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_dmy(s):
    # 'DD/MM/YYYY HH:MM:SS'  또는 'D/M/YYYY H:MM:SS'
    m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})", str(s))
    if not m:
        return None
    d, mo, y, h, mi = map(int, m.groups())
    try:
        return datetime(y, mo, d, h, mi)
    except ValueError:
        return None


def parse_ymd_hms(s):
    m = re.match(r"\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})", str(s))
    if not m:
        return None
    y, mo, d, h, mi = map(int, m.groups())
    try:
        return datetime(y, mo, d, h, mi)
    except ValueError:
        return None


def main():
    creds = Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    gc = gspread.authorize(creds)
    us = gc.open_by_key(US)

    # ---------- 1) 주문별 RAW ----------
    ws = us.worksheet(ORD_TAB)
    vals = ws.get_all_values()
    hdr = vals[0]
    print("ORD_HEADER=" + json.dumps([f"{i}:{h}" for i, h in enumerate(hdr)], ensure_ascii=False), flush=True)

    def find(*cands):
        for c in cands:
            for i, h in enumerate(hdr):
                if c.lower() == str(h).strip().lower():
                    return i
        for c in cands:  # 부분일치
            for i, h in enumerate(hdr):
                if c.lower() in str(h).strip().lower():
                    return i
        return -1

    i_time = find("Time Created", "Created Time", "Order create")
    i_val = find("SKU Subtotal after Discount", "SKU Subtotal", "Order Amount", "Subtotal after discount",
                 "Total settlement amount", "SKU subtotal after seller discounts", "Order amount", "Quantity")
    print(f"USING i_time={i_time}({hdr[i_time] if i_time>=0 else '?'}) i_val={i_val}({hdr[i_val] if i_val>=0 else '?'})", flush=True)

    orders_wh = [[0] * 24 for _ in range(7)]
    gmv_wh = [[0.0] * 24 for _ in range(7)]
    by_month = {}
    seen_hours = {}
    total_ord = 0
    for r in vals[1:]:
        if i_time >= len(r):
            continue
        dt = parse_dmy(r[i_time])
        if not dt:
            continue
        ds = dt.strftime("%Y-%m-%d")
        if ds < FROM or ds > TO:
            continue
        wd, h = dt.weekday(), dt.hour
        orders_wh[wd][h] += 1
        if i_val >= 0 and i_val < len(r):
            gmv_wh[wd][h] += numf(r[i_val])
        mk = ds[:7]
        by_month[mk] = by_month.get(mk, 0) + 1
        seen_hours[h] = seen_hours.get(h, 0) + 1
        total_ord += 1
    print(f"ORD_TOTAL={total_ord} months={by_month}", flush=True)
    print("ORDERS_WH=" + json.dumps(orders_wh), flush=True)
    print("GMV_WH=" + json.dumps([[round(x, 1) for x in row] for row in gmv_wh]), flush=True)

    # ---------- 2) 광고비 요일별 (광고소재성과, 7~9월) ----------
    av = gc.open_by_key(ADS).worksheet("광고소재성과").get_all_values()
    ah = av[0]
    a_d = ah.index("날짜") if "날짜" in ah else 0
    a_c = ah.index("지출금액") if "지출금액" in ah else -1
    ad_by_wd = [0.0] * 7
    ad_total = 0.0
    for r in av[1:]:
        if a_d >= len(r):
            continue
        ds = str(r[a_d])[:10]
        if len(ds) != 10 or ds < FROM or ds > TO:
            continue
        try:
            wd = datetime.strptime(ds, "%Y-%m-%d").weekday()
        except ValueError:
            continue
        c = numf(r[a_c]) if a_c >= 0 and a_c < len(r) else 0
        ad_by_wd[wd] += c
        ad_total += c
    print("AD_BY_WD=" + json.dumps([round(x, 1) for x in ad_by_wd]), flush=True)
    print(f"AD_TOTAL={round(ad_total,1)}", flush=True)

    # ---------- 3) 과거 브랜드 라이브 성과 (start time hour×wd, LIVE GMV) ----------
    try:
        lv = us.worksheet(LIVE_TAB).get_all_values()
        lh = lv[0]
        def lf(*c):
            for x in c:
                if x in lh:
                    return lh.index(x)
            return -1
        i_st = lf("Start time")
        i_lg = lf("LIVE-attributed GMV", "LIVE GMV", "GMV with subsidy")
        live_wh_gmv = [[0.0] * 24 for _ in range(7)]
        live_wh_cnt = [[0] * 24 for _ in range(7)]
        lcnt = 0
        for r in lv[1:]:
            if i_st < 0 or i_st >= len(r):
                continue
            dt = parse_ymd_hms(r[i_st]) or parse_dmy(r[i_st])
            if not dt:
                continue
            wd, h = dt.weekday(), dt.hour
            live_wh_cnt[wd][h] += 1
            if i_lg >= 0 and i_lg < len(r):
                live_wh_gmv[wd][h] += numf(r[i_lg])
            lcnt += 1
        print(f"LIVE_TOTAL={lcnt} (col st={hdr and (lh[i_st] if i_st>=0 else '?')}, gmv={lh[i_lg] if i_lg>=0 else '?'})", flush=True)
        print("LIVE_WH_CNT=" + json.dumps(live_wh_cnt), flush=True)
        print("LIVE_WH_GMV=" + json.dumps([[round(x, 1) for x in row] for row in live_wh_gmv]), flush=True)
    except Exception as e:
        print(f"LIVE 실패: {e}", flush=True)


if __name__ == "__main__":
    main()

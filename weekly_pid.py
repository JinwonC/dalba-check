"""반반패드(PID) 34주차 vs 35주차 주간 집계 — 최신 광고소재성과에서 직접.

- PID 영상 집합: pickdi video list(products에 PID 포함)의 id + 발행일
- 광고비/매출/주문: 광고소재성과에서 소재ID가 PID 영상집합에 속하고 날짜가 해당 주차인 행 합산
- 발행량: pickdi에서 PID 영상의 video_post_time이 해당 주차인 건수
"""
import re
import gspread
from google.oauth2.service_account import Credentials

SA = "service_account.json"
PID = "1732397321053967068"

VID_SID = "1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g"
VID_TAB = "pickdi video list"
VID_HEADER_ROW = 2

ADS_SID = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"
ADS_TAB = "광고소재성과"

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


def d10(x):
    s = str(x if x is not None else "").strip()
    m = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else s[:10]


def wk_of(d):
    for wk, (a, b) in WEEKS.items():
        if a <= d <= b:
            return wk
    return None


def main():
    creds = Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    gc = gspread.authorize(creds)

    # 1) PID 영상 집합 + 주차별 발행량
    vv = gc.open_by_key(VID_SID).worksheet(VID_TAB).get_all_values()
    vh = vv[VID_HEADER_ROW - 1] if len(vv) >= VID_HEADER_ROW else []
    def vi(n): return vh.index(n) if n in vh else -1
    i_id, i_prod, i_post = vi("id"), vi("products"), vi("video_post_time")
    pid_vids = set()
    posts = {wk: 0 for wk in WEEKS}
    for r in vv[VID_HEADER_ROW:]:
        if i_prod < 0 or i_id < 0 or i_prod >= len(r) or i_id >= len(r):
            continue
        if PID not in str(r[i_prod]):
            continue
        vid = str(r[i_id]).strip().lstrip("'")
        if vid:
            pid_vids.add(vid)
        if i_post >= 0 and i_post < len(r):
            wk = wk_of(d10(r[i_post]))
            if wk:
                posts[wk] += 1
    print(f"PID 영상 집합: {len(pid_vids)}개 (pickdi products∋PID)", flush=True)

    # 2) 광고소재성과에서 PID 영상만 주차별 합산
    av = gc.open_by_key(ADS_SID).worksheet(ADS_TAB).get_all_values()
    ah = av[0] if av else []
    def ai(*c):
        for x in c:
            if x in ah: return ah.index(x)
        return -1
    a_d, a_id = ai("날짜"), ai("소재ID")
    a_cost, a_rev, a_ord = ai("지출금액"), ai("총매출(GMV)", "총매출"), ai("주문수")
    dmin, dmax = "9999", "0000"
    agg = {wk: [0.0, 0.0, 0.0] for wk in WEEKS}
    for r in av[1:]:
        if a_id >= len(r) or a_d >= len(r):
            continue
        vid = str(r[a_id]).strip().lstrip("'")
        if vid not in pid_vids:
            continue
        d = d10(r[a_d])
        dmin, dmax = min(dmin, d), max(dmax, d)
        wk = wk_of(d)
        if not wk:
            continue
        g = agg[wk]
        g[0] += num(r[a_cost]) if a_cost >= 0 and a_cost < len(r) else 0
        g[1] += num(r[a_rev]) if a_rev >= 0 and a_rev < len(r) else 0
        g[2] += num(r[a_ord]) if a_ord >= 0 and a_ord < len(r) else 0
    print(f"광고소재성과 날짜범위: {dmin} ~ {dmax}", flush=True)

    print("\n=== 반반패드 PID 주간 (발행 / 광고비 / 광고매출 / 주문 / ROI) ===", flush=True)
    for wk in WEEKS:
        c, rv, o = agg[wk]
        roi = (rv / c) if c else 0
        print(f"\n[{wk}]", flush=True)
        print(f"  발행 영상: {posts[wk]}건", flush=True)
        print(f"  광고비:   ${c:,.2f}", flush=True)
        print(f"  광고매출: ${rv:,.2f}", flush=True)
        print(f"  광고주문: {o:,.0f}", flush=True)
        print(f"  ROI:      {roi:.2f}", flush=True)


if __name__ == "__main__":
    main()

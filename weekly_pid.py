"""반반패드(PID 1732397321053967068) 34주차 vs 35주차 주간 광고/발행 집계.

- 소스: 'PAID 성과 트래킹 (GMV)' 시트 (헤더 2행, 3행부터 데이터).
  · H열=발행일 → 주차별 발행 건수
  · U열~ 주차 블록(각 8열: Imp,Click,CTR,CVR,광고비,Revenue,ROI,Order)
    → 1행 라벨로 34/35주차 블록 찾아 광고비/매출/주문 합산
"""
import gspread
from google.oauth2.service_account import Credentials

SA = "service_account.json"
SID = "1JFq6m2-rvSpiGKQsTpr91Hj-RckHpqFfEl_BLkQI_hs"
TAB = "PAID 성과 트래킹 (GMV)"
HEADER_ROW = 2

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


def norm(x):
    s = str(x if x is not None else "").strip()
    import re
    m = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return s[:10]


def main():
    creds = Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    ws = gspread.authorize(creds).open_by_key(SID).worksheet(TAB)
    vals = ws.get_all_values()
    row1 = vals[0] if vals else []
    header = vals[HEADER_ROW - 1] if len(vals) >= HEADER_ROW else []
    data = vals[HEADER_ROW:]

    # 발행일 컬럼
    def hidx(name):
        return header.index(name) if name in header else -1
    i_post = -1
    for cand in ("video_post_time", "발행일", "post_time"):
        if cand in header:
            i_post = header.index(cand); break
    # 트래킹시트는 발행일이 H열(=index 7)
    if i_post < 0:
        i_post = 7

    # 주차 블록 시작 컬럼 찾기 (1행 라벨에 'NN주차')
    block_start = {}
    for ci, lab in enumerate(row1):
        for wk in WEEKS:
            code = wk.split()[0]  # '34주차'
            if code in str(lab):
                block_start[wk] = ci
    print(f"발행일 컬럼 index={i_post} ({header[i_post] if i_post < len(header) else '?'})", flush=True)
    print(f"주차 블록 시작열: { {k: v for k,v in block_start.items()} }", flush=True)

    # 집계
    for wk, (a, b) in WEEKS.items():
        posts = 0
        cost = rev = orders = 0.0
        c0 = block_start.get(wk)
        for r in data:
            # 발행 건수
            if i_post < len(r):
                d = norm(r[i_post])
                if a <= d <= b:
                    posts += 1
            # 광고 지표 (블록: +4=광고비 +5=Rev +7=Order)
            if c0 is not None:
                if c0 + 4 < len(r): cost += num(r[c0 + 4])
                if c0 + 5 < len(r): rev += num(r[c0 + 5])
                if c0 + 7 < len(r): orders += num(r[c0 + 7])
        roi = (rev / cost) if cost else 0
        print(f"\n[{wk}]", flush=True)
        print(f"  발행 영상: {posts}건", flush=True)
        print(f"  광고비:   ${cost:,.2f}", flush=True)
        print(f"  광고매출: ${rev:,.2f}", flush=True)
        print(f"  광고주문: {orders:,.0f}", flush=True)
        print(f"  ROI:      {roi:.2f}", flush=True)


if __name__ == "__main__":
    main()

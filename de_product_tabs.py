"""DE 제품별 콘텐츠 트랙킹 — 제품 탭(퍼스트/멀티밤 …)을 월별 영상 CSV로 다시 채움.

소스: data/de_videos_<시작>_<끝>.csv (발행일자, PID, Video ID, 핸들, 링크, 매출, 판매수량, 뷰)
      data/de_videos_<시작>_<끝>_titles.csv (Video ID, 제목)
대상: 각 제품 탭 (1행 pid / 2행 헤더 / 3행부터 데이터)

- 3행부터 기존 데이터를 지우고, 해당 PID가 걸린 영상만 발행일 순으로 다시 씀
  (기존 데이터는 사전에 data/backup/ 에 백업)
- 열 위치는 2행 헤더 이름으로 찾음 → 탭마다 열 순서가 달라도 안전
- Video ID·PID·날짜·텍스트는 ' 접두로 텍스트 고정(19자리 손실/수식 오인 방지),
  GMV·SKU ORDER·VIEW는 숫자
- CRUVA는 DE 주문수를 주지 않아 SKU ORDER에는 판매수량(units_sold)을 넣고 ORDER·CTR은 비워 둠

사용: python de_product_tabs.py data/de_videos_2026-08-01_2026-10-19.csv data/de_videos_2026-08-01_2026-10-19_titles.csv
"""
import csv
import sys
import time
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

SPREADSHEET_ID = "1hKFtybX2aNkr-co1OKIseNhNSjq2wJLZvNzOOf3i4PU"   # DE 제품별 콘텐츠 트랙킹
SERVICE_ACCOUNT_FILE = "service_account.json"
TABS = [  # (탭, PID, 제품명)
    ("퍼스트", "1729739716088469995", "퍼스트 스프레이 세럼"),
    ("멀티밤", "1729790543307774443", "멀티밤"),
]
HEADER_ROW = 2
UPDATED = datetime.now().strftime("%Y-%m-%d") + " (CRUVA 기준)"


def with_retry(fn, label):
    for attempt in range(1, 9):
        try:
            return fn()
        except gspread.exceptions.APIError as e:
            if getattr(e, "response", None) is not None and e.response.status_code in (403, 404):
                raise
            if attempt == 8:
                raise
            print(f"  {label} 실패 (시도 {attempt}/8): {e}", flush=True)
            time.sleep(min(3 * attempt, 30))


def col_letter(n):  # 1-based
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def build_row(header, v, tab_pid, name):
    d = datetime.strptime(v["발행일자"], "%Y-%m-%d").strftime("%m/%d/%Y")
    val = {
        "Video ID": "'" + v["Video ID"],
        "포스팅일(LA)": "'" + d,
        "크리에이터": "'" + v["핸들"],
        "제목": "'" + v["제목"] if v["제목"] else "",
        "GMV": float(v["매출"] or 0),
        "화폐": "EUR",
        "SKU ORDER": int(float(v["판매수량"] or 0)),
        "ORDER": "",
        "VIEW": int(float(v["뷰"] or 0)),
        "CTR": "",
        "PID": "'" + tab_pid,
        "제품명": name,
        "마지막 업데이트": UPDATED,
        "링크": v["링크"],
    }
    return [val.get(h.strip(), "") for h in header]


def main():
    videos_csv, titles_csv = sys.argv[1], sys.argv[2]
    titles = {r["Video ID"]: r["제목"] for r in csv.DictReader(open(titles_csv, encoding="utf-8"))}
    rows = list(csv.reader(open(videos_csv, encoding="utf-8")))[1:]
    videos = [{"발행일자": r[0], "PID": r[1], "Video ID": r[2], "핸들": r[3], "링크": r[4],
               "매출": r[5], "판매수량": r[6], "뷰": r[7], "제목": titles.get(r[2], "")} for r in rows]

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    ss = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)

    failed = False
    for tab, pid, name in TABS:
        sheet = ss.worksheet(tab)
        header = with_retry(lambda: sheet.row_values(HEADER_ROW), f"{tab} 헤더")
        if "Video ID" not in header:
            print(f"❌ {tab}: {HEADER_ROW}행에서 'Video ID' 헤더를 못 찾음 → 건너뜀 ({header[:5]})")
            failed = True
            continue
        mine = sorted((v for v in videos if pid in v["PID"].split(", ")),
                      key=lambda v: (v["발행일자"], v["Video ID"]))
        values = [build_row(header, v, pid, name) for v in mine]

        last_col = col_letter(max(sheet.col_count, len(header)))
        need = HEADER_ROW + len(values) + 10
        if sheet.row_count < need:
            with_retry(lambda: sheet.add_rows(need - sheet.row_count), f"{tab} 행 추가")
        with_retry(lambda: sheet.batch_clear([f"A{HEADER_ROW + 1}:{last_col}"]), f"{tab} 기존 데이터 삭제")
        if values:
            with_retry(lambda: sheet.update(values, f"A{HEADER_ROW + 1}", value_input_option="USER_ENTERED"),
                       f"{tab} 적재")

        # 검증
        i_id = header.index("Video ID") + 1
        ids = [x for x in with_retry(lambda: sheet.col_values(i_id), f"{tab} 검증")[HEADER_ROW:] if x]
        bad = [x for x in ids if not (x.isdigit() and len(x) >= 18)]
        ok = len(ids) == len(values) and not bad and set(ids) == {v["Video ID"] for v in mine}
        gmv = round(sum(float(v["매출"] or 0) for v in mine), 2)
        print(f"{'✅' if ok else '❌'} {tab}: {len(values)}행 기록 / 시트 {len(ids)}행 / ID 형식 이상 {len(bad)} "
              f"/ GMV 합 {gmv} / {mine[0]['발행일자'] if mine else '-'} ~ {mine[-1]['발행일자'] if mine else '-'}", flush=True)
        failed |= not ok

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

"""DE 제품별 콘텐츠 트랙킹 > '전체영상' 탭 적재.

소스: CRUVA search_videos 로 내려받아 정리한 data/de_videos_YYYY-MM.csv
열: 발행일자 / PID / Video ID / 크리에이터 핸들 / 틱톡 비디오 링크 / 매출(EUR) / 판매수량 / 뷰

모드
  full    : A~H를 비우고 CSV 전체를 다시 씀
  add-pid : B열에 새 열을 '끼워 넣어'(기존 B 이후 열을 한 칸씩 오른쪽으로 밀고)
            각 행의 Video ID로 매칭해 PID를 채움. 이미 B열이 PID면 아무것도 안 함.

- Video ID·PID(19자리)는 숫자로 들어가면 뒷자리가 손실되므로 텍스트(' 접두)로 기록
- 발행일자는 날짜, 매출·판매수량·뷰는 숫자로 기록 (정렬/합계 가능)

사용: python de_video_load.py data/de_videos_2026-08-01_2026-10-19.csv [full|add-pid]
"""
import csv
import sys
import time

import gspread
from google.oauth2.service_account import Credentials

SPREADSHEET_ID = "1hKFtybX2aNkr-co1OKIseNhNSjq2wJLZvNzOOf3i4PU"   # DE 제품별 콘텐츠 트랙킹
TAB = "전체영상"
SERVICE_ACCOUNT_FILE = "service_account.json"
TEXT_COLS = {"PID", "Video ID"}


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


def open_sheet():
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"])
    print(f"서비스 계정: {creds.service_account_email}", flush=True)
    try:
        return gspread.authorize(creds).open_by_key(SPREADSHEET_ID).worksheet(TAB)
    except gspread.exceptions.APIError as e:
        print(f"❌ 시트 접근 불가 — 위 서비스 계정 이메일을 시트에 '편집자'로 공유해야 함 ({e})")
        sys.exit(1)


def cell(header_name, v):
    if header_name in TEXT_COLS:
        return "'" + v
    if header_name.startswith(("매출",)):
        return float(v or 0)
    if header_name.startswith(("판매수량", "뷰")):
        return int(float(v or 0))
    return v


def load_full(sheet, header, data):
    values = [header] + [[cell(h, v) for h, v in zip(header, r)] for r in data]
    need = len(values) + 10
    if sheet.row_count < need:
        with_retry(lambda: sheet.add_rows(need - sheet.row_count), "행 추가")
    last = chr(ord("A") + len(header) - 1)
    with_retry(lambda: sheet.batch_clear([f"A:{last}"]), "비우기")
    with_retry(lambda: sheet.update(values, "A1", value_input_option="USER_ENTERED"), "적재")


def add_pid(sheet, header, data):
    if with_retry(lambda: sheet.acell("B1").value, "B1 확인") == "PID":
        print("  B열이 이미 PID — 건너뜀")
        return
    i_vid, i_pid = header.index("Video ID"), header.index("PID")
    pid_by_vid = {r[i_vid]: r[i_pid] for r in data}

    # B열 앞에 새 열 삽입 → 기존 B 이후 모든 열이 한 칸씩 오른쪽으로 이동
    with_retry(lambda: sheet.spreadsheet.batch_update({"requests": [{"insertDimension": {
        "range": {"sheetId": sheet.id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2},
        "inheritFromBefore": False}}]}), "B열 삽입")

    vids = with_retry(lambda: sheet.col_values(3), "Video ID(C열) 읽기")   # 삽입 후 Video ID는 C열
    col_b = [["PID"]]
    missing = 0
    for v in vids[1:]:
        p = pid_by_vid.get(str(v).strip().lstrip("'"), "")
        missing += (p == "")
        col_b.append(["'" + p if p else ""])
    with_retry(lambda: sheet.update(col_b, f"B1:B{len(col_b)}", value_input_option="USER_ENTERED"), "PID 기록")
    print(f"  PID 기록 {len(col_b) - 1}행 (매칭 실패 {missing}행)", flush=True)


def verify(sheet, header, data):
    rows = with_retry(lambda: sheet.get_values(f"A1:{chr(ord('A') + len(header) - 1)}"), "검증 읽기")
    got_hdr, body = rows[0], [r for r in rows[1:] if any(r)]
    i_vid, i_pid = header.index("Video ID"), header.index("PID")
    want = {r[i_vid]: r[i_pid] for r in data}
    bad_id = [r[i_vid] for r in body if not (r[i_vid].isdigit() and len(r[i_vid]) >= 18)]
    bad_pid = [r[i_vid] for r in body if want.get(r[i_vid]) != r[i_pid]]
    print(f"✅ 헤더 {got_hdr}\n   데이터 {len(body)}행 / Video ID 형식 이상 {len(bad_id)} / PID 불일치 {len(bad_pid)}", flush=True)
    if got_hdr != header or len(body) != len(data) or bad_id or bad_pid:
        print(f"❌ 검증 실패: {bad_id[:3]} {bad_pid[:3]}")
        sys.exit(1)


def main():
    path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "full"
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]
    sheet = open_sheet()
    if mode == "add-pid":
        add_pid(sheet, header, data)
    else:
        load_full(sheet, header, data)
    verify(sheet, header, data)


if __name__ == "__main__":
    main()

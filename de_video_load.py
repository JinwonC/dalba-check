"""DE 제품별 콘텐츠 트랙킹 > '전체영상' 탭에 CSV(발행월 단위 영상 성과)를 적재.

소스: CRUVA search_videos 로 내려받아 정리한 data/de_videos_YYYY-MM.csv
열: 발행일자 / Video ID / 크리에이터 핸들 / 틱톡 비디오 링크 / 매출(EUR) / 판매수량 / 뷰

- Video ID(19자리)는 숫자로 들어가면 뒷자리가 손실되므로 텍스트(' 접두)로 기록
- 발행일자는 날짜, 매출·판매수량·뷰는 숫자로 기록 (정렬/합계 가능)
- 기존 탭 내용은 A~G만 지우고 다시 씀 (H열 이후 수동 메모는 건드리지 않음)

사용: python de_video_load.py data/de_videos_2026-08.csv
"""
import csv
import sys
import time

import gspread
from google.oauth2.service_account import Credentials

SPREADSHEET_ID = "1hKFtybX2aNkr-co1OKIseNhNSjq2wJLZvNzOOf3i4PU"   # DE 제품별 콘텐츠 트랙킹
TAB = "전체영상"
SERVICE_ACCOUNT_FILE = "service_account.json"


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


def main():
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"])
    print(f"서비스 계정: {creds.service_account_email}", flush=True)
    try:
        sheet = gspread.authorize(creds).open_by_key(SPREADSHEET_ID).worksheet(TAB)
    except gspread.exceptions.APIError as e:
        print(f"❌ 시트 접근 불가 — 위 서비스 계정 이메일을 시트에 '편집자'로 공유해야 함 ({e})")
        sys.exit(1)

    values = [header] + [
        [r[0], "'" + r[1], r[2], r[3], float(r[4]), int(r[5]), int(r[6])] for r in data
    ]
    need = len(values) + 10
    if sheet.row_count < need:
        with_retry(lambda: sheet.add_rows(need - sheet.row_count), "행 추가")

    with_retry(lambda: sheet.batch_clear(["A:G"]), "A~G 비우기")
    with_retry(lambda: sheet.update(values, "A1", value_input_option="USER_ENTERED"), "적재")

    # 검증: 기록된 행 수와 ID 손실 여부
    ids = with_retry(lambda: sheet.col_values(2), "검증 읽기")[1:]
    bad = [i for i in ids if not (i.isdigit() and len(i) >= 18)]
    print(f"✅ '{TAB}' 적재 완료: {len(values) - 1}행 기록 / 시트 B열 {len(ids)}개, 형식 이상 {len(bad)}개", flush=True)
    if len(ids) != len(data) or bad:
        print(f"❌ 검증 실패: {bad[:5]}")
        sys.exit(1)


if __name__ == "__main__":
    main()

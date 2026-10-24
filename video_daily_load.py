"""
특정 날짜(LA 기준)에 포스팅된 US 영상만 골라 지정한 시트에 적재
사용: python video_daily_load.py 2026-10-21 [SPREADSHEET_ID]
- 대상 탭: 시트의 첫 탭(gid=0). 탭 자동 생성 없음
- 기존 행(Video ID 기준)은 제자리 갱신, 신규는 맨 아래 추가 (재정렬 없음)
"""

import sys
from datetime import datetime, timedelta, timezone

import gspread
from google.oauth2.service_account import Credentials

from tiktok_to_sheets import (
    HEADERS, LA_TZ, SERVICE_ACCOUNT_FILE, _write_with_retry, fetch_video_performance,
)

DEFAULT_SPREADSHEET_ID = "17UnCxe42zE9ey-i0P2FWHfBIExsdehtDbtA9hIh-D_k"
TARGET_GID = 0


def get_target_sheet(spreadsheet_id: str):
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    try:
        spreadsheet = client.open_by_key(spreadsheet_id)
    except gspread.exceptions.APIError:
        print(f"  ❌ 시트를 열 수 없음 — 서비스 계정({creds.service_account_email})을 편집자로 공유했는지 확인")
        raise
    sheet = spreadsheet.get_worksheet_by_id(TARGET_GID)
    print(f"::notice::대상 탭: '{sheet.title}' (gid={TARGET_GID})")
    return sheet


def load_day(day: str, spreadsheet_id: str):
    target = datetime.strptime(day, "%Y-%m-%d")
    # 포스팅일 이후 오늘까지의 성과(누적)를 조회하고, 포스팅일이 해당 날짜인 영상만 남긴다
    to_date = datetime.now(LA_TZ).replace(tzinfo=None) + timedelta(days=1)
    print(f"=== {day} 포스팅 영상 적재 (조회 기간 {day} ~ {to_date:%Y-%m-%d} 미만) ===")

    rows: dict[str, list] = {}
    updated_at = datetime.now(LA_TZ).strftime("%Y-%m-%d %H:%M:%S")
    page_token = None
    sample_times: list[str] = []
    while True:
        result = fetch_video_performance(target, to_date, page_token)
        if not result:
            print("  API 오류 - 중단")
            sys.exit(1)
        data = result.get("data", {})
        for video in data.get("videos") or []:
            video_id = str(video.get("id") or "").strip()
            post_time = video.get("video_post_time") or ""
            if len(sample_times) < 3 and post_time:
                sample_times.append(post_time)
            # video_post_time은 LA 기준 문자열 (전체 영상성과데이터 'B열 포스팅일(LA)'과 동일)
            if not video_id or not post_time.startswith(day):
                continue
            gmv = video.get("gmv") or {}
            products = video.get("products") or []
            rows[video_id] = [
                "'" + video_id, post_time, video.get("username") or "", video.get("title") or "",
                float(gmv.get("amount") or 0), gmv.get("currency") or "",
                video.get("sku_orders") or 0, video.get("units_sold") or 0,
                video.get("views") or 0, video.get("click_through_rate") or 0,
                ", ".join(str(p.get("id") or "") for p in products),
                ", ".join(str(p.get("name") or "") for p in products),
                updated_at,
            ]
        new_token = data.get("next_page_token") or None
        if not new_token or new_token == page_token:
            break
        page_token = new_token

    print(f"::notice::포스팅 시각 예시: {sample_times}")
    print(f"::notice::{day} 포스팅 영상: {len(rows)}건")
    if not rows:
        return

    sheet = get_target_sheet(spreadsheet_id)
    existing = sheet.get_all_values()
    if not existing:
        sheet.append_row(HEADERS)
        existing = [HEADERS]
    # 정렬 등으로 1행 헤더가 밀리면 1행 데이터를 헤더로 오인해 중복 추가하게 되므로 멈춘다
    if str(existing[0][0]).strip() != HEADERS[0]:
        print(f"::error::1행이 헤더가 아님 (A1='{existing[0][0]}') — 1행에 헤더를 복원한 뒤 다시 실행")
        sys.exit(1)
    index = {str(r[0]).strip().lstrip("'"): i for i, r in enumerate(existing[1:], start=2) if r and r[0]}

    col_end = chr(ord("A") + len(HEADERS) - 1)
    updates, appends = [], []
    for vid, row in rows.items():
        if vid in index:
            updates.append({"range": f"'{sheet.title}'!A{index[vid]}:{col_end}{index[vid]}", "values": [row]})
        else:
            appends.append(row)

    if updates:
        body = {"valueInputOption": "USER_ENTERED", "data": updates}
        _write_with_retry(lambda: sheet.spreadsheet.values_batch_update(body), "기존 업데이트")
    if appends:
        _write_with_retry(lambda: sheet.append_rows(appends, value_input_option="USER_ENTERED"), "신규 추가")
    print(f"::notice::완료! 업데이트 {len(updates)}건 / 신규 {len(appends)}건")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용: python video_daily_load.py YYYY-MM-DD [SPREADSHEET_ID]")
        sys.exit(1)
    load_day(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SPREADSHEET_ID)

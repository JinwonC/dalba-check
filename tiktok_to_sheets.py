"""
TikTok Shop Video Performance API → Google Sheets (Python)
Apps Script의 6분 실행 제한을 우회하기 위한 Python 버전
"""

import hashlib
import hmac
import json
import math
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

import requests
from google.oauth2.service_account import Credentials
import gspread
from token_manager import get_valid_token, handle_token_expired

# ─────────────────────────────────────────
# 설정값 (Apps Script 상수와 동일)
# ─────────────────────────────────────────
VIDEO_APP_KEY = "6jd7l2nu36rd4"
VIDEO_APP_SECRET = "9ab6f9c3467d53c72ca6e346c18b8071338f0ce4"
VIDEO_ACCESS_TOKEN = "TTP_8qmwDAAAAAAKxe5s-tyxQjFx-BLmHCzEUHx_N8KtbJs8REguA-PlojAyV0wGbdEfcH65GTeVkz7R1pOu5g44xImqf4SrMwS1YxCDFaFiR71wCyyvCuiX9V4xVHdkwwVZjC2fEb9DckyVqVjeUiW-H2PBtsmHPpwLM6krtq-pI3-bR3oq5XS_LA"
VIDEO_REFRESH_TOKEN = "TTP_77fQXQAAAACRYHgjQ_4vEa-Xhe5ikMt0yvs0Zs2i5flXWHMzwGflyAsL_dJ53tHERRwYkVRh9AI"
VIDEO_SHOP_CIPHER = "TTP_uE19hAAAAADx5Flb4Y_fjmWFiQfOEyTT"
VIDEO_CURRENCY = "USD"
VIDEO_ACCOUNT_TYPE = "ALL"
VIDEO_SHEET_NAME = "전체 영상성과데이터"

# Google Sheets 스프레드시트 ID (URL에서 복사)
# 예: https://docs.google.com/spreadsheets/d/xxxxxx/edit → "xxxxxx"
SPREADSHEET_ID = "1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g"

# 서비스 계정 JSON 키 파일 경로
SERVICE_ACCOUNT_FILE = "service_account.json"

HEADERS = [
    "Video ID", "포스팅일(LA)", "크리에이터", "제목", "누적 GMV",
    "Currency", "SKU Orders", "Units Sold", "Views", "CTR",
    "Product IDs", "Product Names", "마지막업데이트"
]

LA_TZ = timezone(timedelta(hours=-8))  # America/Los_Angeles (표준시, DST 무시)


# ─────────────────────────────────────────
# TikTok 서명 / 요청 유틸
# ─────────────────────────────────────────

def compute_hmac_sha256(message: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def make_tiktok_sign(path: str, params: dict) -> str:
    sorted_keys = sorted(params.keys())
    sign_str = VIDEO_APP_SECRET + path
    for key in sorted_keys:
        sign_str += key + str(params[key])
    sign_str += VIDEO_APP_SECRET
    return compute_hmac_sha256(sign_str, VIDEO_APP_SECRET)


def fetch_video_performance(start_date: datetime, end_date: datetime, page_token: str | None = None) -> dict | None:
    timestamp = str(int(time.time()))
    path = "/analytics/202409/shop_videos/performance"

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    params = {
        "account_type": VIDEO_ACCOUNT_TYPE,
        "app_key": VIDEO_APP_KEY,
        "currency": VIDEO_CURRENCY,
        "end_date_lt": end_str,
        "page_size": "100",
        "shop_cipher": VIDEO_SHOP_CIPHER,
        "sort_field": "gmv",
        "sort_order": "DESC",
        "start_date_ge": start_str,
        "timestamp": timestamp,
    }
    if page_token:
        params["page_token"] = page_token

    params["sign"] = make_tiktok_sign(path, params)

    url = "https://open-api.tiktokglobalshop.com" + path + "?" + urlencode(params, quote_via=quote)
    headers = {
        "x-tts-access-token": VIDEO_ACCESS_TOKEN,
        "content-type": "application/json",
    }

    for attempt in range(1, 4):
        try:
            current_token = get_valid_token(VIDEO_ACCESS_TOKEN, VIDEO_REFRESH_TOKEN)
            headers["x-tts-access-token"] = current_token
            resp = requests.get(url, headers=headers, timeout=30)
            data = resp.json()
            if data.get("code") == 0:
                return data
            if data.get("code") == 105002:
                print("  [토큰 만료] 자동 갱신 시도...")
                new_token = handle_token_expired(VIDEO_REFRESH_TOKEN)
                if new_token:
                    headers["x-tts-access-token"] = new_token
                    continue
            print(f"  [경고] API 응답 code={data.get('code')}, msg={data.get('message')} (시도 {attempt}/3)")
        except Exception as e:
            print(f"  [오류] 요청 실패: {e} (시도 {attempt}/3)")
        time.sleep(2 * attempt)

    return None


# ─────────────────────────────────────────
# Google Sheets 연결
# ─────────────────────────────────────────

def get_sheet():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(SPREADSHEET_ID)

    try:
        sheet = spreadsheet.worksheet(VIDEO_SHEET_NAME)
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet(title=VIDEO_SHEET_NAME, rows="1000", cols=str(len(HEADERS)))
        sheet.freeze(rows=1)
        sheet.append_row(HEADERS)
        print(f"  시트 '{VIDEO_SHEET_NAME}' 새로 생성됨")

    return sheet


def _write_with_retry(fn, desc: str, max_attempts: int = 8):
    """Google Sheets 쓰기(batch_update/append_rows)를 재시도로 감싼다.
    SSL 끊김/타임아웃 등 일시적 네트워크 오류로 쓰기가 실패해도 될 때까지 재시도."""
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as e:
            if attempt == max_attempts:
                print(f"  {desc} 최종 실패 (시도 {attempt}/{max_attempts}): {e}")
                raise
            wait = min(3 * attempt, 30)
            print(f"  {desc} 실패 (시도 {attempt}/{max_attempts}), {wait}초 후 재시도... ({e})")
            time.sleep(wait)


def _sort_by_post_date(sheet):
    """B열(포스팅일) 기준 오름차순 정렬 — 위=과거, 아래=최신 순서로 항상 유지.
    신규 영상은 API가 GMV 순으로 반환해 시트 하단에 GMV 순으로 append 되므로,
    매 실행 마지막에 포스팅일 기준으로 재정렬해야 시간순이 유지된다.
    포스팅일은 ISO 8601 문자열이라 텍스트 오름차순 = 시간 오름차순."""
    last_row = len(sheet.col_values(1))  # A열(Video ID) 기준 마지막 데이터 행 (헤더 포함)
    if last_row < 3:
        return  # 정렬할 데이터가 없음 (헤더뿐이거나 1행)
    col_end = chr(ord("A") + len(HEADERS) - 1)
    rng = f"A2:{col_end}{last_row}"
    print(f"  포스팅일(B열) 기준 오름차순 정렬 중... ({rng})")
    _write_with_retry(lambda: sheet.sort((2, "asc"), range=rng), "포스팅일 정렬")


# ─────────────────────────────────────────
# 메인 동기화 로직
# ─────────────────────────────────────────

def run_sync(from_date: datetime, to_date: datetime):
    print(f"\n=== TikTok → Sheets 동기화 시작 ===")
    print(f"기간: {from_date.strftime('%Y-%m-%d')} ~ {to_date.strftime('%Y-%m-%d')}")

    sheet = get_sheet()

    # 기존 데이터 로드 (헤더 포함)
    for attempt in range(1, 9):
        try:
            existing = sheet.get_all_values()
            break
        except Exception as e:
            if attempt == 8:
                raise
            wait = min(3 * attempt, 30)
            print(f"  시트 읽기 실패 (시도 {attempt}/8), {wait}초 후 재시도...")
            time.sleep(wait)

    # Video ID → 행번호(1-based) 매핑
    video_index_map: dict[str, int] = {}
    if len(existing) <= 1:
        # 헤더만 있거나 비어있으면 헤더 보장
        if not existing:
            sheet.append_row(HEADERS)
    else:
        for i, row in enumerate(existing[1:], start=2):  # 2행부터 (1행=헤더)
            vid = str(row[0]).strip().lstrip("'")
            if vid:
                video_index_map[vid] = i

    updated_at = datetime.now(LA_TZ).strftime("%Y-%m-%d %H:%M:%S")
    page_token = None
    page_count = 0
    update_count = 0
    new_count = 0

    # 배치 업데이트용 버퍼
    batch_updates: list[dict] = []  # {"range": "A2:M2", "values": [[...]]}
    append_rows: list[list] = []

    while True:
        print(f"  페이지 {page_count + 1} 요청 중... (page_token={page_token})")
        result = fetch_video_performance(from_date, to_date, page_token)

        if not result:
            print("  API 오류 - 중단")
            break

        videos = result.get("data", {}).get("videos") or []

        for video in videos:
            video_id = str(video.get("id") or "").strip()
            if not video_id:
                continue

            post_time_str = video.get("video_post_time") or ""
            try:
                post_date = datetime.fromisoformat(post_time_str.replace("Z", "+00:00")) if post_time_str else datetime(1970, 1, 1, tzinfo=timezone.utc)
                if post_date.tzinfo is None:
                    post_date = post_date.replace(tzinfo=timezone.utc)
            except ValueError:
                post_date = datetime(1970, 1, 1, tzinfo=timezone.utc)

            # 기간 필터
            from_aware = from_date.replace(tzinfo=timezone.utc) if from_date.tzinfo is None else from_date
            to_aware = to_date.replace(tzinfo=timezone.utc) if to_date.tzinfo is None else to_date
            if not (from_aware <= post_date <= to_aware):
                continue

            gmv = video.get("gmv") or {}
            gmv_amount = float(gmv.get("amount") or 0)
            gmv_currency = gmv.get("currency") or ""
            sku_orders = video.get("sku_orders") or 0
            units_sold = video.get("units_sold") or 0
            views = video.get("views") or 0
            ctr = video.get("click_through_rate") or 0
            products = video.get("products") or []
            product_ids = ", ".join(str(p.get("id") or "") for p in products)
            product_names = ", ".join(str(p.get("name") or "") for p in products)

            row_data = [
                "'" + video_id, post_time_str, video.get("username") or "", video.get("title") or "",
                gmv_amount, gmv_currency, sku_orders, units_sold,
                views, ctr, product_ids, product_names, updated_at
            ]

            if video_id in video_index_map:
                if video_index_map[video_id] != "NEW":
                    target_row = video_index_map[video_id]
                    col_end = chr(ord("A") + len(HEADERS) - 1)
                    batch_updates.append({
                        "range": f"'{VIDEO_SHEET_NAME}'!A{target_row}:{col_end}{target_row}",
                        "values": [row_data]
                    })
                    update_count += 1
            else:
                append_rows.append(row_data)
                video_index_map[video_id] = "NEW"
                new_count += 1

        new_token = result.get("data", {}).get("next_page_token") or None
        if not new_token or new_token == page_token:
            break
        page_token = new_token
        page_count += 1
        time.sleep(0.3)

    # ─── 시트 쓰기 ───
    spreadsheet = sheet.spreadsheet

    if batch_updates:
        print(f"  기존 {update_count}건 업데이트 중...")
        # gspread batch_update
        body = {"valueInputOption": "USER_ENTERED", "data": batch_updates}
        _write_with_retry(lambda: spreadsheet.values_batch_update(body), "기존 업데이트")

    if append_rows:
        print(f"  신규 {new_count}건 추가 중...")
        _write_with_retry(
            lambda: sheet.append_rows(append_rows, value_input_option="USER_ENTERED"),
            "신규 추가",
        )

    # 포스팅일 기준 시간순 정렬 (신규가 하단에 GMV 순으로 붙어 순서가 섞이는 것 방지)
    _sort_by_post_date(sheet)

    print(f"\n✅ 완료! 업데이트 {update_count}건 / 신규 {new_count}건")


# ─────────────────────────────────────────
# 실행 진입점
# ─────────────────────────────────────────

def sync_last_60_days():
    """최근 60일 동기화 — 기존 영상 업데이트 + 신규 영상 추가"""
    now = datetime.now(timezone.utc)
    run_sync(now - timedelta(days=60), now)


def sync_by_date_range(start_str: str, end_str: str):
    """날짜 범위 동기화 (Apps Script syncVideosByDateRange 대응)"""
    from_date = datetime.strptime(start_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    to_date = datetime.strptime(end_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    run_sync(from_date, to_date)


def refresh_all_existing():
    """A열 기존 영상 전체를 오늘 기준 최신 데이터로 업데이트 (신규 추가 없음)
    업데이트 컬럼: B(포스팅일), C(크리에이터), E(GMV), G(SKU Orders),
                  H(Units Sold), I(Views), J(CTR), K(Product IDs), M(마지막업데이트)
    """
    print("\n=== 기존 영상 전체 최신화 ===")
    sheet = get_sheet()

    for attempt in range(1, 9):
        try:
            existing = sheet.get_all_values()
            break
        except Exception as e:
            if attempt == 8:
                raise
            wait = min(3 * attempt, 30)
            print(f"  시트 읽기 실패 (시도 {attempt}/8), {wait}초 후 재시도...")
            time.sleep(wait)

    if len(existing) <= 1:
        print("  시트에 데이터 없음")
        return

    # Video ID → 행번호 + B열 포스팅일 매핑
    video_index_map: dict[str, int] = {}
    post_dates: list[datetime] = []
    for i, row in enumerate(existing[1:], start=2):
        vid = str(row[0]).strip().lstrip("'")
        if not vid:
            continue
        video_index_map[vid] = i
        # B열 포스팅일 파싱
        raw_date = str(row[1]).strip()[:10] if len(row) > 1 else ""
        try:
            post_dates.append(datetime.strptime(raw_date, "%Y-%m-%d").replace(tzinfo=timezone.utc))
        except ValueError:
            pass

    print(f"  기존 영상 {len(video_index_map)}개 발견")

    today = datetime.now(timezone.utc)
    updated_at = datetime.now(LA_TZ).strftime("%Y-%m-%d %H:%M:%S")

    # B열 포스팅일 기준 최솟값부터 오늘까지 89일 청크로 조회
    CHUNK_DAYS = 89
    if post_dates:
        chunk_start = min(post_dates).replace(hour=0, minute=0, second=0)
    else:
        chunk_start = today - timedelta(days=89)

    batch_updates: list[dict] = []
    matched = 0
    seen_ids: set[str] = set()

    while chunk_start <= today:
        chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS), today)
        print(f"  조회 중: {chunk_start.strftime('%Y-%m-%d')} ~ {chunk_end.strftime('%Y-%m-%d')}")

        page_token = None
        while True:
            result = fetch_video_performance(chunk_start, chunk_end, page_token)
            if not result:
                break

            videos = result.get("data", {}).get("videos") or []
            for video in videos:
                video_id = str(video.get("id") or "").strip()
                if video_id not in video_index_map or video_id in seen_ids:
                    continue

                seen_ids.add(video_id)
                r = video_index_map[video_id]
                sn = VIDEO_SHEET_NAME
                gmv = video.get("gmv") or {}
                products = video.get("products") or []
                product_ids = ", ".join(str(p.get("id") or "") for p in products)

                # B:C — 포스팅일, 크리에이터
                batch_updates.append({
                    "range": f"'{sn}'!B{r}:C{r}",
                    "values": [[video.get("video_post_time") or "", video.get("username") or ""]]
                })
                # E — GMV
                batch_updates.append({
                    "range": f"'{sn}'!E{r}",
                    "values": [[float(gmv.get("amount") or 0)]]
                })
                # G:J — SKU Orders, Units Sold, Views, CTR
                batch_updates.append({
                    "range": f"'{sn}'!G{r}:J{r}",
                    "values": [[
                        video.get("sku_orders") or 0,
                        video.get("units_sold") or 0,
                        video.get("views") or 0,
                        video.get("click_through_rate") or 0,
                    ]]
                })
                # K — Product IDs
                batch_updates.append({
                    "range": f"'{sn}'!K{r}",
                    "values": [[product_ids]]
                })
                # M — 마지막업데이트
                batch_updates.append({
                    "range": f"'{sn}'!M{r}",
                    "values": [[updated_at]]
                })

                matched += 1

            new_token = result.get("data", {}).get("next_page_token") or None
            if not new_token or new_token == page_token:
                break
            page_token = new_token
            time.sleep(0.3)

        chunk_start = chunk_end + timedelta(days=1)

    print(f"  매칭된 영상 {matched}개 업데이트 중...")
    if batch_updates:
        body = {"valueInputOption": "USER_ENTERED", "data": batch_updates}
        _write_with_retry(lambda: sheet.spreadsheet.values_batch_update(body), "전체 최신화")

    # 포스팅일 기준 시간순 정렬
    _sort_by_post_date(sheet)

    print(f"\n✅ 완료! {matched}개 영상 최신화")


if __name__ == "__main__":
    import sys as _sys, re as _re
    args = _sys.argv[1:]
    if args and args[0] == "--refresh-all":
        refresh_all_existing()
    elif args:
        nums = _re.findall(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}", args[0])
        if len(nums) >= 2:
            sync_by_date_range(_re.sub(r"[./]", "-", nums[0]), _re.sub(r"[./]", "-", nums[1]))
        elif len(nums) == 1:
            sync_by_date_range(_re.sub(r"[./]", "-", nums[0]), _re.sub(r"[./]", "-", nums[0]))
    else:
        if _sys.stdin.isatty():
            print("실행 모드:")
            print("  1. 날짜 범위로 동기화 (신규 영상 추가)")
            print("  2. 기존 영상 전체 최신화 (A열 기준, 신규 추가 없음)")
            choice = input("번호 입력: ").strip()
            if choice == "2":
                refresh_all_existing()
            else:
                raw = input("기간 입력 (예: 2026-05-01 ~ 2026-05-15, 엔터=최근60일): ").strip()
                if raw:
                    nums = _re.findall(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}", raw)
                    if len(nums) >= 2:
                        sync_by_date_range(_re.sub(r"[./]", "-", nums[0]), _re.sub(r"[./]", "-", nums[1]))
                    elif len(nums) == 1:
                        sync_by_date_range(_re.sub(r"[./]", "-", nums[0]), _re.sub(r"[./]", "-", nums[0]))
                else:
                    sync_last_60_days()
        else:
            sync_last_60_days()

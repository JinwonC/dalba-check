"""TikTok Shop Video Performance (신규 202605) 테스트 적재

/analytics/202605/shop_videos/performance 를 호출해 응답 필드를
동적으로 평탄화하여 '영상성과_신API테스트' 탭에 그대로 덤프한다.
프로덕션 '전체 영상성과데이터' 탭(202409)은 건드리지 않는다.
신규 필드: creator(open_id/user_name/nick_name/author_type), duration,
hash_tags, gpm, avg_customers, items_sold, latest_available_date 등
"""
import hashlib
import hmac
import json
import sys
import time
from urllib.parse import urlencode, quote

import requests
from google.oauth2.service_account import Credentials
import gspread
from token_manager import get_valid_token, handle_token_expired

# tiktok_to_sheets.py 와 동일한 설정
VIDEO_APP_KEY = "6jd7l2nu36rd4"
VIDEO_APP_SECRET = "9ab6f9c3467d53c72ca6e346c18b8071338f0ce4"
VIDEO_ACCESS_TOKEN = "TTP_8qmwDAAAAAAKxe5s-tyxQjFx-BLmHCzEUHx_N8KtbJs8REguA-PlojAyV0wGbdEfcH65GTeVkz7R1pOu5g44xImqf4SrMwS1YxCDFaFiR71wCyyvCuiX9V4xVHdkwwVZjC2fEb9DckyVqVjeUiW-H2PBtsmHPpwLM6krtq-pI3-bR3oq5XS_LA"
VIDEO_REFRESH_TOKEN = "TTP_77fQXQAAAACRYHgjQ_4vEa-Xhe5ikMt0yvs0Zs2i5flXWHMzwGflyAsL_dJ53tHERRwYkVRh9AI"
VIDEO_SHOP_CIPHER = "TTP_uE19hAAAAADx5Flb4Y_fjmWFiQfOEyTT"

SPREADSHEET_ID = "1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g"
TEST_SHEET_NAME = "영상성과_신API테스트"
SERVICE_ACCOUNT_FILE = "service_account.json"

PATH = "/analytics/202605/shop_videos/performance"
BASE = "https://open-api.tiktokglobalshop.com"


def make_sign(path: str, params: dict) -> str:
    s = VIDEO_APP_SECRET + path
    for k in sorted(params.keys()):
        s += k + str(params[k])
    s += VIDEO_APP_SECRET
    return hmac.new(VIDEO_APP_SECRET.encode(), s.encode(), hashlib.sha256).hexdigest()


def fetch_page(start: str, end: str, page_token: str | None):
    params = {
        "app_key": VIDEO_APP_KEY,
        "shop_cipher": VIDEO_SHOP_CIPHER,
        "start_date_ge": start,
        "end_date_lt": end,
        "page_size": "100",
        "account_type": "ALL",
        "currency": "USD",
        "sort_field": "gmv",
        "sort_order": "DESC",
        "timestamp": str(int(time.time())),
    }
    if page_token:
        params["page_token"] = page_token
    params["sign"] = make_sign(PATH, params)
    url = BASE + PATH + "?" + urlencode(params, quote_via=quote)
    headers = {"content-type": "application/json",
               "x-tts-access-token": get_valid_token(VIDEO_ACCESS_TOKEN, VIDEO_REFRESH_TOKEN)}
    for attempt in range(1, 4):
        try:
            d = requests.get(url, headers=headers, timeout=30).json()
            if d.get("code") == 0:
                return d
            if d.get("code") == 105002:
                new_token = handle_token_expired(VIDEO_REFRESH_TOKEN)
                if new_token:
                    headers["x-tts-access-token"] = new_token
                    continue
            print(f"  [경고] code={d.get('code')}, msg={d.get('message')} (시도 {attempt}/3)")
        except Exception as e:
            print(f"  [오류] {e} (시도 {attempt}/3)")
        time.sleep(2 * attempt)
    return None


def flatten(obj, prefix="") -> dict:
    """중첩 dict/list를 점표기 1-depth로 평탄화.
    products는 상품ID만 콤마로 나열, 그 외 list는 JSON 문자열."""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                out.update(flatten(v, key))
            elif isinstance(v, list):
                if k == "products":
                    out[key] = ", ".join(
                        str(p.get("id", "")) for p in v if isinstance(p, dict))
                else:
                    out[key] = json.dumps(v, ensure_ascii=False)[:1000]
            else:
                out[key] = v
    return out


# 청크 조회 후 영상별 합산 시 단순 합산 가능한(가산적) 필드
ADDITIVE = {"gmv.amount", "views", "sku_orders", "items_sold"}


def fetch_range(start: str, end: str) -> list[dict] | None:
    """한 기간을 전체 페이지네이션으로 조회. 기간 오류(28001022 등)면 None."""
    out = []
    token = None
    page = 0
    while True:
        page += 1
        d = fetch_page(start, end, token)
        if not d:
            return None if page == 1 else out
        out.extend(d.get("data", {}).get("videos") or [])
        nt = d.get("data", {}).get("next_page_token") or None
        if not nt or nt == token:
            return out
        token = nt
        time.sleep(0.3)


def main():
    from datetime import datetime, timedelta
    raw = sys.argv[1] if len(sys.argv) > 1 else "2026-07-20 ~ 2026-07-27"
    import re
    nums = re.findall(r"\d{4}-\d{1,2}-\d{1,2}", raw)
    start = nums[0]
    end = nums[1] if len(nums) > 1 else nums[0]
    print(f"\n=== Shop Video Performance 202605 테스트 [{start} ~ {end}] ===")

    # 신규 API는 조회 기간 제한이 있어 30일 청크로 분할, 실패 시 7일로 축소
    merged: dict[str, dict] = {}
    all_keys: list[str] = []
    s_dt = datetime.strptime(start, "%Y-%m-%d")
    e_dt = datetime.strptime(end, "%Y-%m-%d")
    chunk_days = 30
    cur = s_dt
    while cur <= e_dt:
        c_end = min(cur + timedelta(days=chunk_days - 1), e_dt)
        cs, ce = cur.strftime("%Y-%m-%d"), c_end.strftime("%Y-%m-%d")
        print(f"  청크 조회: {cs} ~ {ce}")
        vids = fetch_range(cs, ce)
        if vids is None and chunk_days > 7:
            print(f"    → 실패, 청크를 7일로 축소해 재시도")
            chunk_days = 7
            continue
        for v in (vids or []):
            f = flatten(v)
            vid = str(f.get("id", ""))
            for k in f:
                if k not in all_keys:
                    all_keys.append(k)
            if vid in merged:
                m = merged[vid]
                for k in ADDITIVE:  # 가산 필드는 청크 간 합산
                    try:
                        m[k] = float(m.get(k) or 0) + float(f.get(k) or 0)
                    except (TypeError, ValueError):
                        pass
                # 그 외 필드는 최신 청크 값으로 갱신
                for k, val in f.items():
                    if k not in ADDITIVE:
                        m[k] = val
            else:
                merged[vid] = f
        cur = c_end + timedelta(days=1)

    videos_flat = list(merged.values())
    # 포스팅일이 시작일 이후인 영상만, 포스팅일 오름차순(과거→최신) 정렬
    videos_flat = [v for v in videos_flat if str(v.get("video_post_time", ""))[:10] >= start]
    videos_flat.sort(key=lambda v: str(v.get("video_post_time", "")))

    print(f"  총 {len(videos_flat)}개 영상 (포스팅일 {start} 이후, 중복제거·합산), 필드 {len(all_keys)}개")
    print(f"  필드 목록: {all_keys}")

    if not videos_flat:
        print("  데이터 없음 - 종료")
        return

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"])
    ss = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)
    try:
        sheet = ss.worksheet(TEST_SHEET_NAME)
        sheet.clear()  # 테스트 탭은 매번 초기화 후 새로 씀
    except gspread.WorksheetNotFound:
        sheet = ss.add_worksheet(title=TEST_SHEET_NAME, rows="1000", cols=str(max(len(all_keys), 10)))
    # 데이터 크기에 맞게 그리드 확장
    sheet.resize(rows=len(videos_flat) + 10, cols=max(len(all_keys), 10))

    rows = [all_keys]
    for f in videos_flat:
        rows.append([f.get(k, "") for k in all_keys])

    for attempt in range(1, 9):
        try:
            sheet.update(rows, value_input_option="USER_ENTERED")
            sheet.freeze(rows=1)
            print(f"  ✅ '{TEST_SHEET_NAME}' 탭에 {len(rows)-1}행 저장 완료")
            return
        except Exception as e:
            if attempt == 8:
                raise
            wait = min(3 * attempt, 30)
            print(f"  시트 쓰기 실패 (시도 {attempt}/8), {wait}초 후 재시도... ({e})")
            time.sleep(wait)


if __name__ == "__main__":
    main()

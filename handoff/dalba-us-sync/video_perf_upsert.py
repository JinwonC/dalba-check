"""pickdi video list 탭 UPSERT (행 위치 보존, 순수 append)

- 1행 배너 / 2행 헤더 / 3행부터 데이터 구조
- 기존 행은 '그 자리에서' 값만 갱신 (전체 재정렬 안 함 → 행 위치 절대 안 바뀜)
- 신규 영상은 '무조건 맨 아래'에만 차곡차곡 추가 (중간 삽입 없음)
- 갱신 대상 기간(window)만 조회하므로 매일 돌려도 가볍다

사용:
  python video_perf_upsert.py            # 최근 45일 조회 후 upsert
  python video_perf_upsert.py 60         # 최근 60일
  python video_perf_upsert.py full       # 2026-01-01 ~ 오늘 전체 재조회
"""
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

import requests
from google.oauth2.service_account import Credentials
import gspread
from token_manager import get_valid_token, handle_token_expired

# 비밀값은 환경변수로만 받는다 (GitHub secrets). 토큰은 tokens.json (token_manager 참고)
VIDEO_APP_KEY = os.environ.get("TIKTOK_APP_KEY", "")
VIDEO_APP_SECRET = os.environ.get("TIKTOK_APP_SECRET", "")
VIDEO_ACCESS_TOKEN = None   # tokens.json에서 읽음
VIDEO_REFRESH_TOKEN = None  # tokens.json에서 읽음
VIDEO_SHOP_CIPHER = os.environ.get("TIKTOK_SHOP_CIPHER", "")

SPREADSHEET_ID = "1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g"
SHEET_NAME = "pickdi video list"   # (구 '영상성과_신API테스트'에서 리네임)
HEADER_ROW = 2                     # 1행은 배너, 실제 헤더는 2행, 데이터는 3행부터
SERVICE_ACCOUNT_FILE = "service_account.json"

BASE = "https://open-api.tiktokglobalshop.com"
LIST_PATH = "/analytics/202605/shop_videos/performance"
LA_TZ = timezone(timedelta(hours=-8))
DEFAULT_WINDOW_DAYS = 45
FULL_START = "2026-01-01"


def make_sign(path: str, params: dict) -> str:
    s = VIDEO_APP_SECRET + path
    for k in sorted(params.keys()):
        s += k + str(params[k])
    s += VIDEO_APP_SECRET
    return hmac.new(VIDEO_APP_SECRET.encode(), s.encode(), hashlib.sha256).hexdigest()


def api_get(extra: dict):
    params = {"app_key": VIDEO_APP_KEY, "shop_cipher": VIDEO_SHOP_CIPHER,
              "currency": "USD", "timestamp": str(int(time.time())), **extra}
    params["sign"] = make_sign(LIST_PATH, params)
    url = BASE + LIST_PATH + "?" + urlencode(params, quote_via=quote)
    headers = {"content-type": "application/json",
               "x-tts-access-token": get_valid_token(VIDEO_ACCESS_TOKEN, VIDEO_REFRESH_TOKEN)}
    for attempt in range(1, 4):
        try:
            d = requests.get(url, headers=headers, timeout=30).json()
            if d.get("code") == 0:
                return d
            if d.get("code") == 105002:
                nt = handle_token_expired(VIDEO_REFRESH_TOKEN)
                if nt:
                    headers["x-tts-access-token"] = nt
                    continue
            if d.get("code") == 28001022:
                return {"__range_error__": True}
            print(f"  [경고] code={d.get('code')} msg={str(d.get('message'))[:70]} (시도 {attempt}/3)", flush=True)
        except Exception as e:
            print(f"  [오류] {e} (시도 {attempt}/3)", flush=True)
        time.sleep(2 * attempt)
    return None


def flatten(obj, prefix="") -> dict:
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                out.update(flatten(v, key))
            elif isinstance(v, list):
                if key == "products":     # 상품ID만
                    out[key] = ", ".join(
                        str(x.get("id", "")) if isinstance(x, dict) else str(x) for x in v)
                else:
                    out[key] = json.dumps(v, ensure_ascii=False)[:1000]
            else:
                out[key] = v
    return out


ADDITIVE = {"gmv.amount", "views", "sku_orders", "items_sold"}


def fetch_window(start: str, end: str) -> dict[str, dict]:
    """기간을 30일(실패 시 7일) 청크로 조회하고 영상ID 기준 병합."""
    merged: dict[str, dict] = {}
    s_dt = datetime.strptime(start, "%Y-%m-%d")
    e_dt = datetime.strptime(end, "%Y-%m-%d")
    chunk = 30
    cur = s_dt
    while cur <= e_dt:
        c_end = min(cur + timedelta(days=chunk - 1), e_dt)
        cs, ce = cur.strftime("%Y-%m-%d"), c_end.strftime("%Y-%m-%d")
        print(f"  [조회] {cs} ~ {ce}", flush=True)
        token = None
        shrink = False
        while True:
            d = api_get({"start_date_ge": cs, "end_date_lt": ce, "page_size": "100",
                         "account_type": "ALL", "sort_field": "gmv", "sort_order": "DESC",
                         **({"page_token": token} if token else {})})
            if d and d.get("__range_error__") and chunk > 7:
                chunk = 7
                shrink = True
                break
            if not d or d.get("__range_error__"):
                break
            for v in d.get("data", {}).get("videos") or []:
                f = flatten(v)
                vid = str(f.get("id", ""))
                if not vid:
                    continue
                if vid in merged:
                    for k in ADDITIVE:
                        try:
                            merged[vid][k] = float(merged[vid].get(k) or 0) + float(f.get(k) or 0)
                        except (TypeError, ValueError):
                            pass
                    for k, val in f.items():
                        if k not in ADDITIVE:
                            merged[vid][k] = val
                else:
                    merged[vid] = f
            nt = d.get("data", {}).get("next_page_token") or None
            if not nt or nt == token:
                break
            token = nt
            time.sleep(0.25)
        if not shrink:
            cur = c_end + timedelta(days=1)
    return merged


def col_letter(idx0: int) -> str:
    """0-based 컬럼 인덱스 → A1 표기 (AA 이상 지원)."""
    n, s = idx0 + 1, ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    today = datetime.now(LA_TZ).date()
    if arg == "full":
        start, end = FULL_START, today.strftime("%Y-%m-%d")
    else:
        days = int(arg) if arg.isdigit() else DEFAULT_WINDOW_DAYS
        start = (today - timedelta(days=days)).strftime("%Y-%m-%d")
        end = today.strftime("%Y-%m-%d")
    print(f"\n=== 영상성과 UPSERT [{start} ~ {end}] ===", flush=True)
    if not (VIDEO_APP_KEY and VIDEO_APP_SECRET and VIDEO_SHOP_CIPHER):
        print("❌ 환경변수 TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_SHOP_CIPHER 필요"); sys.exit(1)

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"])
    ss = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)
    sheet = ss.worksheet(SHEET_NAME)

    # 기존 시트의 헤더/행 위치 파악 (레이아웃 그대로 사용)
    # pickdi 탭: 1행 배너 / 2행 헤더 / 3행부터 데이터
    existing = sheet.get_all_values()
    if len(existing) < HEADER_ROW:
        print(f"  시트에 헤더({HEADER_ROW}행)가 없음 — 초기 적재부터 필요")
        return
    header = existing[HEADER_ROW - 1]
    if "id" not in header:
        print(f"  ❌ {HEADER_ROW}행에서 'id' 컬럼을 못 찾음: {header[:8]}...")
        sys.exit(1)
    id_idx = header.index("id")
    last_col = col_letter(len(header) - 1)

    id_to_row: dict[str, int] = {}
    for r, row in enumerate(existing[HEADER_ROW:], start=HEADER_ROW + 1):
        if len(row) > id_idx:
            vid = str(row[id_idx]).strip().lstrip("'")
            if vid:
                id_to_row[vid] = r
    print(f"  기존 {len(id_to_row)}개 영상 / 헤더 {len(header)}열", flush=True)

    fetched = fetch_window(start, end)
    print(f"  조회 결과 {len(fetched)}개 영상", flush=True)

    updates = []
    appends = []
    for vid, f in fetched.items():
        if vid in id_to_row:                       # 자리 유지하고 값만 갱신
            r = id_to_row[vid]
            old = existing[r - 1] if r - 1 < len(existing) else []
            # API가 주지 않는 열(수동 추가한 메모/수식 등)은 기존 값을 그대로 보존
            row_vals = [
                f[h] if h in f else (old[ci] if ci < len(old) else "")
                for ci, h in enumerate(header)
            ]
            updates.append({"range": f"'{SHEET_NAME}'!A{r}:{last_col}{r}",
                            "values": [row_vals]})
        else:
            row_vals = [f.get(h, "") for h in header]
            # 신규는 맨 아래 추가 — 단, 이 탭의 범위(2026-01-01 이후 포스팅)만 유지
            if str(f.get("video_post_time", ""))[:10] >= FULL_START:
                appends.append(row_vals)

    print(f"  갱신 {len(updates)}행 / 신규 {len(appends)}행", flush=True)

    def with_retry(fn, label):
        for attempt in range(1, 9):
            try:
                return fn()
            except Exception as e:
                if attempt == 8:
                    raise
                wait = min(3 * attempt, 30)
                print(f"    {label} 실패 (시도 {attempt}/8), {wait}초 후 재시도... ({e})", flush=True)
                time.sleep(wait)

    # 갱신은 500개씩 나눠서 batchUpdate
    for i in range(0, len(updates), 500):
        part = updates[i:i + 500]
        with_retry(lambda: ss.values_batch_update(
            {"valueInputOption": "USER_ENTERED", "data": part}), "갱신")
        print(f"    갱신 진행 {min(i+500, len(updates))}/{len(updates)}", flush=True)

    if appends:
        # 신규 블록만 게시일 순으로 정렬해서 하단에 차곡차곡 추가 (기존 행은 건드리지 않음)
        i_post = header.index("video_post_time") if "video_post_time" in header else None
        if i_post is not None:
            appends.sort(key=lambda r: str(r[i_post]))
        with_retry(lambda: sheet.append_rows(appends, value_input_option="USER_ENTERED"), "신규 추가")

    # ⚠️ 전체 재정렬 없음 (의도적): 기존 행은 제자리, 신규는 무조건 맨 아래로만 쌓임.
    #    → 행이 갑자기 바뀌거나 과거날짜 신규가 중간에 끼어드는 일이 없다.

    print(f"  ✅ 완료 — 갱신 {len(updates)}행, 신규 {len(appends)}행 (맨 아래 추가, 재정렬 없음)", flush=True)


if __name__ == "__main__":
    main()

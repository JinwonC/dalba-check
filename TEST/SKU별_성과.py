"""SKU별 성과 → Google Sheets '(중요) SKU Order' 탭

- 지정 기간(또는 최근 며칠)을 조회.
- 날짜 기준 UPSERT: 새로 데이터가 들어온 날짜만 기존 행을 교체하고 재기록.
  · TikTok SKU 분석은 확정이 ~1일 늦어, 새벽 실행 시 '어제'가 빈 응답인 경우가 많음.
  · 그래서 매일 '최근 4일'을 재조회 → 늦게 확정된 날 자동 보정 + 구멍 자동 복구.
  · 빈 응답(아직 미확정)인 날은 기존 데이터를 건드리지 않음(삭제 방지).
"""
from _공통 import call_api, SERVICE_ACCOUNT_FILE
from datetime import datetime, timedelta
from google.oauth2.service_account import Credentials
import gspread, re, sys, time

SPREADSHEET_ID = "15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o"
SHEET_NAME = "(중요, 자동) SKU Order"
PATH = "/analytics/202509/shop_skus/performance"

HEADERS = ["날짜", "상품ID", "SKU ID", "SKU주문수", "판매수량", "GMV", "통화"]


def get_target_sheet():
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"]
    )
    spreadsheet = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)
    try:
        return spreadsheet.worksheet(SHEET_NAME)
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows="5000", cols="10")
        print(f"  시트 '{SHEET_NAME}' 새로 생성됨")
        return sheet


def parse_date_range(raw: str):
    nums = re.findall(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}", raw)
    if len(nums) == 1:
        return nums[0], nums[0]
    if len(nums) >= 2:
        return re.sub(r"[./]", "-", nums[0]), re.sub(r"[./]", "-", nums[1])
    raise ValueError("날짜 형식 오류. 예: 2026-05-01 또는 2026-05-01 ~ 2026-05-15")


def run(date_str: str):
    next_day = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    page_token = None
    all_rows = []
    while True:
        params = {
            "start_date_ge": date_str,
            "end_date_lt": next_day,
            "currency": "USD",
            "page_size": "100",
            "sort_field": "gmv",
            "sort_order": "DESC",
        }
        if page_token:
            params["page_token"] = page_token
        result = call_api(PATH, params)
        if not result:
            break
        data = result.get("data") or {}
        for item in (data.get("skus") or []):
            gmv = item.get("gmv") or {}
            all_rows.append([
                date_str,
                "'" + str(item.get("product_id") or ""),
                "'" + str(item.get("id") or ""),
                item.get("sku_orders") or 0,
                item.get("units_sold") or 0,
                gmv.get("amount") or 0,
                gmv.get("currency") or "USD",
            ])
        next_token = data.get("next_page_token")
        if not next_token or next_token == page_token:
            break
        page_token = next_token
    return all_rows


def with_retry(fn, label):
    for attempt in range(1, 6):
        try:
            return fn()
        except Exception as e:
            if attempt == 5:
                raise
            print(f"  {label} 실패 (시도 {attempt}/5): {e}")
            time.sleep(3 * attempt)


def upsert_by_date(sheet, replace_dates: set, new_rows: list):
    """replace_dates 날짜의 기존 행만 제거하고 new_rows로 교체(재기록)."""
    existing = with_retry(lambda: sheet.get_all_values(), "시트 읽기") or []
    has_header = bool(existing and existing[0] and str(existing[0][0]).strip() == HEADERS[0])
    data_rows = existing[1:] if has_header else existing
    old_len = len(existing)

    kept = [r for r in data_rows if not (r and str(r[0]).strip() in replace_dates)]
    # 새 블록은 날짜 오름차순 정렬(보기 좋게)
    new_sorted = sorted(new_rows, key=lambda r: str(r[0]))
    final = [HEADERS] + kept + new_sorted

    # 기존 범위를 넉넉히 비우고 한 번에 기록
    clear_to = max(old_len, len(final)) + 10
    with_retry(lambda: sheet.batch_clear([f"A1:H{clear_to}"]), "clear")
    with_retry(lambda: sheet.spreadsheet.values_update(
        f"'{SHEET_NAME}'!A1",
        params={"valueInputOption": "USER_ENTERED"},
        body={"values": final}), "기록")
    try:
        sheet.freeze(rows=1)
    except Exception:
        pass
    return len(kept), len(new_sorted)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].strip():
        raw = sys.argv[1]
        start_str, end_str = parse_date_range(raw)
    else:
        # 인자 없으면 최근 4일 (LA 기준 어제~4일전)
        from datetime import timezone
        LA = timezone(timedelta(hours=-8))
        today = datetime.now(LA).date()
        end_str = (today - timedelta(days=1)).strftime("%Y-%m-%d")
        start_str = (today - timedelta(days=4)).strftime("%Y-%m-%d")

    sheet = get_target_sheet()
    current = datetime.strptime(start_str, "%Y-%m-%d")
    end = datetime.strptime(end_str, "%Y-%m-%d")

    all_new = []
    replace_dates = set()
    while current <= end:
        date_str = current.strftime("%Y-%m-%d")
        print(f"\n=== SKU별 성과 [{date_str}] ===", flush=True)
        rows = run(date_str)
        if rows:
            all_new.extend(rows)
            replace_dates.add(date_str)   # 데이터 들어온 날만 교체 대상
            print(f"  {len(rows)}행 조회", flush=True)
        else:
            print("  데이터 없음(미확정) → 기존 값 보존", flush=True)
        current += timedelta(days=1)

    if replace_dates:
        kept, added = upsert_by_date(sheet, replace_dates, all_new)
        print(f"\n✅ 업서트 완료 — 교체 날짜 {sorted(replace_dates)} / 유지 {kept}행 + 신규 {added}행", flush=True)
    else:
        print("\n조회 기간에 확정 데이터가 없어 시트 변경 없음", flush=True)

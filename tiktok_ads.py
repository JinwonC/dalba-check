"""TikTok Ads API (GMV MAX) → Google Sheets
  - 광고성과  : 캠페인별 일별 요약
  - 광고소재성과: 소재(item_id)별 일별 상세
"""
import json
import os
import time
import re

import requests
from google.oauth2.service_account import Credentials
import gspread

# ─────────────────────────────────────────
# 설정
# ─────────────────────────────────────────
ADVERTISER_ID        = "7573855166672355345"
STORE_ID             = "7494221571082258140"

SPREADSHEET_ID       = "1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA"
SERVICE_ACCOUNT_FILE = "service_account.json"
TOKEN_FILE           = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ads_tokens.json")

BASE = "https://business-api.tiktok.com/open_api/v1.3"
GMV_REPORT_URL = f"{BASE}/gmv_max/report/get/"
ADGROUP_URL    = f"{BASE}/adgroup/get/"

# ── 캠페인 요약 ──
CAMP_SHEET   = "광고성과"
CAMP_DIMS    = ["stat_time_day", "campaign_id"]
CAMP_METRICS = ["cost", "orders", "gross_revenue", "roi"]
CAMP_HEADERS = ["날짜", "캠페인ID", "지출금액", "주문수", "총매출(GMV)", "ROI"]

# ── 소재 상세 ──
ITEM_SHEET   = "광고소재성과"
ITEM_DIMS    = ["stat_time_day", "item_id"]
ITEM_METRICS = [
    "creative_delivery_status",
    "cost", "orders", "cost_per_order", "gross_revenue", "roi",
    "product_impressions", "product_clicks", "product_click_rate",
    "ad_click_rate", "ad_conversion_rate",
    "ad_video_view_rate_2s", "ad_video_view_rate_6s",
    "ad_video_view_rate_p25", "ad_video_view_rate_p50",
    "ad_video_view_rate_p75", "ad_video_view_rate_p100",
]
ITEM_HEADERS = [
    "날짜", "소재ID", "캠페인ID", "캠페인명", "아이템그룹ID", "아이템그룹명",
    "게재상태", "지출금액", "주문수", "주문당비용", "총매출(GMV)", "ROI",
    "상품노출수", "상품클릭수", "상품클릭률",
    "광고클릭률", "광고전환율",
    "2초시청률", "6초시청률", "25%시청률", "50%시청률", "75%시청률", "100%시청률",
]


# ─────────────────────────────────────────
# 공통
# ─────────────────────────────────────────
def get_token() -> str:
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            return json.load(f).get("access_token", "")
    raise FileNotFoundError("ads_tokens.json 없음. get_ads_token.py 먼저 실행하세요.")


def parse_date_range(raw: str):
    nums = re.findall(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}", raw)
    if len(nums) < 2:
        raise ValueError("날짜 형식 오류. 예: 2026-05-01 ~ 2026-05-15")
    def norm(s): return re.sub(r"[./]", "-", s)
    return norm(nums[0]), norm(nums[1])


def api_get(url, token, params):
    for attempt in range(1, 4):
        try:
            r = requests.get(url, headers={"Access-Token": token}, params=params, timeout=30)
            d = r.json()
            if d.get("code") == 0:
                return d
            print(f"  [경고] code={d.get('code')}, msg={d.get('message')} (시도 {attempt}/3)")
            if d.get("code") == 40002:
                return None
        except Exception as e:
            print(f"  [오류] {e} (시도 {attempt}/3)")
        time.sleep(2 * attempt)
    return None


# ─────────────────────────────────────────
# 캠페인 요약
# ─────────────────────────────────────────
def fetch_campaign_rows(token, start_date, end_date) -> list[list]:
    rows, page = [], 1
    while True:
        print(f"  [캠페인] 페이지 {page}...")
        d = api_get(GMV_REPORT_URL, token, {
            "advertiser_id": ADVERTISER_ID,
            "store_ids": json.dumps([STORE_ID]),
            "dimensions": json.dumps(CAMP_DIMS),
            "metrics": json.dumps(CAMP_METRICS),
            "start_date": start_date, "end_date": end_date,
            "page": page, "page_size": 1000,
        })
        if not d:
            break
        for item in d.get("data", {}).get("list", []):
            dims, mets = item["dimensions"], item["metrics"]
            rows.append([
                dims.get("stat_time_day", "")[:10],
                dims.get("campaign_id", ""),
                mets.get("cost", ""), mets.get("orders", ""),
                mets.get("gross_revenue", ""), mets.get("roi", ""),
            ])
        if page >= d.get("data", {}).get("page_info", {}).get("total_page", 1):
            break
        page += 1
        time.sleep(0.3)
    return rows


# ─────────────────────────────────────────
# 소재 상세: 캠페인ID 수집 → adgroup 조회 → 소재 리포트
# ─────────────────────────────────────────
def get_gmv_campaign_ids(token, start_date, end_date) -> list[str]:
    """GMV MAX 리포트에서 campaign_id 목록 추출"""
    ids, page = set(), 1
    while True:
        d = api_get(GMV_REPORT_URL, token, {
            "advertiser_id": ADVERTISER_ID,
            "store_ids": json.dumps([STORE_ID]),
            "dimensions": json.dumps(["stat_time_day", "campaign_id"]),
            "metrics": json.dumps(["cost"]),
            "start_date": start_date, "end_date": end_date,
            "page": page, "page_size": 1000,
        })
        if not d:
            break
        for item in d.get("data", {}).get("list", []):
            ids.add(item["dimensions"]["campaign_id"])
        if page >= d.get("data", {}).get("page_info", {}).get("total_page", 1):
            break
        page += 1
        time.sleep(0.3)
    return list(ids)


def get_campaign_info(token, campaign_id: str) -> dict:
    """/campaign/gmv_max/info/ 로 item_group_ids 포함 캠페인 정보 반환"""
    try:
        r = requests.get(f"{BASE}/campaign/gmv_max/info/",
                         headers={"Access-Token": token},
                         params={"advertiser_id": ADVERTISER_ID, "campaign_id": campaign_id},
                         timeout=30)
        d = r.json()
        if d.get("code") == 0:
            return d.get("data", {})
    except Exception as e:
        print(f"  [오류] campaign info {campaign_id}: {e}")
    return {}


def fetch_item_rows(token, start_date, end_date,
                    campaign_id, adgroup_ids,
                    campaign_name, adgroup_map) -> list[list]:
    rows, page = [], 1
    while True:
        d = api_get(GMV_REPORT_URL, token, {
            "advertiser_id": ADVERTISER_ID,
            "store_ids": json.dumps([STORE_ID]),
            "dimensions": json.dumps(ITEM_DIMS),
            "metrics": json.dumps(ITEM_METRICS),
            "start_date": start_date, "end_date": end_date,
            "filtering": json.dumps({
                "campaign_ids": [campaign_id],
                "item_group_ids": adgroup_ids,
            }),
            "page": page, "page_size": 1000,
        })
        if not d:
            break
        for item in d.get("data", {}).get("list", []):
            dims, mets = item["dimensions"], item["metrics"]
            cost    = float(mets.get("cost") or 0)
            revenue = float(mets.get("gross_revenue") or 0)
            if cost == 0 and revenue == 0:
                continue
            gid = dims.get("item_group_id", "")
            g = adgroup_map.get(gid, {})
            item_id = dims.get("item_id", "")
            rows.append([
                dims.get("stat_time_day", "")[:10],
                "프로덕트카드" if item_id == "-1" else item_id,
                campaign_id, campaign_name,
                gid, g.get("adgroup_name", ""),
                mets.get("creative_delivery_status", ""),
                mets.get("cost", ""), mets.get("orders", ""),
                mets.get("cost_per_order", ""), mets.get("gross_revenue", ""),
                mets.get("roi", ""),
                mets.get("product_impressions", ""), mets.get("product_clicks", ""),
                mets.get("product_click_rate", ""),
                mets.get("ad_click_rate", ""), mets.get("ad_conversion_rate", ""),
                mets.get("ad_video_view_rate_2s", ""), mets.get("ad_video_view_rate_6s", ""),
                mets.get("ad_video_view_rate_p25", ""), mets.get("ad_video_view_rate_p50", ""),
                mets.get("ad_video_view_rate_p75", ""), mets.get("ad_video_view_rate_p100", ""),
            ])
        if page >= d.get("data", {}).get("page_info", {}).get("total_page", 1):
            break
        page += 1
        time.sleep(0.3)
    return rows


def fetch_all_item_rows(token, start_date, end_date) -> list[list]:
    print("  GMV MAX 캠페인 ID 수집 중...")
    campaign_ids = get_gmv_campaign_ids(token, start_date, end_date)
    if not campaign_ids:
        print("  캠페인 없음")
        return []
    print(f"  캠페인 {len(campaign_ids)}개 발견")

    all_rows = []
    for cid in campaign_ids:
        info = get_campaign_info(token, cid)
        cname = info.get("campaign_name", cid)
        item_group_ids = [str(g) for g in (info.get("item_group_ids") or [])]
        if not item_group_ids:
            continue
        # item_group_id → name 매핑 (이름 정보는 없으므로 ID만 사용)
        gmap = {gid: {"adgroup_name": gid} for gid in item_group_ids}
        print(f"  [{cname}] 소재 데이터 조회 중... ({len(item_group_ids)}개 그룹)")
        rows = fetch_item_rows(token, start_date, end_date, cid, item_group_ids, cname, gmap)
        all_rows.extend(rows)
        time.sleep(0.3)
    return all_rows


# ─────────────────────────────────────────
# Google Sheets
# ─────────────────────────────────────────
def get_or_create_sheet(spreadsheet, name, headers):
    try:
        sheet = spreadsheet.worksheet(name)
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet(title=name, rows="10000", cols=str(len(headers)))
        sheet.append_row(headers)
        sheet.freeze(rows=1)
        print(f"  시트 '{name}' 새로 생성됨")
    return sheet


def _append_with_retry(sheet, rows):
    for attempt in range(1, 9):
        try:
            sheet.append_rows(rows, value_input_option="USER_ENTERED")
            return
        except Exception as e:
            if attempt == 8:
                raise
            wait = min(3 * attempt, 30)
            print(f"  시트 쓰기 실패 (시도 {attempt}/8), {wait}초 후 재시도... ({e})")
            time.sleep(wait)


def save_missing_dates(sheet, rows, headers):
    """트레일링 윈도우(최근 N일) 수집분 중, 시트에 '그 날짜'가 아직 없는 날짜의 행만 하단에 추가.
    - 이미 적재된 날짜는 건너뜀 → 중복 없음
    - API가 0행 준 날(=데이터 아직 미생성)은 애초에 rows에 없으니 기존 데이터를 지우지 않음
    - 전날 0행이던 날이 다음 실행에서 데이터가 생기면 그때 자동으로 메워짐(자동복구)
    ⚠️ 254k행 전체를 재작성하지 않고 '맨 아래 append'만 하므로 대량 손실 위험이 없다."""
    if not sheet.row_values(1):
        sheet.append_row(headers)
        sheet.freeze(rows=1)
    if not rows:
        print("  수집된 데이터 없음 (API 0행) — 기존 데이터 유지, 추가 없음")
        return
    existing = sheet.col_values(1)[1:]  # A열(날짜), 헤더 제외
    existing_dates = {str(v).strip()[:10] for v in existing if str(v).strip()}
    by_date: dict[str, list] = {}
    for r in rows:
        d = str(r[0]).strip()[:10]
        by_date.setdefault(d, []).append(r)
    to_add, skipped = [], []
    for d in sorted(by_date):
        if d in existing_dates:
            skipped.append(d)
        else:
            to_add.extend(by_date[d])
    if skipped:
        print(f"  이미 적재된 날짜 건너뜀(중복 방지): {skipped}")
    if not to_add:
        print("  추가할 신규 날짜 없음 (윈도우 내 모든 날짜가 이미 적재됨)")
        return
    added = sorted({str(r[0]).strip()[:10] for r in to_add})
    _append_with_retry(sheet, to_add)
    print(f"  ✅ 신규 날짜 {added} → {len(to_add)}행 추가 완료")


# ─────────────────────────────────────────
# 메인
# ─────────────────────────────────────────
def main():
    import sys as _sys
    if len(_sys.argv) > 1:
        raw = _sys.argv[1]
    else:
        raw = input("기간 입력 (예: 2026-05-01 ~ 2026-05-15): ").strip()
    start_date, end_date = parse_date_range(raw)
    print(f"\n=== TikTok GMV MAX 광고 성과 [{start_date} ~ {end_date}] ===")

    token = get_token()

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"]
    )
    spreadsheet = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)

    # 1. 캠페인 요약 (트레일링 윈도우 → 누락 날짜만 추가)
    print("\n[1/2] 캠페인별 요약...")
    camp_rows = fetch_campaign_rows(token, start_date, end_date)
    print(f"  총 {len(camp_rows)}행 수집")
    save_missing_dates(get_or_create_sheet(spreadsheet, CAMP_SHEET, CAMP_HEADERS),
                       camp_rows, CAMP_HEADERS)

    # 2. 소재 상세 (트레일링 윈도우 → 누락 날짜만 추가)
    print("\n[2/2] 소재별 상세...")
    item_rows = fetch_all_item_rows(token, start_date, end_date)
    print(f"  총 {len(item_rows)}행 수집")
    save_missing_dates(get_or_create_sheet(spreadsheet, ITEM_SHEET, ITEM_HEADERS),
                       item_rows, ITEM_HEADERS)


if __name__ == "__main__":
    main()

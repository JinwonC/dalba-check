"""주문 API로 7~9월 전체 주문을 당겨 create_time(유닉스)→LA 변환 후
요일×시간 주문수/매출 집계. (단일 LA 기준 — 혼재 타임존 문제 없음)
검색 응답에 create_time/금액이 있으면 그대로, 없으면 상세조회로 보완."""
import hashlib, hmac, json, time
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from urllib.parse import urlencode, quote
import requests
from token_manager import get_valid_token, handle_token_expired

APP_KEY = "6jd7l2nu36rd4"
APP_SECRET = "9ab6f9c3467d53c72ca6e346c18b8071338f0ce4"
ACCESS_TOKEN = "TTP_8qmwDAAAAAAKxe5s-tyxQjFx-BLmHCzEUHx_N8KtbJs8REguA-PlojAyV0wGbdEfcH65GTeVkz7R1pOu5g44xImqf4SrMwS1YxCDFaFiR71wCyyvCuiX9V4xVHdkwwVZjC2fEb9DckyVqVjeUiW-H2PBtsmHPpwLM6krtq-pI3-bR3oq5XS_LA"
REFRESH_TOKEN = "TTP_77fQXQAAAACRYHgjQ_4vEa-Xhe5ikMt0yvs0Zs2i5flXWHMzwGflyAsL_dJ53tHERRwYkVRh9AI"
SHOP_CIPHER = "TTP_uE19hAAAAADx5Flb4Y_fjmWFiQfOEyTT"
BASE = "https://open-api.tiktokglobalshop.com"
SEARCH = "/order/202309/orders/search"
LA = ZoneInfo("America/Los_Angeles")

FROM = datetime(2026, 7, 1, tzinfo=LA)
TO = datetime(2026, 9, 16, tzinfo=LA)


def sign_post(path, params, body):
    s = APP_SECRET + path
    for k in sorted(params.keys()):
        s += k + str(params[k])
    s += body
    return hmac.new(APP_SECRET.encode(), (s + APP_SECRET).encode(), hashlib.sha256).hexdigest()


def main():
    orders_wh = [[0] * 24 for _ in range(7)]
    gmv_wh = [[0.0] * 24 for _ in range(7)]
    months = Counter()
    total = 0
    have_amount = 0
    page_token = None
    pages = 0
    body = json.dumps({"create_time_ge": int(FROM.timestamp()),
                       "create_time_lt": int(TO.timestamp())}, separators=(",", ":"))
    while True:
        params = {"app_key": APP_KEY, "page_size": "100", "shop_cipher": SHOP_CIPHER,
                  "sort_field": "create_time", "sort_order": "ASC", "timestamp": str(int(time.time()))}
        if page_token:
            params["page_token"] = page_token
        qp = dict(params); qp["sign"] = sign_post(SEARCH, params, body)
        headers = {"content-type": "application/json",
                   "x-tts-access-token": get_valid_token(ACCESS_TOKEN, REFRESH_TOKEN)}
        try:
            r = requests.post(BASE + SEARCH, params=qp, headers=headers, data=body, timeout=60).json()
        except Exception as e:
            print(f"[검색] 실패: {e}"); break
        if r.get("code") == 105002:
            handle_token_expired(REFRESH_TOKEN); continue
        if r.get("code") != 0:
            print(f"[검색] code={r.get('code')} msg={str(r.get('message'))[:100]}"); break
        data = r.get("data", {})
        arr = data.get("orders") or []
        if pages == 0 and arr:
            print("검색 응답 첫 주문 키:", list(arr[0].keys()), flush=True)
        for o in arr:
            ct = o.get("create_time")
            if not ct:
                continue
            dt = datetime.fromtimestamp(int(ct), LA)
            ds = dt.strftime("%Y-%m-%d")
            if ds < "2026-07-01" or ds > "2026-09-15":
                continue
            wd, h = dt.weekday(), dt.hour
            orders_wh[wd][h] += 1
            months[ds[:7]] += 1
            total += 1
            pay = o.get("payment") or {}
            amt = pay.get("total_amount") or o.get("total_amount")
            if amt not in (None, "", "0"):
                try:
                    gmv_wh[wd][h] += float(amt); have_amount += 1
                except (TypeError, ValueError):
                    pass
        pages += 1
        nt = data.get("next_page_token") or None
        if pages % 25 == 0:
            print(f"  ...{pages}페이지, 누적 {total}건", flush=True)
        if not nt or nt == page_token:
            break
        page_token = nt
        time.sleep(0.12)

    print(f"\n총 주문 {total}건 / 월별 {dict(months)}", flush=True)
    print(f"금액 있는 주문: {have_amount}건", flush=True)
    print("ORDERS_WH_LA=" + json.dumps(orders_wh), flush=True)
    print("GMV_WH_LA=" + json.dumps([[round(x, 1) for x in row] for row in gmv_wh]), flush=True)


if __name__ == "__main__":
    main()

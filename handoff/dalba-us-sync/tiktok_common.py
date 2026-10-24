"""TikTok Shop Partner API 공통 호출 (서명 + 토큰 갱신 재시도).

필요 환경변수: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SHOP_CIPHER  (+ tokens.json)
"""
import hashlib
import hmac
import os
import time
from urllib.parse import urlencode, quote

import requests

from token_manager import APP_KEY, APP_SECRET, get_valid_token, handle_token_expired, require_app_credentials

SHOP_CIPHER = os.environ.get("TIKTOK_SHOP_CIPHER", "")
BASE_URL = "https://open-api.tiktokglobalshop.com"
SERVICE_ACCOUNT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "service_account.json")


def make_sign(path: str, params: dict) -> str:
    s = APP_SECRET + path + "".join(k + str(params[k]) for k in sorted(params)) + APP_SECRET
    return hmac.new(APP_SECRET.encode(), s.encode(), hashlib.sha256).hexdigest()


def call_api(path: str, extra_params: dict) -> dict | None:
    """GET 호출. 성공(code 0)이면 응답 dict, 3회 실패면 None."""
    require_app_credentials()
    if not SHOP_CIPHER:
        raise SystemExit("❌ 환경변수 없음: TIKTOK_SHOP_CIPHER")
    token = get_valid_token()
    for attempt in range(1, 4):
        params = {"app_key": APP_KEY, "shop_cipher": SHOP_CIPHER,
                  "timestamp": str(int(time.time())), **extra_params}
        params["sign"] = make_sign(path, params)
        url = BASE_URL + path + "?" + urlencode(params, quote_via=quote)
        try:
            data = requests.get(url, headers={"x-tts-access-token": token,
                                              "content-type": "application/json"}, timeout=30).json()
            if data.get("code") == 0:
                return data
            if data.get("code") == 105002:
                print("  [토큰 만료] 자동 갱신 중...")
                token = handle_token_expired() or token
                continue
            print(f"  [경고] code={data.get('code')}, msg={data.get('message')} (시도 {attempt}/3)")
        except Exception as e:
            print(f"  [오류] {e} (시도 {attempt}/3)")
        time.sleep(2 * attempt)
    return None

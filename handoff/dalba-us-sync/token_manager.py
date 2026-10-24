"""TikTok Shop Partner API 토큰 관리.

비밀값은 코드에 두지 않는다.
  - 환경변수: TIKTOK_APP_KEY, TIKTOK_APP_SECRET
  - 파일: tokens.json  {"access_token": "...", "refresh_token": "..."}  (GitHub secret TOKENS_JSON으로 생성)

액세스 토큰이 만료되면(code 105002) refresh_token으로 갱신해 tokens.json에 다시 저장한다.
GitHub Actions에서는 러너가 끝나면 갱신된 파일이 사라지므로, 매 실행마다 시크릿의
refresh_token으로 새로 갱신한다. refresh_token 자체가 만료되면 재인증이 필요하다.
"""
import json
import os

import requests

APP_KEY = os.environ.get("TIKTOK_APP_KEY", "")
APP_SECRET = os.environ.get("TIKTOK_APP_SECRET", "")
TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokens.json")
REFRESH_URL = "https://auth.tiktok-shops.com/api/v2/token/refresh"


def require_app_credentials():
    missing = [n for n, v in (("TIKTOK_APP_KEY", APP_KEY), ("TIKTOK_APP_SECRET", APP_SECRET)) if not v]
    if missing:
        raise SystemExit(f"❌ 환경변수 없음: {', '.join(missing)}")


def load_tokens() -> dict:
    if not os.path.exists(TOKEN_FILE):
        return {}
    with open(TOKEN_FILE) as f:
        return json.load(f)


def save_tokens(access_token: str, refresh_token: str):
    with open(TOKEN_FILE, "w") as f:
        json.dump({"access_token": access_token, "refresh_token": refresh_token}, f)


def get_valid_token(*_unused) -> str:
    """tokens.json의 access_token. (예전 코드 호환용으로 인자는 받되 쓰지 않는다)"""
    token = load_tokens().get("access_token")
    if not token:
        raise SystemExit("❌ tokens.json에 access_token이 없음 (TOKENS_JSON 시크릿 확인)")
    return token


def handle_token_expired(*_unused) -> str | None:
    """refresh_token으로 액세스 토큰 갱신. 성공 시 새 access_token 반환."""
    require_app_credentials()
    refresh = load_tokens().get("refresh_token")
    if not refresh:
        print("  ❌ tokens.json에 refresh_token이 없음")
        return None
    data = requests.get(REFRESH_URL, params={
        "app_key": APP_KEY, "app_secret": APP_SECRET,
        "refresh_token": refresh, "grant_type": "refresh_token",
    }, timeout=30).json()
    if data.get("code") == 0:
        d = data.get("data", {})
        save_tokens(d["access_token"], d.get("refresh_token", refresh))
        print("  ✅ Access Token 자동 갱신 완료")
        return d["access_token"]
    print(f"  ❌ 토큰 갱신 실패: {data.get('message')} — refresh_token 만료 시 재인증 필요")
    return None

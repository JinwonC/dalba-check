"""DE 제품별 콘텐츠 트랙킹 — CRUVA REST API로 매일 자동 갱신 (UPSERT).

소스: CRUVA REST API  POST https://api.cruva.com/affiliate/videos/list
      (헤더 x-api-key / x-shop-id, 발행일 2026-08-01 ~ 오늘)
대상: 전체영상 탭 + 제품 탭(퍼스트/멀티밤)

동작 (행 위치 보존, 수기 입력 보존)
- 이미 있는 영상(Video ID 기준): 숫자 열만 제자리에서 갱신
    전체영상 : PID, 매출, 판매수량, 뷰
    제품 탭  : 제목, GMV, SKU ORDER, VIEW, 마지막 업데이트
  → 크리에이터 특징·SPARK CODE·Memo 등 수기 열은 절대 건드리지 않음
- 새 영상: 발행일 순으로 정렬해 맨 아래에만 추가 (중간 삽입·재정렬 없음)
- Video ID·PID·날짜·텍스트는 ' 접두로 텍스트 고정 (19자리 손실·수식 오인 방지)
- CRUVA는 DE 주문수를 주지 않아 SKU ORDER/판매수량에는 units_sold 사용

환경변수: CRUVA_API_KEY (GitHub secret)
사용: python de_cruva_sync.py [시작일 YYYY-MM-DD]   (기본 2026-08-01)
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

import gspread
import requests
from google.oauth2.service_account import Credentials

API = "https://api.cruva.com/affiliate/videos/list"
CRUVA_SHOP_ID = "69b9730aa1a5b8fcd72f0f40"          # CRUVA 내부 DE 스토어 ID
SPREADSHEET_ID = "1hKFtybX2aNkr-co1OKIseNhNSjq2wJLZvNzOOf3i4PU"   # DE 제품별 콘텐츠 트랙킹
SERVICE_ACCOUNT_FILE = "service_account.json"
DEFAULT_START = "2026-08-01"
PAGE_SIZE = 100
ALL_TAB = "전체영상"
PRODUCT_TABS = [  # (탭, PID, 제품명)
    ("퍼스트", "1729739716088469995", "퍼스트 스프레이 세럼"),
    ("멀티밤", "1729790543307774443", "멀티밤"),
]
TODAY = date.today().strftime("%Y-%m-%d")


# ───────────────────────── CRUVA ─────────────────────────
def api_page(key, d_from, d_to, page, just_count=False):
    body = {"filters": {"date_range": {"from": d_from, "to": d_to}},
            "page_size": PAGE_SIZE, "page_number": page}
    if just_count:
        body["just_count"] = True
    headers = {"Content-Type": "application/json", "x-api-key": key, "x-shop-id": CRUVA_SHOP_ID}
    for attempt in range(1, 7):
        r = requests.post(API, headers=headers, json=body, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(2 * attempt, 20))
            continue
        if r.status_code != 200:
            print(f"❌ CRUVA API {r.status_code}: {r.text[:300]}")
            sys.exit(1)
        return r.json()
    print("❌ CRUVA API 재시도 초과")
    sys.exit(1)


def month_chunks(start, end_excl):
    """API 페이지 깊이 한도(1만 행)를 피하려고 월 단위로 나눠 조회."""
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end_excl, "%Y-%m-%d").date()
    while s < e:
        nxt = (s.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield s.strftime("%Y-%m-%d"), min(nxt, e).strftime("%Y-%m-%d")
        s = nxt


def parse_products(v):
    p = v.get("products")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            p = [x.strip() for x in p.split(",") if x.strip()]
    lst = [str(x.get("id", x)) if isinstance(x, dict) else str(x) for x in (p or [])]
    if not lst and v.get("product"):
        lst = [str(v["product"])]
    return list(dict.fromkeys(lst))


def parse_date(s):
    s = str(s or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19] if "T" in s or " " in s else s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s[:10]


def fetch_videos(key, start):
    end_excl = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")   # 종료일 미포함 → 내일
    videos = {}
    for d_from, d_to in month_chunks(start, end_excl):
        page, got = 1, 0
        while True:
            data = api_page(key, d_from, d_to, page).get("data") or {}
            res = data.get("results") or []
            for v in res:
                vid = str(v.get("video_id") or "").strip()
                if not vid:
                    continue
                h = str(v.get("handle") or "").strip()
                videos[vid] = {
                    "date": parse_date(v.get("post_time")), "vid": vid, "handle": h,
                    "title": str(v.get("title") or "").replace("\n", " ").strip(),
                    "pids": parse_products(v),
                    "gmv": float(v.get("gmv") or 0),
                    "units": int(float(v.get("units_sold") or 0)),
                    "views": int(float(v.get("view_count") or v.get("views") or 0)),
                    "link": f"https://www.tiktok.com/@{h}/video/{vid}",
                }
            got += len(res)
            if not res or not data.get("has_more", len(res) == PAGE_SIZE):
                break
            page += 1
            time.sleep(0.15)
        cnt = api_page(key, d_from, d_to, 1, just_count=True)
        total = (cnt.get("data") or {}).get("total_count", cnt.get("total_count"))
        print(f"  CRUVA {d_from} ~ {d_to}(미포함): {got}개 수집 / 집계 {total}", flush=True)
        if total is not None and got < int(total):
            print(f"❌ {d_from} 구간을 덜 받음({got} < {total}) — 시트를 건드리지 않고 종료")
            sys.exit(1)
    return videos


# ───────────────────────── Sheets ─────────────────────────
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


def col_letter(n):  # 1-based
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def t(x):
    return "'" + x if x else ""


def upsert_tab(sheet, header_row, field_of, update_fields, videos, make_new_row):
    """header_row: 헤더 행 번호 / field_of: 헤더명→값 함수 / update_fields: 기존 행에서 갱신할 헤더명들."""
    vals = with_retry(lambda: sheet.get_values(
        value_render_option=gspread.utils.ValueRenderOption.unformatted), f"{sheet.title} 읽기")
    vals = [[("" if c is None else c) for c in r] for r in vals]
    header = [str(h).strip() for h in vals[header_row - 1]] if len(vals) >= header_row else []
    if "Video ID" not in header:
        print(f"❌ {sheet.title}: {header_row}행에 'Video ID' 헤더 없음 → 건너뜀")
        return False
    i_vid = header.index("Video ID")
    body = vals[header_row:]
    row_of = {}
    for i, r in enumerate(body):
        vid = str(r[i_vid] if len(r) > i_vid else "").strip().lstrip("'")
        if vid:
            row_of[vid] = header_row + 1 + i
    last_row = header_row + len(body)

    # 1) 기존 행: 지정 열만 열 단위로 통째로 다시 씀 (다른 열은 손대지 않음)
    data = []
    for name in update_fields:
        if name not in header:
            continue
        ci = header.index(name)
        col = []
        for i, r in enumerate(body):
            cur = r[ci] if len(r) > ci else ""
            vid = str(r[i_vid] if len(r) > i_vid else "").strip().lstrip("'")
            v = videos.get(vid)
            keep = ("'" + str(cur)) if (name in TEXT_FIELDS and cur != "") else cur
            col.append([field_of(name, v) if v else keep])
        if col:
            rng = f"'{sheet.title}'!{col_letter(ci + 1)}{header_row + 1}:{col_letter(ci + 1)}{last_row}"
            data.append({"range": rng, "values": col})
    updated = sum(1 for vid in row_of if vid in videos)
    if data:
        with_retry(lambda: sheet.spreadsheet.values_batch_update(
            {"valueInputOption": "USER_ENTERED", "data": data}), f"{sheet.title} 갱신")

    # 2) 새 영상: 발행일 순으로 맨 아래에만 추가
    new = sorted((v for vid, v in videos.items() if vid not in row_of), key=lambda v: (v["date"], v["vid"]))
    if new:
        rows = [make_new_row(header, v) for v in new]
        need = last_row + len(rows) + 10
        if sheet.row_count < need:
            with_retry(lambda: sheet.add_rows(need - sheet.row_count), f"{sheet.title} 행 추가")
        with_retry(lambda: sheet.update(rows, f"A{last_row + 1}", value_input_option="USER_ENTERED"),
                   f"{sheet.title} 신규 추가")
    print(f"✅ {sheet.title}: 갱신 {updated}행 / 신규 {len(new)}행 (맨 아래 추가, 재정렬 없음)", flush=True)
    return True


TEXT_FIELDS = {"Video ID", "PID", "제목", "크리에이터", "크리에이터 핸들", "포스팅일(LA)"}


def main():
    key = os.environ.get("CRUVA_API_KEY", "").strip()
    if not key:
        print("❌ CRUVA_API_KEY 환경변수가 없음 (GitHub secret 등록 필요)")
        sys.exit(1)
    start = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_START
    print(f"=== DE CRUVA 동기화 [{start} ~ {TODAY}] ===", flush=True)
    videos = fetch_videos(key, start)
    print(f"  총 {len(videos)}개 영상", flush=True)
    if not videos:
        print("❌ 받은 영상이 0개 — 시트를 건드리지 않고 종료")
        sys.exit(1)

    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    ss = gspread.authorize(creds).open_by_key(SPREADSHEET_ID)
    ok = True

    # ── 전체영상 (1행 헤더 / 2행부터 데이터) ──
    def all_field(name, v):
        return {"발행일자": v["date"], "PID": t(", ".join(v["pids"])), "Video ID": t(v["vid"]),
                "크리에이터 핸들": t(v["handle"]), "틱톡 비디오 링크": v["link"], "매출(EUR)": v["gmv"],
                "판매수량 (SKU 오더 대체)": v["units"], "뷰": v["views"]}.get(name, "")

    ok &= upsert_tab(ss.worksheet(ALL_TAB), 1, all_field,
                     ["PID", "매출(EUR)", "판매수량 (SKU 오더 대체)", "뷰"], videos,
                     lambda h, v: [all_field(x, v) for x in h])

    # ── 제품 탭 (1행 pid / 2행 헤더 / 3행부터 데이터) ──
    stamp = f"{TODAY} (CRUVA 기준)"
    for tab, pid, name in PRODUCT_TABS:
        mine = {vid: v for vid, v in videos.items() if pid in v["pids"]}

        def prod_field(h, v, pid=pid, name=name):
            return {"Video ID": t(v["vid"]),
                    "포스팅일(LA)": t(datetime.strptime(v["date"], "%Y-%m-%d").strftime("%m/%d/%Y")),
                    "크리에이터": t(v["handle"]), "제목": t(v["title"]), "GMV": v["gmv"], "화폐": "EUR",
                    "SKU ORDER": v["units"], "VIEW": v["views"], "PID": t(pid), "제품명": name,
                    "마지막 업데이트": stamp, "링크": v["link"]}.get(h, "")

        ok &= upsert_tab(ss.worksheet(tab), 2, prod_field,
                         ["제목", "GMV", "SKU ORDER", "VIEW", "마지막 업데이트"], mine,
                         lambda h, v, f=prod_field: [f(x, v) for x in h])

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

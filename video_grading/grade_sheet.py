"""
시트(첫 탭)의 영상들을 SKILL.md 기준으로 GOOD/OK/BAD 평가해서 오른쪽 열에 기록
사용: python video_grading/grade_sheet.py --sheet-id <ID> [--limit N] [--date YYYY-MM-DD] [--source auto|cruva|video]
- cruva: CRUVA가 영상마다 만들어 둔 AI 분석 데이터(대본·화면 자막·얼굴 노출·조명·훅 등)로 평가
         (CRUVA는 하루 영상의 2~8%만 분석해 둔다. 분석 없는 영상은 비워 둠)
- video: Apify로 영상 파일을 받아 컨택트시트(extract.py)+Whisper 대본으로 기준서 그대로 평가
- auto(기본): CRUVA 분석이 있으면 cruva, 없으면 video
- 등급 열이 비어 있는 행만 평가 (이미 평가한 행은 건너뜀 → 재실행 안전)
환경변수: ANTHROPIC_API_KEY, CRUVA_API_KEY, APIFY_TOKEN (GitHub secret)
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

import anthropic
import gspread
import requests
from google.oauth2.service_account import Credentials
from pydantic import BaseModel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILL_PATH = os.path.join(ROOT, ".claude", "skills", "video-grading", "SKILL.md")
SERVICE_ACCOUNT_FILE = os.path.join(ROOT, "service_account.json")
MODEL = "claude-opus-5-5"

CRUVA_API = "https://api.cruva.com/affiliate/videos/list"
CRUVA_SHOP_ID = "69b9712fd9c02f34547155d5"  # CRUVA 내부 US 스토어 ID
CRUVA_PAGE_SIZE = 100
APIFY_ACTOR = "clockworks/tiktok-scraper"

GRADE_HEADERS = ["등급", "자동BAD", "훅", "피부증명", "설명", "진정성", "제작품질", "플래그", "근거", "피드백", "평가일시"]

# 판매 성과는 등급 근거가 아니므로(SKILL.md) 모델에 넘기지 않는다
DROP_FIELDS = {"ad_spend", "commission", "cpa", "ctr", "gmv", "orders", "roi", "units_sold", "view_count",
               "like_count", "comment_count", "engagement_rate", "campaign_id", "campaign_step_id",
               "campaign_type", "usage_rights_id", "expiration_date", "shop_id", "ai_attempts",
               "ai_last_attempt_at", "analysis_time", "availability_checked_at", "unavailable_at"}

MODE_NOTE = """

---

## 이번 평가의 입력 형태 (위 '입력' 절보다 우선)
영상 프레임과 Whisper 대본 대신, CRUVA가 영상마다 만들어 둔 **AI 분석 데이터(JSON)**가 주어진다.
이 데이터로 평가하되, 근거 규칙은 그대로다.
- 대본: `transcript`(음성), 화면 자막: `on_screen_text`, 내용 요약: `content_overview`
- 화면 판단: `face_visible`, `is_faceless`, `is_ai`, `lighting_quality`, `product_visible_3s`, `product_screen_time_seconds`, `product_integration_type`
- 참고: `hooks`, `top_selling_points`, `misleading_claims`, `tone`, `target_audience`, `language`, `duration_ms`
- 자동 BAD: `is_faceless`/`face_visible`·`content_overview`로 사람 없이 제품만이면 PRODUCT_ONLY, `is_ai`가 참이면 AI_CONTENT, 대본과 화면 자막이 모두 비었으면 NO_TALK_NO_TEXT.
- **피부 증명**은 프레임을 직접 못 보므로 `content_overview`·대본·자막에 '얼굴에 직접 바르고 결과를 보여준다'는 근거가 있을 때만 YES. 손·손등만, 병만 들고 설명이면 NO. 근거가 없으면 NO로 두고 evidence에 "피부 증명 확인 불가(프레임 없음)"라고 쓴다.
- 제작 품질은 `lighting_quality`와 얼굴 노출로 판단한다.
- CRUVA의 `hooks.score` 같은 점수를 그대로 옮기지 말고 기준서의 YES/NO 기준으로 다시 판단한다.
- evidence는 데이터에서 본 근거를 필드명과 함께 쓴다(대본 인용은 짧게). evidence·feedback은 한국어로 쓴다.
"""

YN = Literal["YES", "NO"]
USAGE = {"in": 0, "cache": 0, "out": 0}


class Grade(BaseModel):
    video_id: str
    gate: Optional[Literal["PRODUCT_ONLY", "AI_CONTENT", "NO_TALK_NO_TEXT"]]
    hook: YN
    proof_on_skin: YN
    explanation: YN
    authenticity: YN
    production: Literal["GOOD", "BAD"]
    grade: Literal["GOOD", "OK", "BAD"]
    flags: List[Literal["CLAIM", "MISINFO", "NON_EN", "PROFANITY", "LONG"]]
    evidence: str
    feedback: str


def notice(msg: str):
    # Actions 로그는 이 세션에서 못 읽으므로 요약(annotation)으로도 남긴다
    print(f"::notice::{msg}")


def col_letter(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def open_sheet(sheet_id: str):
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return gspread.authorize(creds).open_by_key(sheet_id).get_worksheet_by_id(0)


def cruva_videos(key: str, d_from: str, d_to: str) -> dict[str, dict]:
    """CRUVA 영상 목록(포스팅일 d_from 이상 d_to 미만) → {video_id: 분석 데이터}"""
    headers = {"Content-Type": "application/json", "x-api-key": key, "x-shop-id": CRUVA_SHOP_ID}
    out, page = {}, 1
    while True:
        body = {"filters": {"date_range": {"from": d_from, "to": d_to}},
                "page_size": CRUVA_PAGE_SIZE, "page_number": page}
        for attempt in range(1, 7):
            r = requests.post(CRUVA_API, headers=headers, json=body, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(2 * attempt, 20))
                continue
            break
        if r.status_code != 200:
            print(f"❌ CRUVA API {r.status_code}: {r.text[:300]}")
            sys.exit(1)
        data = r.json().get("data") or {}
        res = data.get("results") or []
        for v in res:
            vid = str(v.get("video_id") or "").strip()
            if vid:
                out[vid] = v
        if not res or not data.get("has_more", len(res) == CRUVA_PAGE_SIZE):
            break
        page += 1
        time.sleep(0.15)
    return out


def analyzed(v: dict) -> bool:
    return bool(v.get("transcript") or v.get("on_screen_text") or v.get("content_overview"))


def _field(obj, camel: str):
    """apify-client 버전에 따라 dict 또는 모델 객체로 온다 → 둘 다 지원"""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(camel)
    snake = "".join("_" + c.lower() if c.isupper() else c for c in camel)
    return getattr(obj, snake, getattr(obj, camel, None))


def _plain(it):
    if isinstance(it, dict):
        return it
    for m in ("model_dump", "dict"):
        if hasattr(it, m):
            return getattr(it, m)(by_alias=True)
    return dict(it)


def apify_download(rows: list[dict], out_dir: str) -> tuple[dict[str, str], float]:
    """Apify 한 번 실행으로 여러 영상을 받는다 → ({video_id: mp4 경로}, 실행 비용 USD)"""
    from apify_client import ApifyClient
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        print("❌ APIFY_TOKEN 환경변수가 없음 (GitHub secret 등록 필요)")
        sys.exit(1)
    ac = ApifyClient(token)
    urls = [f"https://www.tiktok.com/@{r['handle']}/video/{r['video_id']}" for r in rows]
    run = ac.actor(APIFY_ACTOR).call(run_input={
        "postURLs": urls, "shouldDownloadVideos": True, "shouldDownloadCovers": False,
        "shouldDownloadSubtitles": False, "resultsPerPage": 1,
    })
    items = [_plain(it) for it in ac.dataset(_field(run, "defaultDatasetId")).list_items().items]
    cost = float(_field(ac.run(_field(run, "id")).get(), "usageTotalUsd") or 0)
    paths = {}
    for it in items:
        vid = str(it.get("id") or "")
        media = [u for u in (it.get("mediaUrls") or []) if u]
        if not vid or not media:
            continue
        path = os.path.join(out_dir, f"{vid}.mp4")
        r = requests.get(media[0], headers={"Authorization": f"Bearer {token}"}, timeout=120)
        if r.status_code == 200 and r.content:
            open(path, "wb").write(r.content)
            paths[vid] = path
    if items and not paths:
        notice(f"Apify 결과에 영상 파일이 없음. 항목 키: {sorted(items[0].keys())[:40]}")
    return paths, cost


def video_inputs(mp4: str, out_dir: str, whisper) -> tuple[list, float]:
    """mp4 → 컨택트시트 이미지 + 타임스탬프 대본 (extract.py 사용)"""
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "extract.py"), mp4, out_dir],
                       capture_output=True, text=True, check=True)
    vid, dur, _, sheet = r.stdout.strip().splitlines()[-1].split("\t")
    segs, info = whisper.transcribe(os.path.join(out_dir, f"{vid}.wav"), beam_size=1, vad_filter=True)
    transcript = "\n".join(f"{x.start:5.1f}-{x.end:5.1f}  {x.text.strip()}" for x in segs) or "(음성 없음)"
    img = base64.standard_b64encode(open(sheet, "rb").read()).decode()
    dur_s = float(dur.rstrip("s"))
    return [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}},
        {"type": "text", "text": f"영상 길이: {dur_s:.1f}초\n\n대본 (언어 감지: {info.language}):\n{transcript}"},
    ], dur_s


def grade(client, system: str, row: dict, inputs: list) -> Grade | None:
    head = f"video_id: {row['video_id']}\n크리에이터: @{row['handle']}\n제품: {row['products']}"
    content = [{"type": "text", "text": head}, *inputs,
               {"type": "text", "text": "기준서에 따라 평가하라. evidence·feedback은 한국어로 쓴다."}]
    resp = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": content}],
        output_format=Grade,
    )
    USAGE["in"] += resp.usage.input_tokens + (resp.usage.cache_creation_input_tokens or 0)
    USAGE["cache"] += resp.usage.cache_read_input_tokens or 0
    USAGE["out"] += resp.usage.output_tokens
    if resp.stop_reason != "end_turn" or resp.parsed_output is None:
        print(f"  평가 실패 {row['video_id']}: stop_reason={resp.stop_reason}")
        return None
    return resp.parsed_output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--date", default="")
    ap.add_argument("--source", choices=["auto", "cruva", "video"], default="auto")
    a = ap.parse_args()

    cruva_key = os.environ.get("CRUVA_API_KEY", "").strip()
    if not cruva_key:
        print("❌ CRUVA_API_KEY 환경변수가 없음 (GitHub secret 등록 필요)")
        sys.exit(1)

    ws = open_sheet(a.sheet_id)
    values = ws.get_all_values()
    header = values[0]
    # 평가 열이 없으면 기존 헤더 오른쪽에 추가 (기존 열은 건드리지 않음)
    if GRADE_HEADERS[0] not in header:
        ws.update(range_name=f"{col_letter(len(header) + 1)}1", values=[GRADE_HEADERS])
        header = header + GRADE_HEADERS
    g0 = header.index(GRADE_HEADERS[0])

    todo = []
    for i, r in enumerate(values[1:], start=2):
        r = r + [""] * (len(header) - len(r))
        vid = r[0].strip().lstrip("'")
        if not vid or r[g0].strip() or (a.date and not r[1].startswith(a.date)):
            continue
        todo.append({"row": i, "video_id": vid, "handle": r[2].strip().lstrip("@"),
                     "date": r[1][:10], "products": r[11]})
    if a.limit:
        todo = todo[:a.limit]
    notice(f"평가 대상 {len(todo)}건")
    if not todo:
        return

    # CRUVA 포스팅일 기준이 시트(LA)와 하루 어긋날 수 있어 앞뒤로 하루씩 넓혀 조회
    dates = sorted(t["date"] for t in todo)
    d_from = (datetime.strptime(dates[0], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    d_to = (datetime.strptime(dates[-1], "%Y-%m-%d") + timedelta(days=2)).strftime("%Y-%m-%d")
    cruva = cruva_videos(cruva_key, d_from, d_to)
    print(f"  CRUVA {d_from} ~ {d_to}(미포함): {len(cruva)}건")

    client = anthropic.Anthropic()
    skill = open(SKILL_PATH, encoding="utf-8").read()
    systems = {"cruva": skill + MODE_NOTE, "video": skill}

    # 영상별 평가 경로 결정
    for row in todo:
        v = cruva.get(row["video_id"])
        if a.source == "video" or (a.source == "auto" and not (v and analyzed(v))):
            row["via"] = "video"
        elif v is None:
            row["via"] = "na"
        else:
            row["via"] = "cruva" if analyzed(v) else "wait"

    stats = {"GOOD": 0, "OK": 0, "BAD": 0, "N/A": 0, "분석대기": 0, "실패": 0}
    tmp = tempfile.mkdtemp()
    mp4s, whisper = {}, None
    video_rows = [r for r in todo if r["via"] == "video"]
    if video_rows:
        mp4s, cost = apify_download(video_rows, tmp)
        notice(f"Apify: {len(video_rows)}건 요청 → {len(mp4s)}건 받음, 비용 ${cost:.4f} (1건당 ${cost / max(len(video_rows), 1):.4f})")
        from faster_whisper import WhisperModel
        whisper = WhisperModel("small", device="cpu", compute_type="int8")

    for n, row in enumerate(todo, 1):
        if row["via"] == "na":
            result = ["N/A", "", "", "", "", "", "", "", "CRUVA에 영상 없음(삭제·비공개 등)", ""]
            stats["N/A"] += 1
        elif row["via"] == "wait":
            stats["분석대기"] += 1  # CRUVA 분석 없음 → 비워 둠
            continue
        elif row["via"] == "video" and row["video_id"] not in mp4s:
            result = ["N/A", "", "", "", "", "", "", "", "영상 다운로드 불가(삭제·비공개 등)", ""]
            stats["N/A"] += 1
        else:
            if row["via"] == "video":
                inputs, _ = video_inputs(mp4s[row["video_id"]], os.path.join(tmp, row["video_id"]), whisper)
            else:
                data = {k: val for k, val in cruva[row["video_id"]].items() if k not in DROP_FIELDS}
                inputs = [{"type": "text", "text": "CRUVA 분석 데이터:\n" + json.dumps(data, ensure_ascii=False, indent=1)}]
            g = grade(client, systems[row["via"]], row, inputs)
            if g is None:
                stats["실패"] += 1
                continue
            result = [g.grade, g.gate or "", g.hook, g.proof_on_skin, g.explanation, g.authenticity,
                      g.production, ", ".join(g.flags), f"[{'영상' if row['via'] == 'video' else 'CRUVA'}] {g.evidence}", g.feedback]
            stats[g.grade] += 1
        result.append(datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"))
        rng = f"{col_letter(g0 + 1)}{row['row']}:{col_letter(g0 + len(GRADE_HEADERS))}{row['row']}"
        ws.update(range_name=rng, values=[result])
        print(f"  [{n}/{len(todo)}] {row['video_id']} → {result[0]}")
        if a.limit and a.limit <= 20:  # 시범 실행은 결과를 요약에도 남김
            notice(f"@{row['handle']} {row['video_id']} [{row['via']}] → {result[0]} {result[1]} | 훅 {result[2]}·피부 {result[3]}·설명 {result[4]}·진정성 {result[5]}·제작 {result[6]} | {result[7]} | {result[9][:150]}")

    notice("결과 " + " / ".join(f"{k} {v}" for k, v in stats.items()))
    # claude-opus-5-5: 입력 $4 / 캐시 읽기 $0.2 / 출력 $20 (per 1M tokens)
    usd = USAGE["in"] * 4e-6 + USAGE["cache"] * 0.2e-6 + USAGE["out"] * 20e-6
    notice(f"Claude 사용량: 입력 {USAGE['in']:,} / 캐시 {USAGE['cache']:,} / 출력 {USAGE['out']:,} 토큰 ≈ ${usd:.3f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        notice(f"오류: {type(e).__name__}: {str(e)[:300]} ({os.path.basename(tb.filename)}:{tb.lineno})")
        raise

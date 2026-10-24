"""
시트(첫 탭)의 영상들을 SKILL.md 기준으로 GOOD/OK/BAD 평가해서 오른쪽 열에 기록
사용: python video_grading/grade_sheet.py --sheet-id <ID> [--limit N] [--date YYYY-MM-DD] [--download-only]
- A열 Video ID, C열 크리에이터 핸들로 틱톡 링크를 만들어 yt-dlp로 받는다
- 등급 열이 비어 있는 행만 평가 (이미 평가한 행은 건너뜀 → 재실행 안전)
- --download-only: 다운로드·프레임·대본까지만 확인하고 API 호출/시트 쓰기는 하지 않음
"""
import argparse
import base64
import os
import subprocess
import sys
import tempfile
from typing import List, Literal, Optional

import gspread
from google.oauth2.service_account import Credentials
from pydantic import BaseModel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILL_PATH = os.path.join(ROOT, ".claude", "skills", "video-grading", "SKILL.md")
SERVICE_ACCOUNT_FILE = os.path.join(ROOT, "service_account.json")
MODEL = "claude-opus-5-5"

GRADE_HEADERS = ["등급", "자동BAD", "훅", "피부증명", "설명", "진정성", "제작품질", "플래그", "근거", "피드백", "평가일시"]

YN = Literal["YES", "NO"]


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
    # Actions 로그는 이 환경에서 못 읽으므로 요약(annotation)으로도 남긴다
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


def download(video_id: str, handle: str, out_dir: str) -> str | None:
    url = f"https://www.tiktok.com/@{handle}/video/{video_id}"
    path = os.path.join(out_dir, f"{video_id}.mp4")
    r = subprocess.run(["yt-dlp", "-q", "--no-warnings", "-f", "mp4/best", "-o", path, url],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0 or not os.path.exists(path):
        print(f"  다운로드 실패 {video_id}: {r.stderr.strip()[-300:]}")
        return None
    return path


def extract(mp4: str, out_dir: str) -> tuple[str, str, float]:
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "extract.py"), mp4, out_dir],
                       capture_output=True, text=True, check=True)
    vid, dur, _, sheet = r.stdout.strip().splitlines()[-1].split("\t")
    return sheet, os.path.join(out_dir, f"{vid}.wav"), float(dur.rstrip("s"))


def transcribe(model, wav: str) -> tuple[str, str]:
    segs, info = model.transcribe(wav, beam_size=1, vad_filter=True)
    lines = [f"{s.start:5.1f}-{s.end:5.1f}  {s.text.strip()}" for s in segs]
    return info.language, "\n".join(lines) or "(음성 없음)"


def grade(client, system: str, row: dict, sheet_jpg: str, lang: str, transcript: str, dur: float) -> Grade | None:
    with open(sheet_jpg, "rb") as f:
        img = base64.standard_b64encode(f.read()).decode()
    text = (
        f"video_id: {row['video_id']}\n크리에이터: @{row['handle']}\n영상 길이: {dur:.1f}초\n"
        f"캡션: {row['title']}\n제품: {row['products']}\n\n"
        f"대본 (언어 감지: {lang}):\n{transcript}\n\n"
        "위 컨택트시트(타임스탬프 표기)와 대본으로 기준서에 따라 평가하라. "
        "evidence·feedback은 한국어로, evidence에는 타임스탬프를 붙여라."
    )
    resp = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}},
            {"type": "text", "text": text},
        ]}],
        output_format=Grade,
    )
    if resp.stop_reason != "end_turn" or resp.parsed_output is None:
        print(f"  평가 실패 {row['video_id']}: stop_reason={resp.stop_reason}")
        return None
    return resp.parsed_output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--date", default="")
    ap.add_argument("--download-only", action="store_true")
    a = ap.parse_args()

    ws = open_sheet(a.sheet_id)
    values = ws.get_all_values()
    header = values[0]
    # 평가 열이 없으면 기존 헤더 오른쪽에 추가 (기존 열은 건드리지 않음)
    if GRADE_HEADERS[0] not in header:
        start = len(header) + 1
        ws.update(range_name=f"{col_letter(start)}1", values=[GRADE_HEADERS])
        header = header + GRADE_HEADERS
    g0 = header.index(GRADE_HEADERS[0])

    todo = []
    for i, r in enumerate(values[1:], start=2):
        r = r + [""] * (len(header) - len(r))
        vid = r[0].strip().lstrip("'")
        if not vid or r[g0].strip() or (a.date and not r[1].startswith(a.date)):
            continue
        todo.append({"row": i, "video_id": vid, "handle": r[2].strip().lstrip("@"),
                     "title": r[3], "products": r[11]})
    if a.limit:
        todo = todo[:a.limit]
    notice(f"평가 대상 {len(todo)}건")

    from faster_whisper import WhisperModel
    whisper = WhisperModel("small", device="cpu", compute_type="int8")
    client, system = None, None
    if not a.download_only:
        import anthropic
        client = anthropic.Anthropic()
        system = open(SKILL_PATH, encoding="utf-8").read()

    from datetime import datetime, timedelta, timezone
    stats = {"GOOD": 0, "OK": 0, "BAD": 0, "N/A": 0, "실패": 0}
    for n, row in enumerate(todo, 1):
        with tempfile.TemporaryDirectory() as tmp:
            mp4 = download(row["video_id"], row["handle"], tmp)
            if not mp4:
                if a.download_only:
                    notice(f"{row['video_id']}: 다운로드 실패")
                    continue
                result = ["N/A", "", "", "", "", "", "", "", "영상 다운로드 불가(삭제·비공개 등)", "", ""]
                stats["N/A"] += 1
            else:
                sheet_jpg, wav, dur = extract(mp4, tmp)
                lang, transcript = transcribe(whisper, wav)
                if a.download_only:
                    notice(f"{row['video_id']}: {dur:.0f}초, 언어 {lang}, 대본 {len(transcript.splitlines())}줄")
                    continue
                g = grade(client, system, row, sheet_jpg, lang, transcript, dur)
                if g is None:
                    stats["실패"] += 1
                    continue
                result = [g.grade, g.gate or "", g.hook, g.proof_on_skin, g.explanation, g.authenticity,
                          g.production, ", ".join(g.flags), g.evidence, g.feedback]
                stats[g.grade] += 1
        if a.download_only:
            continue
        result = result[:10] + [datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")]
        rng = f"{col_letter(g0 + 1)}{row['row']}:{col_letter(g0 + len(GRADE_HEADERS))}{row['row']}"
        ws.update(range_name=rng, values=[result])
        print(f"  [{n}/{len(todo)}] {row['video_id']} → {result[0]}")

    if not a.download_only:
        notice("결과 " + " / ".join(f"{k} {v}" for k, v in stats.items()))


if __name__ == "__main__":
    main()

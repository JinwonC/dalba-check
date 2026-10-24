"""폴더 안 모든 .wav → faster-whisper(small, 언어 자동감지)로 구간별 대본 출력 + transcripts.json 저장.
사용: python -I video_grading/transcribe.py <frames_dir>
"""
import glob, json, os, sys
from faster_whisper import WhisperModel
d = sys.argv[1]
m = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for wav in sorted(glob.glob(os.path.join(d, "*.wav"))):
    vid = os.path.basename(wav)[:-4]
    segs, info = m.transcribe(wav, beam_size=1, vad_filter=True)
    segs = [(round(s.start, 1), round(s.end, 1), s.text.strip()) for s in segs]
    out[vid] = {"lang": info.language, "prob": round(info.language_probability, 2), "segments": segs}
    print(f"\n=== {vid} [{info.language} {info.language_probability:.2f}] ===")
    for a, b, t in segs:
        print(f"  {a:5.1f}-{b:5.1f}  {t}")
json.dump(out, open(os.path.join(d, "transcripts.json"), "w"), ensure_ascii=False, indent=1)

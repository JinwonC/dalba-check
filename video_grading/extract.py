"""영상 1개 → (1) 프레임 컨택트시트 이미지 (2) 16kHz 음성 wav
- 훅 판단용으로 0~3초는 촘촘하게(0, .5, 1, 1.5, 2, 3초), 이후는 균등 간격 10장
- 각 썸네일에 타임스탬프를 찍어서 한 장의 컨택트시트로 합침
사용: python -I video_grading/extract.py <video.mp4> <out_dir>
"""
import os
import re
import subprocess
import sys

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

FF = imageio_ffmpeg.get_ffmpeg_exe()


def duration(path):
    err = subprocess.run([FF, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    vid = os.path.splitext(os.path.basename(src))[0]
    dur = duration(src)
    hook = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0]
    rest_n = 10
    rest = [3.0 + (dur - 3.5) * (i + 1) / (rest_n + 1) for i in range(rest_n)] if dur > 5 else []
    times = [t for t in hook if t < dur - 0.1] + rest

    thumbs = []
    for i, t in enumerate(times):
        fp = os.path.join(out, f"{vid}_{i:02d}.jpg")
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", src,
                        "-frames:v", "1", "-vf", "scale=360:-2", fp], check=True)
        thumbs.append((t, fp))

    # 컨택트시트 (4열)
    w, h = Image.open(thumbs[0][1]).size
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), "black")
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    for i, (t, fp) in enumerate(thumbs):
        im = Image.open(fp)
        x, y = (i % cols) * w, (i // cols) * h
        sheet.paste(im, (x, y))
        d = ImageDraw.Draw(sheet)
        d.rectangle([x, y, x + 92, y + 34], fill="black")
        d.text((x + 6, y + 3), f"{t:4.1f}s", fill="yellow", font=font)
    sheet_path = os.path.join(out, f"{vid}_sheet.jpg")
    sheet.save(sheet_path, quality=82)

    wav = os.path.join(out, f"{vid}.wav")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
    print(f"{vid}\t{dur:.1f}s\t{len(thumbs)} frames\t{sheet_path}")


if __name__ == "__main__":
    main()

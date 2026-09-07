"""pickdi video list D열/products 진단 — PID 1732397321053967068 확인."""
import gspread
from google.oauth2.service_account import Credentials

SA = "service_account.json"
SID = "1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g"
TAB = "pickdi video list"
HROW = 2
PID = "1732397321053967068"


def col_letter(i):
    n, s = i + 1, ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def main():
    creds = Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    ws = gspread.authorize(creds).open_by_key(SID).worksheet(TAB)
    vals = ws.get_all_values()
    header = vals[HROW - 1] if len(vals) >= HROW else []
    data = vals[HROW:]

    print("=== 헤더(2행) 컬럼 ===", flush=True)
    for i, h in enumerate(header):
        print(f"  {col_letter(i)} : {h!r}", flush=True)

    def idx(name):
        return header.index(name) if name in header else -1
    i_prod = idx("products")
    i_id = idx("id")
    i_post = header.index("video_post_time") if "video_post_time" in header else -1
    print(f"\nD열(index3) = {header[3] if len(header) > 3 else '?'!r}", flush=True)
    print(f"products 컬럼 = {col_letter(i_prod) if i_prod>=0 else '없음'} (index {i_prod})", flush=True)

    if i_prod < 0:
        print("\n⚠️ 'products' 컬럼이 헤더에 없음 → 삭제됐거나 이름이 바뀜. 그래서 PID가 안 보이는 것.", flush=True)
        return

    tot = 0
    with_pid = 0
    empty_prod = 0
    samples_pid = []
    recent = []
    for r in data:
        if i_id < 0 or i_id >= len(r):
            continue
        vid = str(r[i_id]).strip().lstrip("'")
        if not vid:
            continue
        tot += 1
        prod = str(r[i_prod]) if i_prod < len(r) else ""
        if not prod.strip():
            empty_prod += 1
        if PID in prod:
            with_pid += 1
            if len(samples_pid) < 5:
                post = r[i_post] if 0 <= i_post < len(r) else ""
                samples_pid.append((vid, post, prod[:60]))
        if i_post >= 0 and i_post < len(r):
            recent.append((str(r[i_post])[:19], vid, prod[:50]))

    print(f"\n총 데이터행: {tot}", flush=True)
    print(f"products에 PID({PID}) 포함: {with_pid}행", flush=True)
    print(f"products가 빈 행: {empty_prod}행 ({empty_prod*100//max(tot,1)}%)", flush=True)

    print("\n=== PID 포함 샘플 5행 (id / 발행 / products) ===", flush=True)
    for vid, post, prod in samples_pid:
        print(f"  {vid} | {post} | {prod}", flush=True)

    recent.sort(reverse=True)
    print("\n=== 최근 발행 10행 (발행일 / id / products) — 최근 영상 products 채워지나 확인 ===", flush=True)
    for post, vid, prod in recent[:10]:
        print(f"  {post} | {vid} | products={prod!r}", flush=True)


if __name__ == "__main__":
    main()

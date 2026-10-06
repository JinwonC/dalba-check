"""적재한 모든 탭의 실제 상태 검증: 행수 / 날짜 범위 / 중복."""
from collections import Counter

import gspread
from google.oauth2.service_account import Credentials

TARGETS = [
    # (스프레드시트ID, 탭명, 날짜열 헤더 후보, 키열 헤더 후보)
    ("1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g", "영상성과_신API테스트", "video_post_time", "id"),
    ("1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g", "전체 영상성과데이터", "포스팅일(LA)", "Video ID"),
    ("15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o", "라이브성과", "시작일시(LA)", "id"),
    ("15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o", "(중요, 자동) SKU Order", "날짜", None),
    ("1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA", "광고성과", "날짜", None),
    ("1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA", "광고소재성과", "날짜", None),
    ("1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA", "스파크애즈", "날짜", None),
    ("1fVWfictZo6BiKyWO-eFfSo3fAVscOQMPVg1gqa5oMWI", "Get Order Detail", "주문일시(LA)", "주문ID"),
    ("1fVWfictZo6BiKyWO-eFfSo3fAVscOQMPVg1gqa5oMWI", "Get Transactions by Order", "주문일시(LA)", None),
    ("1fVWfictZo6BiKyWO-eFfSo3fAVscOQMPVg1gqa5oMWI", "Get Price Detail", "주문일시(LA)", None),
]


def main():
    creds = Credentials.from_service_account_file(
        "service_account.json",
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"])
    gc = gspread.authorize(creds)
    cache = {}
    for sid, tab, date_h, key_h in TARGETS:
        try:
            if sid not in cache:
                cache[sid] = gc.open_by_key(sid)
            ss = cache[sid]
            sheet = ss.worksheet(tab)
            vals = sheet.get_all_values()
        except Exception as e:
            print(f"\n■ {tab}\n   ❌ 읽기 실패: {str(e)[:100]}")
            continue
        if not vals:
            print(f"\n■ {tab}\n   (빈 탭)")
            continue
        header, rows = vals[0], vals[1:]
        rows = [r for r in rows if any(str(c).strip() for c in r)]
        print(f"\n■ {tab}  ({ss.title})")
        print(f"   행수: {len(rows):,}  열수: {len(header)}")

        if date_h and date_h in header:
            i = header.index(date_h)
            ds = sorted({str(r[i])[:10] for r in rows if len(r) > i and str(r[i]).strip()})
            if ds:
                print(f"   날짜({date_h}): {ds[0]} ~ {ds[-1]}  (고유 {len(ds)}일)")
        elif date_h:
            print(f"   ⚠️ 날짜열 '{date_h}' 없음 — 헤더: {header[:6]}")

        if key_h and key_h in header:
            i = header.index(key_h)
            ks = [str(r[i]).strip().lstrip("'") for r in rows if len(r) > i and str(r[i]).strip()]
            dup = len(ks) - len(set(ks))
            flag = "✅" if dup == 0 else f"⚠️ 중복 {dup:,}"
            print(f"   키({key_h}): {len(ks):,}개 / 고유 {len(set(ks)):,}개  {flag}")


if __name__ == "__main__":
    main()

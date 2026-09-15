import gspread, re
from google.oauth2.service_account import Credentials
SA="service_account.json"
SID="15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o"
creds=Credentials.from_service_account_file(SA,scopes=["https://www.googleapis.com/auth/spreadsheets"])
gc=gspread.authorize(creds)
ss=gc.open_by_key(SID)
for TAB in ["(중요,수동) 주문별 AF 매출 RAW","(중요,수동) 제품별 유입매출 RAW (520업데이트)","(수동) 브랜드 라이브 RAW"]:
    try:
        w=ss.worksheet(TAB)
    except Exception as e:
        print(f"[{TAB}] 없음 {e}"); continue
    v=w.get_values("A1:BZ3")  # header + 2 sample rows
    print(f"\n==== [{TAB}] ====",flush=True)
    if not v: print("  비어있음"); continue
    hdr=v[0]
    print(f"  열 수: {len(hdr)}",flush=True)
    for i,h in enumerate(hdr):
        samp = v[1][i] if len(v)>1 and i<len(v[1]) else ""
        # 시각/날짜/매출 관련만 강조
        mark = ""
        if re.search(r'시각|시간|일시|date|time|주문|created|gmv|매출|금액|amount', str(h), re.I): mark=" <<<"
        print(f"    [{i}] {str(h)[:34]!r}  ex={str(samp)[:26]!r}{mark}",flush=True)

import gspread
from google.oauth2.service_account import Credentials
SA="service_account.json"
SHEETS={
 "US매출(15dP91)":"15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o",
 "FINANCE(1fVWfi)":"1fVWfictZo6BiKyWO-eFfSo3fAVscOQMPVg1gqa5oMWI",
 "영상(1_qkd6)":"1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g",
 "광고(1AhVPP)":"1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA",
}
creds=Credentials.from_service_account_file(SA,scopes=["https://www.googleapis.com/auth/spreadsheets"])
gc=gspread.authorize(creds)
import re
for label,sid in SHEETS.items():
    try:
        ss=gc.open_by_key(sid)
    except Exception as e:
        print(f"[{label}] 열기 실패 {e}"); continue
    hits=[w for w in ss.worksheets() if re.search(r'hour|시간|per.?hour', w.title, re.I)]
    print(f"[{label}] 시간대별 후보 탭: {[w.title for w in hits] or '없음'}",flush=True)
    for w in hits:
        v=w.get_all_values()
        print(f"   === '{w.title}' {len(v)}행 ===",flush=True)
        if v:
            print("   헤더:",v[0],flush=True)
            ds=[r[0] for r in v[1:] if r and r[0]]
            if ds: print(f"   날짜범위: {min(ds)} ~ {max(ds)}",flush=True)
            for r in v[1:4]: print("   ",r,flush=True)
            for r in v[-3:]: print("   ...",r,flush=True)

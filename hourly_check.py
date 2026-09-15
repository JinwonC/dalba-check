import gspread
from google.oauth2.service_account import Credentials
SA="service_account.json"
SID="15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o"
creds=Credentials.from_service_account_file(SA,scopes=["https://www.googleapis.com/auth/spreadsheets"])
ss=gspread.authorize(creds).open_by_key(SID)
print("=== US매출 시트 탭 목록 ===",flush=True)
for w in ss.worksheets():
    print(f"  - {w.title}  ({w.row_count}x{w.col_count})",flush=True)
for name in ["Get Shop Performance Per Hour","시간대별","Shop Performance Per Hour"]:
    try:
        w=ss.worksheet(name)
    except Exception:
        continue
    v=w.get_all_values()
    print(f"\n=== '{name}' 탭: {len(v)}행 ===",flush=True)
    if v:
        print("헤더:",v[0],flush=True)
        # 날짜 범위
        dates=[r[0] for r in v[1:] if r and r[0]]
        if dates:
            print(f"날짜 범위: {min(dates)} ~ {max(dates)} (고유 {len(set(dates))}일)",flush=True)
        print("샘플 앞 5행:",flush=True)
        for r in v[1:6]: print("  ",r,flush=True)
        print("샘플 뒤 5행:",flush=True)
        for r in v[-5:]: print("  ",r,flush=True)

import re
from collections import Counter
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials
SA="service_account.json"
US="15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o"
FIN="1fVWfictZo6BiKyWO-eFfSo3fAVscOQMPVg1gqa5oMWI"
creds=Credentials.from_service_account_file(SA,scopes=["https://www.googleapis.com/auth/spreadsheets"])
gc=gspread.authorize(creds)

# --- 주문별 AF RAW: Order ID + Time Created ---
ov=gc.open_by_key(US).worksheet("(중요,수동) 주문별 AF 매출 RAW").get_all_values()
oh=ov[0]
print("주문별RAW 앞 16열:", [f"{i}:{h}" for i,h in enumerate(oh[:16])])
def find(hs,*c):
    for x in c:
        for i,h in enumerate(hs):
            if x.lower()==str(h).strip().lower(): return i
    for x in c:
        for i,h in enumerate(hs):
            if x.lower() in str(h).strip().lower(): return i
    return -1
i_oid=find(oh,"Order ID","주문 ID","주문번호","Order id","order")
i_tc=find(oh,"Time Created","Created Time")
print(f"주문별RAW: order_id col={i_oid}({oh[i_oid] if i_oid>=0 else '?'}), time col={i_tc}({oh[i_tc] if i_tc>=0 else '?'})")
def p_dmy(s):
    m=re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?",str(s))
    if not m: return None
    d,mo,y,h,mi,_=m.groups(); 
    try:return datetime(int(y),int(mo),int(d),int(h),int(mi))
    except: return None
tc={}
for r in ov[1:]:
    if i_oid>=len(r) or i_tc>=len(r): continue
    oid=str(r[i_oid]).strip().lstrip("'")
    dt=p_dmy(r[i_tc])
    if oid and dt: tc[oid]=dt

# --- Get Order Detail: 주문ID + 주문일시(LA) ---
fv=gc.open_by_key(FIN).worksheet("Get Order Detail").get_all_values()
fh=fv[0]
j_oid=find(fh,"주문ID","주문 ID","Order ID")
j_la=find(fh,"주문일시(LA)","주문일시")
print(f"OrderDetail: order_id col={j_oid}({fh[j_oid] if j_oid>=0 else '?'}), la col={j_la}({fh[j_la] if j_la>=0 else '?'})")
def p_ymd(s):
    m=re.match(r"\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})",str(s))
    if not m: return None
    y,mo,d,h,mi=map(int,m.groups())
    try:return datetime(y,mo,d,h,mi)
    except: return None

offs=[]; samples=[]
for r in fv[1:]:
    if j_oid>=len(r) or j_la>=len(r): continue
    oid=str(r[j_oid]).strip().lstrip("'")
    la=p_ymd(r[j_la])
    if not oid or not la or oid not in tc: continue
    diff=(tc[oid]-la).total_seconds()/3600.0
    offs.append(round(diff))
    if len(samples)<6: samples.append((oid, tc[oid].strftime("%Y-%m-%d %H:%M"), la.strftime("%Y-%m-%d %H:%M"), round(diff,2)))

print(f"\n매칭된 주문: {len(offs)}건")
if offs:
    c=Counter(offs)
    print("시차(Time Created − LA, 시간) 분포 TOP:", c.most_common(6))
    print("\n샘플 (주문ID / TimeCreated / 주문일시(LA) / 시차h):")
    for s in samples: print("  ",s)
    off=c.most_common(1)[0][0]
    tzmap={0:"LA (America/Los_Angeles)",3:"US 동부 EDT",7:"UTC",16:"KST(한국)",15:"KST(겨울근사)",17:"KST(LA가 PST일때)",9:"UTC+2?",8:"UTC+1?"}
    print(f"\n==> 최빈 시차 {off}h → 'Time Created'의 타임존 = {tzmap.get(off, f'UTC{(off-7):+d} 근처(불명)')}")

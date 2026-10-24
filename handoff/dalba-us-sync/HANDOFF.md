# d'Alba US 데이터 적재 — 인수인계 (영상 / SKU / 광고)

TikTok Shop US 스토어 데이터를 매일 Google Sheets에 적재하는 스크립트 3개와 실행 환경.
GitHub Actions에서 매일 한 번 돈다 (`.github/workflows/daily_sync.yml`).

## 구성
| 파일 | 역할 |
|---|---|
| `video_perf_upsert.py` | 영상별 성과 → **pickdi video list** 탭 |
| `sku_perf.py` | SKU별 일일 성과 → **(중요, 자동) SKU Order** 탭 |
| `tiktok_ads.py` | GMV MAX 광고 → **캠페인 광고성과**, **소재별 광고성과** 탭 |
| `token_manager.py` | TikTok Shop Partner API 토큰 (tokens.json, 만료 시 자동 갱신) |
| `tiktok_common.py` | Partner API 서명 + 호출 (sku_perf.py가 사용) |
| `.github/workflows/daily_sync.yml` | 매일 08:10 UTC 실행 (한국 17:10) |

## 적재 대상
| 스크립트 | 스프레드시트 ID | 탭 | 레이아웃 |
|---|---|---|---|
| video_perf_upsert.py | `1_qkd6LZ1wFoihhJSuYdabQ4iRbx-jsFYVxeGIoEb-_g` (US 제품별 콘텐츠 트래킹) | `pickdi video list` | 1행 배너 / **2행 헤더** / 3행부터 데이터 |
| sku_perf.py | `15dP91bH_skc7ZzcJ3ehH9H4IKCzSxcfuOcREr3OaL0o` (US 매출/지표) | `(중요, 자동) SKU Order` | 1행 헤더: 날짜, 상품ID, SKU ID, SKU주문수, 판매수량, GMV, 통화 |
| tiktok_ads.py | `1AhVPPUq6Npri72uhtFcOUVMBl1jA7nf2P0qDCDRRKfA` (틱톡샵 광고 대시보드 RAW) | `캠페인 광고성과`, `소재별 광고성과` | 1행 헤더, A열 날짜 |

서비스 계정이 세 시트 모두에 **편집자**로 공유돼 있어야 한다.

## 필요한 GitHub Secrets
| 이름 | 내용 |
|---|---|
| `TIKTOK_APP_KEY` | TikTok Shop Partner 앱 키 |
| `TIKTOK_APP_SECRET` | TikTok Shop Partner 앱 시크릿 |
| `TIKTOK_SHOP_CIPHER` | US 스토어 shop_cipher |
| `TOKENS_JSON` | `{"access_token": "...", "refresh_token": "..."}` (Partner API) |
| `ADS_TOKENS_JSON` | `{"access_token": "..."}` (TikTok Business API, 광고 advertiser `7573855166672355345`) |
| `SERVICE_ACCOUNT_JSON` | Google 서비스 계정 JSON 전체 |

비밀값은 코드에 절대 넣지 않는다. 원래 저장소는 공개 저장소에 앱 시크릿과 토큰이 평문으로 있었다 (아래 "보안" 참고).

## 동작 규칙 (바꾸지 말 것 — 모두 실제 사고에서 나온 규칙)
1. **pickdi video list는 행 위치를 절대 바꾸지 않는다.** 기존 영상(Video ID 기준)은 제자리에서 값만 갱신하고, 새 영상은 **맨 아래에만** 추가한다. 전체 재정렬 금지.
   - 스크립트는 **API가 주는 열(헤더 이름이 API 필드명과 같은 열)만** 쓴다. 그 오른쪽의 수동 열(Video Link, Evaluation, 담당자 등)은 기존 값을 보존한다.
   - 평일 최근 90일, 토요일 전체(2026-01-01~) 재조회.
2. **SKU는 최근 4일을 다시 조회해 날짜 단위로 교체**한다. TikTok SKU 분석은 확정이 약 1일 늦어서 새벽엔 어제가 비어 있는 경우가 많다.
   - **데이터가 들어온 날짜만** 교체하고, 빈 응답인 날은 기존 데이터를 지우지 않는다.
3. **광고는 최근 4일을 조회하되, 시트에 아직 없는 날짜만 추가**한다 (이미 있는 날짜는 건너뜀 → 중복 없음). 새벽 조회 때 0행이던 날이 다음 날 자동으로 메워진다. 25만 행 이상이라 전체 재작성은 하지 않는다.
4. **날짜 비교는 정규화해서 한다.** 시트 서식에 따라 `2026-10-14`가 `2026. 10. 14`로 보이기도 해서, 그대로 비교하면 중복 적재된다 (`_norm_date`).
5. **탭이 없으면 새로 만들지 않고 에러로 멈춘다.** 시트에서 탭 이름을 바꾸면 예전엔 빈 탭이 자동 생성돼 데이터가 조용히 갈라졌다. 이름을 바꾸면 스크립트의 탭 이름도 같이 바꾼다.
6. **19자리 ID(Video ID, 상품ID, SKU ID)는 `'` 접두로 텍스트로 쓴다.** 숫자로 들어가면 뒷자리가 손실된다.
7. 날짜 기준은 **LA 시간**이다 (TikTok US 스토어 기준).

## 실행
```bash
pip install -r requirements.txt
# 필요한 파일: service_account.json, tokens.json, ads_tokens.json  + 환경변수 3개
python sku_perf.py "2026-10-20 ~ 2026-10-23"   # 인자 없으면 LA 기준 최근 4일
python tiktok_ads.py "2026-10-20 ~ 2026-10-23"
python video_perf_upsert.py 90                  # 또는 full
```

## 이관 체크리스트
1. 새 저장소는 **비공개(private)** 로 만든다.
2. 위 Secrets 6개 등록, 서비스 계정을 세 시트에 편집자로 공유.
3. `workflow_dispatch`로 한 번 수동 실행하고, 각 스텝 로그에서 확인:
   - SKU: `업서트 완료 — 교체 날짜 [...]`
   - 광고: `이미 적재된 날짜 건너뜀` / `신규 날짜 [...] → N행 추가`
   - 영상: `갱신 N행 / 신규 M행 (맨 아래 추가, 재정렬 없음)`
4. **기존 저장소(JinwonC/dalba-check)의 같은 스텝을 반드시 끈다.** 두 곳이 동시에 돌면 광고 탭에 같은 날짜가 두 번 추가될 수 있다 (둘 다 "아직 없음"으로 보고 동시에 append). SKU·영상은 같은 결과를 두 번 쓸 뿐이지만 낭비다.
5. 기존 저장소는 데일리를 cron-job.org가 workflow_dispatch로 호출했다. 새 저장소는 GitHub `schedule`을 쓰므로 cron-job.org 설정은 필요 없다 (기존 설정은 끄거나 지운다).

## 알려진 사항
- **토큰**: Partner API access_token은 만료되면 실행 중에 refresh_token으로 갱신된다. Actions에서는 갱신된 파일이 저장되지 않아 매 실행마다 다시 갱신한다. refresh_token이 만료되면 재인증 후 `TOKENS_JSON`을 교체해야 한다.
- **API 조회 한도**: 영상 분석 API는 약 180일 이전 날짜 조회를 거부한다 (`28001022`). `full` 모드의 오래된 구간은 비어서 돌아올 수 있다.
- **TikTok 일시 오류**: `36009003 Internal error`가 가끔 나는데 재시도로 대부분 복구된다.
- **광고비 단위**: 광고 API 지출은 USD. (CRUVA의 광고비 수치는 단위가 맞지 않아 쓰지 않는다.)

## 보안 (조치 필요)
원래 저장소 `JinwonC/dalba-check`는 **공개 저장소**이고, `_공통.py`, `token_manager.py`, `video_perf_upsert.py` 등에 TikTok Shop 앱 시크릿, 액세스/리프레시 토큰, shop_cipher가 평문으로 들어 있었다. 커밋 기록에도 남아 있으므로:
1. TikTok Shop Partner Center에서 **앱 시크릿을 재발급(rotate)** 하고 스토어를 재인증해 새 토큰을 받는다.
2. 새 값은 새 저장소의 Secrets에만 넣는다.
3. 기존 저장소를 비공개로 바꾸거나, 이관 후 해당 파일들을 정리한다 (기록에 남은 값은 rotate로만 무효화된다).

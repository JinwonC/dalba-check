# d'Alba TikTok Shop 데이터 적재 — 작업 가이드

TikTok Shop(US/DE) 데이터를 GitHub Actions로 매일 Google Sheets에 적재하는 저장소다.
**작업 브랜치: `claude/bypass-sheets-timeout-8nw21`** (모든 파이썬 스크립트는 이 브랜치에 있다).

## 저장소 구조 (중요)
- **스크립트는 이 브랜치에**, **워크플로우(.github/workflows/*.yml)는 main에** 있어야 실행된다.
  워크플로우는 `actions/checkout`에서 `ref: claude/bypass-sheets-timeout-8nw21`로 이 브랜치의 스크립트를 가져온다.
  → 스크립트 수정: 이 브랜치에 커밋·푸시 / 워크플로우 수정: main에 반영.
- 데일리(`daily_sync.yml`)는 GitHub schedule이 아니라 **cron-job.org가 workflow_dispatch로 매일 08:10 UTC(한국 17:10)에 호출**한다.
- 로컬(클라우드 세션)에는 `service_account.json`, `tokens.json`, `ads_tokens.json`이 없다. 시트 쓰기 테스트는 **워크플로우를 수동 실행하고 로그로 확인**한다. 실행 시간대(08:10~09:10 UTC)에는 같은 시트에 동시에 쓰지 않게 피한다.

## 매일 돌아가는 US 적재 (`daily_sync.yml`, main)
| 순서 | 스크립트 (이 브랜치, 루트 기준) | 시트 > 탭 | 방식 |
|---|---|---|---|
| ① | `tiktok_to_sheets.py` | US 제품별 콘텐츠 트래킹 > 전체 영상성과데이터 | 최근 60일 포스팅 영상 갱신, 신규는 맨 아래 |
| ② | `TEST/SKU별_성과.py` (`TEST/_공통.py` 사용) | US 매출/지표 > (중요, 자동) SKU Order | 최근 4일 재조회, 날짜 단위 교체 |
| ③ | `tiktok_ads.py` | 틱톡샵 광고 대시보드(RAW) > 캠페인 광고성과, 소재별 광고성과 | 최근 4일 조회, 시트에 없는 날짜만 추가 |
| ④ | `tiktok_spark_ads.py` | 같은 시트 > 스파크애즈 | 최근 4일, 없는 날짜만 추가 |
| ⑤ | `video_perf_upsert.py` | US 제품별 콘텐츠 트래킹 > pickdi video list | 평일 90일 / 토요일 full, 행 위치 보존 |
| ⑥ | `paid_tracking.py` | PAID 성과 트래킹 (GMV) 탭 | ⚠️ 현재 매일 실패 (아래 "알려진 문제") |

기타 자동 실행: `video_refresh_weekly.yml`(토 13:00 UTC, 전체 영상성과데이터 165일 갱신), `listing_index.yml`(5분마다, 크리에이터 중복체크 인덱스), `de_cruva_sync.yml`(DE, CRUVA_API_KEY 시크릿 등록 대기).

## 반드시 지킬 규칙 (모두 실제 사고에서 나온 것)
1. **행 위치 보존**: 영상 탭(pickdi video list, 전체 영상성과데이터)은 재정렬하지 않는다. 기존 행은 제자리 갱신, 신규는 맨 아래에만 추가. API가 주지 않는 수동 열(평가, 메모 등)은 보존한다.
2. **최근 4일 재조회**: SKU·광고는 LA 새벽 기준 전날 데이터가 아직 비어 있을 수 있다. 빈 응답인 날은 기존 데이터를 지우지 않는다.
3. **빠진 날짜만 추가**: 광고 탭은 25만 행 이상이라 전체 재작성 금지. 이미 있는 날짜는 건너뛴다.
4. **날짜 정규화**: 시트 서식에 따라 `2026-10-14`가 `2026. 10. 14`로 보인다. 날짜 비교는 `_norm_date`로 정규화해서 한다.
5. **탭 자동 생성 금지**: 탭이 없으면 에러로 멈춘다. 사용자가 탭 이름을 바꾸면 스크립트의 탭 이름 상수도 바꾼다.
6. **19자리 ID는 텍스트로**: Video ID·상품ID·SKU ID는 `'` 접두로 써야 뒷자리가 안 깨진다.
7. **날짜 기준은 LA 시간**이다.

## 하지 말 것
- `handoff/dalba-us-sync/`는 **다른 저장소로 옮길 때 쓰는 패키지**다 (비밀값을 환경변수로 받게 바꾼 버전). 지금 돌고 있는 루트 스크립트를 이걸로 바꾸지 마라. 이 저장소에는 `TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_SHOP_CIPHER` 시크릿이 없어서 데일리가 멈춘다.
- **공개 저장소다.** Actions 로그도 공개되므로 비밀값·토큰을 로그에 출력하지 마라. 새 비밀값을 코드에 넣지 마라.
- 사용자에게 확인 없이 탭을 지우거나 데이터를 대량 삭제하지 마라 (지우기 전에 백업, 예: `data/backup/`).

## 알려진 문제
- **PAID 트래킹 실패**: `paid_tracking.py`가 `PAID 성과 트래킹 (GMV)` 탭을 못 찾는다 (사용자가 탭 이름을 바꾼 것으로 보임). 새 탭 이름을 사용자에게 받아 `DST_TAB`을 바꾸면 해결된다. 원본 탭은 이미 `소재별 광고성과`로 맞춰 뒀다. 그래서 데일리가 매일 failure로 끝나지만 다른 스텝은 정상이다.
- **SKU 스크립트(`TEST/SKU별_성과.py`)에는 아직 날짜 정규화·탭 자동생성 금지가 없다.** `handoff/dalba-us-sync/sku_perf.py`에 적용된 방식대로 옮기면 된다.
- **보안**: `TEST/_공통.py`, `token_manager.py`, `video_perf_upsert.py` 등에 TikTok Shop 앱 시크릿·토큰이 평문으로 있다 (공개 저장소). 사용자에게 앱 시크릿 재발급과 시크릿 분리를 권장해 둔 상태다.
- **재무 탭**(Order/Transaction/Price Detail)과 **라이브 성과**는 자동화돼 있지 않다 (수동 워크플로우만 있음).
- 영상 분석 API는 약 180일 이전 조회를 거부한다 (`28001022`). 그보다 오래된 영상은 갱신 불가.

## 참고 문서
- `handoff/dalba-us-sync/HANDOFF.md`: 영상·SKU·광고 적재의 상세 동작과 시트 ID
- `.claude/skills/video-grading/SKILL.md`: 크리에이터 영상 GOOD/OK/BAD 평가 기준

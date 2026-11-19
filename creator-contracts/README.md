# d'Alba Creator Contracts

크리에이터 계약서와 인보이스를 파일 대신 **링크 하나**로 주고받는 웹앱입니다.

## 흐름

1. 매니저가 딜 조건을 입력하고(필요하면 조항 수정) 링크를 만든다.
2. 크리에이터가 링크에서 계약서를 읽고, 은행 정보를 입력하고, 자동 생성된 인보이스를 확인한 뒤 이름을 타이핑해 서명한다. 문제가 있으면 "Request changes"로 수정 요청을 보낸다.
3. 매니저가 서명본 PDF를 내려받아 내부 시스템에 직인을 요청하고, 직인본을 다시 업로드한다.
4. 콘텐츠가 모두 게시되면 "Content complete"를 눌러 인보이스 발행일을 확정한다.
5. 지급 후 "Mark as paid".

대시보드는 서명 대기, 수정 요청, 직인, 콘텐츠 진행 중, 지급 대기로 나눠 보여준다.

## 구성

- Next.js (App Router) + Vercel Blob(비공개 스토어) + `@react-pdf/renderer`
- 매니저: 계정 로그인 없음. 팀 공용 접근 코드(`APP_KEY`)와 본인 이름을 브라우저당 한 번 입력
- 크리에이터: 추측 불가능한 토큰 링크 (`/c/<id>.<secret>`)
- 저장 구조: `deals/<id>.json`(딜 전체), `stamped/<id>.pdf`(직인본)
- 은행 정보는 AES-256-GCM으로 암호화해 저장
- 서명 시 시각, IP, 브라우저, 문서 SHA-256을 기록해 PDF 마지막 장에 넣음
- 계약서 기본 조항은 `src/lib/template.ts`의 `DEFAULT_CLAUSES`

## 환경변수

| 이름 | 용도 |
|---|---|
| `APP_KEY` | 매니저 화면 접근 코드. 프로덕션에서는 필수 |
| `SESSION_SECRET` | 매니저 쿠키 서명 키 |
| `ENCRYPTION_KEY` | 은행 정보 암호화 키. 바꾸면 기존 은행 정보를 복호화할 수 없음 |
| `BLOB_READ_WRITE_TOKEN` 등 | Vercel Blob 스토어를 프로젝트에 연결하면 자동 설정 |

## 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

Blob 환경변수가 없으면 `.data/` 폴더에 파일로 저장한다(개발용).

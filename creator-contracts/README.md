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

- Next.js (App Router) + Postgres (`pg`) + `@react-pdf/renderer`
- 매니저 로그인: Google 계정, `ALLOWED_EMAIL_DOMAINS` 도메인만 허용
- 크리에이터: 로그인 없음, 추측 불가능한 토큰 링크 (`/c/<token>`)
- 은행 정보는 AES-256-GCM으로 암호화해 저장
- 서명 시 시각, IP, 브라우저, 문서 SHA-256을 기록해 PDF 마지막 장에 넣음
- 계약서 기본 조항은 `src/lib/template.ts`의 `DEFAULT_CLAUSES`

## 로컬 실행

```bash
cp .env.example .env.local   # DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY 입력, DEV_LOGIN=1
npm install
npm run migrate              # DATABASE_URL 환경변수 필요
npm run dev
```

## 배포 (Vercel)

1. Vercel 프로젝트를 만들고 Root Directory를 `creator-contracts`로 지정 (별도 저장소로 옮기면 루트 그대로).
2. Postgres(Neon, Supabase 등)를 만들고 `DATABASE_URL` 설정 후 `npm run migrate` 1회 실행.
3. `.env.example`의 나머지 환경변수 설정. `DEV_LOGIN`은 설정하지 않는다.
4. Google Cloud Console에서 OAuth 클라이언트를 만들고 리디렉션 URI에 `https://<도메인>/api/auth/callback/google` 추가.

`ENCRYPTION_KEY`를 바꾸면 기존 은행 정보를 복호화할 수 없으니 분실하지 않도록 보관한다.

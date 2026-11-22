// Edge middleware: single-password gate (no username) with a styled login page.
// Set SITE_PASSWORD to enable. If unset, the site stays open (no lockout).
// A correct password sets a cookie holding only a SHA-256 of the password.

export const config = {
  matcher: ['/((?!_vercel|favicon.ico).*)'],
};

const COOKIE = 'dalba_auth';

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loginPage(message = '') {
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>d'Alba · 로그인</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#f9f9f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#141414}
  .box{background:#fff;border:1px solid #e3e1d8;border-radius:16px;padding:34px 30px;width:320px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  .logo{font-size:22px;font-weight:700;letter-spacing:.5px;margin-bottom:4px}
  .logo b{background:#f2c029;padding:0 6px;border-radius:5px}
  p{color:#666;font-size:13px;margin:0 0 18px}
  input{width:100%;padding:13px 14px;border:1px solid #e3e1d8;border-radius:10px;font-size:15px;margin-bottom:12px}
  input:focus{outline:none;border-color:#141414;box-shadow:0 0 0 3px rgba(242,192,41,.35)}
  button{width:100%;border:0;background:#141414;color:#fff;padding:13px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#000}
  .err{color:#8a1c13;font-size:13px;margin-bottom:12px}
</style></head>
<body>
  <form class="box" method="POST" action="/__auth">
    <div class="logo"><b>d'Alba</b> Analyzer</div>
    <p>비밀번호를 입력하세요</p>
    ${message ? `<div class="err">${message}</div>` : ''}
    <input type="password" name="password" placeholder="비밀번호" autofocus autocomplete="current-password" />
    <button type="submit">입장</button>
  </form>
</body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return; // gate disabled until configured

  const token = await sha256Hex(expected);
  const url = new URL(request.url);

  // Handle the login form submission.
  if (request.method === 'POST' && url.pathname === '/__auth') {
    let entered = '';
    try { entered = (await request.formData()).get('password') || ''; } catch { entered = ''; }
    if (entered === expected) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      });
    }
    return loginPage('비밀번호가 올바르지 않습니다.');
  }

  // Already authenticated?
  const cookies = (request.headers.get('cookie') || '').split(/;\s*/);
  if (cookies.includes(`${COOKIE}=${token}`)) return;

  return loginPage();
}

// 의존성 없는 헬스체크. /api/ping 이 JSON을 주면 함수 배포는 정상.
export default function handler(req, res) {
  res.status(200).json({ ok: true, ver: "hdr-2", ts: Date.now(), node: process.version });
}

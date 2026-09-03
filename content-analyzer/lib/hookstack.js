import { GoogleGenAI } from '@google/genai';
import { EMOTION_FILTER } from './emotion.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let _ai = null;
function ai() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isTransient(err) {
  const s = err?.status || err?.code;
  return s === 429 || s === 500 || s === 503 || /UNAVAILABLE|overload|rate limit|deadline|internal/i.test(String(err?.message || ''));
}
async function withRetry(fn, { tries = 3, base = 2500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) { last = err; if (i === tries - 1 || !isTransient(err)) throw err; await sleep(base * (i + 1)); }
  }
  throw last;
}

const HOOKSTACK_SCHEMA = {
  type: 'object',
  properties: {
    source_hooks: {
      type: 'array',
      description: '입력 영상들에서 뽑은 원본 훅(레이어링 재료). 각 훅의 원문·유형·왜 검증됐는지.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '어느 영상/크리에이터에서 왔는지(@handle 등).' },
          original: { type: 'string', description: '훅 원문(그대로).' },
          type: { type: 'string', description: '훅 유형(한국어): 도발/금기, 질투, 궁금증 갭, 딜, 문제제기 등.' },
          is_emotional: { type: 'boolean', description: '이미 감정형(검증된 감정 라인)이면 true, 성분·스펙 설명형이면 false.' },
        },
        required: ['from', 'original', 'type', 'is_emotional'],
        propertyOrdering: ['from', 'original', 'type', 'is_emotional'],
      },
    },
    hooks: {
      type: 'array',
      description: '검증된 원본 훅들을 레이어링(스태킹)해 만든 결합 훅 3안. 새로 쓰지 말고 원문 문구를 최대한 살려 결합.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '옵션 라벨(한국어 짧게). 예: "A안 · 도발+딜 스택".' },
          text_overlay: { type: 'string', description: '화면 텍스트 오버레이(크리에이터가 쓸 언어).' },
          say: {
            type: 'array',
            description: '훅 대사 1-3줄. 원본 검증 문구를 최대한 보존해 결합.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '대사 한 줄(크리에이터 언어).' },
                highlights: { type: 'array', items: { type: 'string' }, description: '빨간 강조 로드베어링 문구(원문 그대로).' },
              },
              required: ['text', 'highlights'],
              propertyOrdering: ['text', 'highlights'],
            },
          },
          stacked_from: { type: 'array', items: { type: 'string' }, description: '이 안이 결합한 원본 훅들(원문 일부 인용).' },
          emotion_note: { type: 'string', description: '감정 필터 적용 내역(한국어): 설명형을 감정으로 바꾼 부분 / 보존한 검증 라인. 없으면 "원본 감정 라인 보존".' },
          rationale: { type: 'string', description: '왜 이 스택이 강한지(한국어 한 줄).' },
        },
        required: ['label', 'text_overlay', 'say', 'stacked_from', 'emotion_note', 'rationale'],
        propertyOrdering: ['label', 'text_overlay', 'say', 'stacked_from', 'emotion_note', 'rationale'],
      },
    },
  },
  required: ['source_hooks', 'hooks'],
  propertyOrdering: ['source_hooks', 'hooks'],
};

function hookDigest(label, meta, report) {
  const r = report || {};
  const h = r.hook_breakdown || {};
  const lines = (h.lines || []).map((l) => `    - "${l.line}" (${l.analysis})`).join('\n');
  const firstScenes = (r.scenes || []).slice(0, 2).map((s) => `    [${s.time}] "${s.audio_original}"`).join('\n');
  return `### ${label} — @${meta?.author || '?'} ${meta?.stats?.views ? '(views ' + meta.stats.views + ')' : ''}
text_overlay(원문): ${h.text_overlay || '(none)'}
훅 라인:
${lines || '    (none)'}
도입 씬:
${firstScenes || '    (none)'}
훅 요약: ${h.summary || ''}`;
}

/**
 * Hook stacking — layer proven hooks from several videos into 3 combined options.
 * Preserves the verified wording; applies the emotion filter to spec-type lines only.
 */
export async function stackHooks({ hookReports = [], productInfo = '', language = '', meta = {} }) {
  if (!hookReports.length) throw new Error('훅 영상이 최소 1개 필요합니다.');
  const client = ai();

  const block = hookReports.map((c, i) => hookDigest(`HOOK SOURCE #${i + 1}`, c.meta, c.report)).join('\n\n');
  const langLine = language ? `출력 언어: ${language}.` : '출력 언어: 훅 소스들의 주 언어(대개 영어). 특별 지정 없으면 영어.';

  const system = `너는 숏폼 훅 카피라이터다. 서로 다른 크리에이터/시점에 "이미 검증된 훅"들이 여러 개 주어진다.
목표: 이 검증된 훅들을 "레이어링(hook stacking)"해서 결합 훅 3안을 만든다.

핵심 규칙:
- 원문 라인을 최대한 보존한다. 완전히 새로 쓰지 말고, 검증된 문구를 그대로 살려 결합하라. 문구를 갈아엎는 것이 가장 큰 실패다.
- 각 안은 되도록 2개 이상의 소스 훅 요소를 결합하고, stacked_from에 어떤 원문을 썼는지 표기한다.
- 훅은 우리 제품(아래 제품정보)에 맞게 "최소한만" 조정한다. 훅의 심리 메커니즘과 핵심 표현은 유지.
- ${langLine}
- text_overlay(화면 텍스트)는 소스 훅에 실제 오버레이 텍스트가 있을 때만 만든다. 없으면 빈 문자열로 둔다(지어내지 말 것).

${EMOTION_FILTER}
훅에서는 특히: 이미 감정형인 검증된 훅 원문은 절대 바꾸지 말고 보존. 성분·스펙 나열형 라인만 감정 결과로 치환.`;

  const prompt = `아래 검증된 훅들을 레이어링해 결합 훅 3안을 만들어라.

${block}

=== 우리 제품 정보 ===
제품명: ${meta.product || '(미입력)'}
"""
${(productInfo || '(없음)').slice(0, 2000)}
"""`;

  const response = await withRetry(() => client.models.generateContent({
    model: MODEL,
    contents: [system, prompt].join('\n\n'),
    config: { responseMimeType: 'application/json', responseSchema: HOOKSTACK_SCHEMA, temperature: 0.5 },
  }));
  const text = response.text;
  if (!text) throw new Error('No hook stack returned.');
  return JSON.parse(text);
}

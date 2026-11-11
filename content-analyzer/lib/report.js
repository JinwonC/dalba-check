import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import { outLang, retarget, localizeSchema, langDirective } from './lang.js';

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

/** Whether a Gemini error is transient and worth retrying. */
function isTransient(err) {
  const s = err?.status || err?.code;
  const msg = String(err?.message || '');
  return s === 429 || s === 500 || s === 503 ||
    /UNAVAILABLE|overload|high demand|rate limit|deadline|internal/i.test(msg);
}

/** Retry a transient call a few times with short backoff (keeps total under the serverless cap). */
async function withRetry(fn, { tries = 3, base = 2500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i === tries - 1 || !isTransient(err)) throw err;
      await sleep(base * (i + 1));
    }
  }
  throw last;
}

// All analysis text is Korean. Scripts/keywords keep the ORIGINAL wording + a Korean gloss.
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '한국어 2-3문장 요약.' },
    hook_breakdown: {
      type: 'object',
      description: '도입부(처음 약 3-6초)의 훅 분해. 첫 몇 초가 가장 중요하므로 정밀하게.',
      properties: {
        text_overlay: { type: 'string', description: '화면 텍스트 오버레이 원문 그대로(verbatim). 없으면 빈 문자열.' },
        text_overlay_kr: { type: 'string', description: '텍스트 오버레이의 한국어 번역. 없으면 빈 문자열.' },
        lines: {
          type: 'array',
          description: '훅 대사를 문장 단위로 분해.',
          items: {
            type: 'object',
            properties: {
              line: { type: 'string', description: '대사 원문(원어 그대로).' },
              translation: { type: 'string', description: '그 대사의 한국어 번역.' },
              analysis: { type: 'string', description: '이 문장이 건드리는 심리/설득 레버를 한국어로 (예: 질투 유발, 편들기, 호기심 갭, 금기어).' },
            },
            required: ['line', 'translation', 'analysis'],
            propertyOrdering: ['line', 'translation', 'analysis'],
          },
        },
        summary: { type: 'string', description: '훅이 6초 안에 어떻게 작동하는지 한국어 한 문단(예: 찌르고→감싸고→던진다 구조).' },
      },
      required: ['text_overlay', 'text_overlay_kr', 'lines', 'summary'],
      propertyOrdering: ['text_overlay', 'text_overlay_kr', 'lines', 'summary'],
    },
    scenes: {
      type: 'array',
      description: '영상을 순서대로 씬 단위로 분해.',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'string', description: '짧은 씬 이름(한국어). 예: "오프닝 훅", "제품 정보".' },
          time: { type: 'string', description: '구간, 예: "0~16s" 또는 "1:33~1:47".' },
          shot: { type: 'string', description: '카메라 샷(한국어). 예: "미디엄 클로즈업".' },
          visual: { type: 'string', description: '화면 묘사(한국어): 인물·행동·소품·화면텍스트·배경.' },
          audio_original: { type: 'string', description: '그 씬의 대사 원문(원어 그대로, ASR 오류만 보정).' },
          audio_kr: { type: 'string', description: '그 대사의 한국어 번역. 원어가 한국어면 동일하게.' },
        },
        required: ['scene', 'time', 'shot', 'visual', 'audio_original', 'audio_kr'],
        propertyOrdering: ['scene', 'time', 'shot', 'visual', 'audio_original', 'audio_kr'],
      },
    },
    persuasion: {
      type: 'object',
      description: '설득/전환 요인 분석.',
      properties: {
        factors: {
          type: 'array',
          description: '구매 전환을 유도하는 설득 장치들.',
          items: {
            type: 'object',
            properties: {
              factor: { type: 'string', description: '요인 이름(한국어). 예: "권위 차용", "지속력 실연", "스카시티".' },
              detail: { type: 'string', description: '영상에서 그것이 어떻게 쓰였는지 한국어로 구체적으로. 핵심 영어 표현은 따옴표로 인용.' },
            },
            required: ['factor', 'detail'],
            propertyOrdering: ['factor', 'detail'],
          },
        },
        structure: { type: 'string', description: '전환 구조 요약(한국어). 예: 납득→증명→안심→압박, 그리고 결정타가 무엇인지.' },
      },
      required: ['factors', 'structure'],
      propertyOrdering: ['factors', 'structure'],
    },
    keywords: {
      type: 'array',
      description: '메시지를 떠받치는 핵심 키워드/문구.',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '키워드/문구 원문(원어 그대로, 예: "boob filler", "doesn\'t rub off").' },
          note: { type: 'string', description: '왜 중요한지 한국어로 짧게(예: 로드베어링, 성분 본명, 욕망 상태, 지속력, 문제 상태, CTA).' },
        },
        required: ['keyword', 'note'],
        propertyOrdering: ['keyword', 'note'],
      },
    },
    insights: {
      type: 'object',
      properties: {
        whats_working: { type: 'array', items: { type: 'string' }, description: '잘 되고 있는 점(한국어).' },
        improvements: { type: 'array', items: { type: 'string' }, description: '개선 포인트(한국어).' },
        recommendations: { type: 'array', items: { type: 'string' }, description: "d'Alba 브랜드/크리에이티브팀을 위한 구체적 액션(한국어)." },
      },
      required: ['whats_working', 'improvements', 'recommendations'],
      propertyOrdering: ['whats_working', 'improvements', 'recommendations'],
    },
    dalba_relevance: { type: 'string', description: "d'Alba Piedmont와의 연관성/제품 언급(한국어)." },
  },
  required: ['summary', 'hook_breakdown', 'scenes', 'persuasion', 'keywords', 'insights', 'dalba_relevance'],
  propertyOrdering: ['summary', 'hook_breakdown', 'scenes', 'persuasion', 'keywords', 'insights', 'dalba_relevance'],
};

const SYSTEM = `너는 d'Alba Piedmont(프리미엄 비건 뷰티/스킨케어 브랜드)의 시니어 숏폼 비디오 전략가다.
첨부된 영상을 직접 보고, 함께 주어지는 타임코드 자막(WebVTT)도 읽고, 정밀한 씬 분해 + 설득 분석을 만든다.

언어 규칙(매우 중요):
- 모든 분석 텍스트(요약, 씬 이름, 샷, 화면 묘사, 인사이트, 설득 요인, 연관성)는 전부 한국어로 쓴다.
- 대사 스크립트와 키워드는 원어(영어 등) 원문을 그대로 보존하고, 한국어 번역/설명을 함께 제공한다.
  (시청자가 실제로 어떤 단어를 썼는지 파악하기 위함이다. 영어 원문을 절대 한국어로 바꿔치기하지 말 것.)

내용 규칙:
- 씬은 의미 단위로 순서대로 나눈다(보통 6-10개). 각 씬은 하나의 비트(훅/문제/제품정보/시연/소셜프루프/CTA 등).
- "time"은 실제 타임라인에 근거한다(자막 타임스탬프 + 화면). 추측 금지.
- "visual"은 실제로 화면에 보이는 것만(인물·행동·소품·화면 텍스트(따옴표 인용)·배경/조명).
- 오프닝 훅은 첫 3-6초가 핵심이므로 hook_breakdown에서 문장 단위로 쪼개 각 문장이 건드리는 심리/설득 레버를 설명한다.
- persuasion에서는 구매 전환을 만드는 장치(권위 차용, 메커니즘 설명, 지속력 실연, 멀티존 데모, 소셜프루프, 스카시티, 세일 CTA 등)를 찾아내고, 전체 전환 구조와 결정타를 요약한다.
- keywords는 메시지를 떠받치는 핵심 단어/문구를 원어로 뽑고, 각각 왜 중요한지 한국어로 짧게 단다.
- ASR은 종종 브랜드 "d'Alba"를 "Diablo"로 잘못 듣는다 → 반드시 "d'Alba"로 교정.
- 지어내지 말 것(특히 수치). 자막/캡션이 빈약하면 보이는 것에 근거하고 모르면 모른다고.`;

/**
 * Generate the structured scene + persuasion report with Gemini (watches the mp4 + reads the VTT).
 * Analysis is in meta.lang (default Korean); original-language scripts/keywords kept verbatim.
 */
export async function generateReport({ videoBuffer, mimeType = 'video/mp4', transcriptVtt = '', meta = {}, tries = 1 }) {
  const client = ai();
  const lang = outLang(meta.lang);

  let file = await client.files.upload({
    file: new Blob([videoBuffer], { type: mimeType }),
    config: { mimeType },
  });
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await sleep(2000);
    file = await client.files.get({ name: file.name });
  }
  if (file.state !== 'ACTIVE') {
    throw new Error(`Gemini could not process the video (state: ${file.state}).`);
  }

  const stats = Object.entries(meta.stats || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const prompt = `이 ${(meta.platform || 'TikTok')} 영상을 분석하고 씬별 + 설득 리포트를 반환하라.

URL: ${meta.url || '(n/a)'}
제목/캡션: ${meta.title || '(none)'}
작성자: ${meta.author || '(unknown)'}
길이(초): ${meta.durationSeconds ?? '(unknown)'}
지표: ${stats || '(none)'}
해시태그: ${(meta.hashtags || []).map((h) => '#' + h).join(' ') || '(none)'}

타임코드 자막(WebVTT):
"""
${(transcriptVtt || '(없음 — 들리는/보이는 것에 근거)').slice(0, 30000)}
"""`;

  const response = await withRetry(() => client.models.generateContent({
    model: MODEL,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      langDirective(lang) + retarget(SYSTEM, lang),
      prompt,
    ]),
    config: {
      responseMimeType: 'application/json',
      responseSchema: localizeSchema(REPORT_SCHEMA, lang),
      temperature: 0.4,
    },
  }), { tries, base: 2500 });

  const text = response.text;
  if (!text) throw new Error('No report returned by Gemini.');
  return JSON.parse(text);
}

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

// 3-layer "Contents Brief": hook (stacked) + body (our reference structure) + style (direction only).
const GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    product_line: { type: 'string', description: '표지 부제. 예: "with d\'Alba Volufiline Grinding Cream".' },
    reference_note: { type: 'string', description: '표지 핵심 촬영 지시 한 줄(크리에이터 언어).' },
    structure_summary: { type: 'string', description: '3레이어 조립 설명(English, 2-3 sentences): hook=stack, body=replicate our video structure, style=filming direction.' },
    style_direction: {
      type: 'array',
      description: '레이어 3(스타일). 대사가 아니라 촬영/편집 디렉션. 가이드 전체에 옅게 녹임.',
      items: {
        type: 'object',
        properties: {
          aspect: { type: 'string', description: '측면(English): cut speed, angle, lighting, caption style, visual hook staging, etc.' },
          direction: { type: 'string', description: '"shoot it like this" direction (English).' },
        },
        required: ['aspect', 'direction'],
        propertyOrdering: ['aspect', 'direction'],
      },
    },
    hook_options: {
      type: 'array',
      description: '레이어 1. 스택된 훅 3안(입력으로 준 stacked hooks를 그대로 사용, 최소 다듬기). 정확히 3개.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '옵션 라벨(English).' },
          text_overlay: { type: 'string', description: '화면 텍스트 오버레이(크리에이터 언어).' },
          say: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '대사 한 줄(크리에이터 언어).' },
                highlights: { type: 'array', items: { type: 'string' }, description: '빨간 강조 문구(원문).' },
              },
              required: ['text', 'highlights'],
              propertyOrdering: ['text', 'highlights'],
            },
          },
          rationale: { type: 'string', description: '스택 근거(English, one line).' },
        },
        required: ['label', 'text_overlay', 'say', 'rationale'],
        propertyOrdering: ['label', 'text_overlay', 'say', 'rationale'],
      },
    },
    steps: {
      type: 'array',
      description: '바디 스텝만(훅 제외 — 훅은 hook_options에서만). 아래 "검증된 보편 골격(canonical skeleton)"을 기본 순서로 따른다. 이건 problem→solution 흐름이고 "제품이 아니라 욕망을 판다"가 핵심. 순서: (1) Desire — 문제·페인포인트를 증폭해 욕구 자극(훅이 던진 문제를 후벼서 키움; 훅 문구 반복 금지) (2) Personal — "나도 이랬는데 이렇게 해결함", 여기서 제품이 해결책으로 등장 (3) Ingredient — 왜 진짜 효과있는지 "증거"로(스펙 나열 X, 감정 결과 O) (4) Result — 비포/애프터·결과 페이오프 (5) Social proof — 남들의 결과·리뷰·바이럴 (6) CTA. 레퍼런스 영상은 각 비트의 "문장·소구·클레임을 채우는 재료"다. 영상 구조가 이 골격과 다르면 골격을 우선한다. 재료가 정말 없는 비트는 지어내지 말고 생략 가능.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '스텝 이름(영어 짧게): 골격 순서 반영 — Desire, Personal, Ingredient, Result, Social Proof, CTA 등.' },
          layer: { type: 'string', description: '항상 "body". (훅은 steps에 넣지 않는다.)' },
          directive: { type: 'string', description: '촬영 지시(English). 스타일 레이어(디렉션)를 여기에 반영. 대사는 바꾸지 않음.' },
          text_overlay: { type: 'string', description: '화면 텍스트 오버레이(크리에이터 언어). 그 비트의 바디 레퍼런스 영상에 실제 화면 텍스트/이미지 오버레이가 있었을 때만 채운다(visual 설명의 화면텍스트 근거). 없으면 반드시 빈 문자열.' },
          pip: { type: 'string', description: 'PIP(이미지/클립 팝업) 제안(English). 스타일 레이어의 실제 PIP 습관에 근거. 없으면 빈 문자열.' },
          say: {
            type: 'array',
            description: '대사(크리에이터 언어). 바디 스텝은 우리 영상 원문을 보존하되, 제품·성분 설명 비트에는 감정 필터 적용.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '대사 한 줄(크리에이터 언어).' },
                highlights: { type: 'array', items: { type: 'string' }, description: '빨간 강조 문구(원문).' },
              },
              required: ['text', 'highlights'],
              propertyOrdering: ['text', 'highlights'],
            },
          },
          emotion_applied: { type: 'boolean', description: '이 스텝 대사에 감정 필터로 스펙→감정 치환을 적용했으면 true.' },
          time_budget: { type: 'string', description: '목표 시간 구간(예: "0:00–0:03"). 바디 레퍼런스 페이싱에 맞춤.' },
          reference_hint: { type: 'string', description: '이 비트를 어떤 재료로 채웠는지(English): 예 "from our reference video\'s ingredient beat" 또는 "product claim".' },
          our_angle: { type: 'string', description: '이 스텝의 우리 제품 소구 한 줄(English).' },
        },
        required: ['name', 'layer', 'directive', 'text_overlay', 'pip', 'say', 'emotion_applied', 'time_budget', 'reference_hint', 'our_angle'],
        propertyOrdering: ['name', 'layer', 'directive', 'text_overlay', 'pip', 'say', 'emotion_applied', 'time_budget', 'reference_hint', 'our_angle'],
      },
    },
    tips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '팁 한 줄.' },
          emphasis: { type: 'boolean', description: '빨간 강조 여부.' },
        },
        required: ['text', 'emphasis'],
        propertyOrdering: ['text', 'emphasis'],
      },
    },
    product: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '우리 제품 정식명.' },
        bullets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              highlight: { type: 'string', description: '빨간 강조 앞부분(영어). 없으면 빈 문자열.' },
              text: { type: 'string', description: '나머지 설명(영어).' },
            },
            required: ['highlight', 'text'],
            propertyOrdering: ['highlight', 'text'],
          },
        },
      },
      required: ['name', 'bullets'],
      propertyOrdering: ['name', 'bullets'],
    },
  },
  required: ['product_line', 'reference_note', 'structure_summary', 'style_direction', 'hook_options', 'steps', 'tips', 'product'],
  propertyOrdering: ['product_line', 'reference_note', 'structure_summary', 'style_direction', 'hook_options', 'steps', 'tips', 'product'],
};

const SYSTEM = `너는 d'Alba Piedmont의 시니어 숏폼 크리에이티브 디렉터다.
"Contents Brief" 촬영 가이드를 3개 레이어를 조립해 만든다. 각 레이어는 역할이 명확히 분리된다.

[레이어 1 · 훅] — 입력으로 "스택된 훅 3안"이 주어진다(이미 검증된 훅들을 결합한 것).
- 이 훅들을 hook_options에 거의 그대로 넣는다. 문구를 갈아엎지 말 것.
- 훅은 hook_options 3안에서만 다룬다. steps 안에는 훅 스텝을 절대 넣지 말 것(중복 금지).
- 훅의 text_overlay도 스택 훅에 오버레이가 있을 때만. 비어 있으면 그대로 비워둔다.

[레이어 2 · 바디] — 입력으로 "우리 잘 된 레퍼런스 영상"이 주어진다. 이건 '구조'가 아니라 '내용(문장·소구·클레임) 소스'로 쓴다.
- steps는 아래 "검증된 보편 골격"을 기본 순서로 따른다. problem→solution 흐름. 제품이 아니라 욕망을 판다.
  (1) Desire — 문제·페인포인트를 증폭해 욕구를 자극한다. 훅이 던진 문제를 여기서 후벼서 키운다(훅 문구를 그대로 반복하지 말 것 — 던지고→키우고).
  (2) Personal — "나도 이랬는데 이렇게 해결함"의 개인 경험. 여기서 우리 제품이 해결책으로 자연스럽게 등장한다.
  (3) Ingredient — 왜 진짜 효과있는지 "증거"로. 성분·스펙 나열이 아니라, 감정 필터를 적용해 "그래서 이런 변화가 온다"로. emotion_applied=true.
  (4) Result — 비포/애프터·결과 페이오프를 짧게 보여준다.
  (5) Social proof — 남들의 결과·리뷰·바이럴 반응.
  (6) CTA — 지금 뭘 하라.
- 레퍼런스 영상은 각 비트의 "문장·소구·클레임을 채우는 재료"다. 영상에서 쓸 수 있는 원문 대사(say)는 최대한 보존해 해당 골격 비트에 배치한다. 영상 구조가 이 골격과 다르면 골격을 우선한다.
- 영상·제품정보에 재료가 정말 없는 비트(예: 결과·소셜프루프)는 지어내지 말 것. 없는 수치·거짓 후기·과장 단정 금지. 재료가 없으면 그 스텝은 생략 가능.
- text_overlay(화면 텍스트/이미지)는 항상 넣지 않는다. 그 비트의 재료가 된 레퍼런스 영상 visual에 실제 화면 텍스트나 이미지 오버레이가 있었을 때만 그걸 근거로 추천하고, 없으면 text_overlay를 빈 문자열로 둔다. 지어내서 채우지 말 것.

[레이어 3 · 스타일] — 입력으로 특정 크리에이터의 촬영/편집 스타일(DNA)이 주어진다.
- 이건 대사가 아니라 톤/리듬이다. 절대 훅·바디의 "대사 자체"를 바꾸지 않는다.
- 촬영/편집 디렉션으로만 반영한다: style_direction 배열 + 각 스텝의 directive/pip. (컷 전환 속도, 앵글 변화, 비주얼 훅 연출, 자막 스타일, PIP 습관 등)

${EMOTION_FILTER}

언어:
- say/text_overlay는 바디 레퍼런스 영상이 쓰는 언어로 통일한다(크리에이터가 그대로 발화할 대본). 훅도 그 언어에 맞춘다.
- 그 외 모든 필드(label/directive/pip/our_angle/reference_hint/rationale/structure_summary/style_direction/tips)는 영어(English)로 쓴다. 한국어를 절대 출력하지 말 것.

기타:
- 로드베어링 문구는 highlights에 원문 그대로.
- 제품 정보/수치는 입력으로 주어진 것만. 없는 수치 금지. 화장품 광고 규제(의약품적·과장 단정) 회피.
- 이미지/스크린샷은 직접 넣지 않는다. reference_hint와 pip로 글로만 안내.`;

/** Body reference digest — full structure to be preserved (minus the original hook, which gets swapped). */
function bodyDigest(meta, report) {
  const r = report || {};
  const scenes = (r.scenes || []).map((s, i) => `  [${i + 1} · ${s.scene} · ${s.time}] shot:${s.shot} | visual:${s.visual}\n     say(원문): "${s.audio_original}"`).join('\n');
  const kw = (r.keywords || []).map((k) => `${k.keyword} (${k.note})`).join('; ');
  return `우리 레퍼런스 영상 @${meta?.author || '?'} | 길이 ${meta?.durationSeconds ?? '?'}s
요약: ${r.summary || ''}
오프닝 화면텍스트(있으면): ${r.hook_breakdown?.text_overlay || '(없음)'}
비트(내용 재료 — 이 문장·소구·클레임을 골격 비트에 배치. 구조를 그대로 베끼지 말 것):
${scenes || '  (none)'}
설득 구조: ${r.persuasion?.structure || ''}
키워드: ${kw}`;
}

function styleBlock(dna) {
  if (!dna) return '(스타일 레이어 없음)';
  const devices = (dna.devices || []).map((d) => `  - ${d.name} (${d.frequency}): ${d.how_used}`).join('\n');
  const pips = (dna.pip_inventory || []).map((p) => `  - ${p}`).join('\n');
  const vs = dna.visual_style
    ? (typeof dna.visual_style === 'string' ? dna.visual_style : Object.entries(dna.visual_style).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' / '))
    : '';
  const pacing = dna.pacing
    ? `평균 길이 ${dna.pacing.avg_duration_s ?? '?'}s · 평균 씬 ${dna.pacing.avg_scene_count ?? '?'}개 · 씬당 ${dna.pacing.avg_scene_seconds ?? '?'}s`
    : '';
  return `크리에이터: @${dna.creator || '?'}
연출 장치:
${devices || '  (none)'}
PIP 인벤토리:
${pips || '  (none)'}
톤: ${dna.tone || ''}
편집/페이싱: ${pacing}
시각 스타일: ${vs || '(미분석)'}`;
}

function hooksBlock(hooks) {
  return (hooks || []).map((h, i) => {
    const say = (h.say || []).map((l) => `    - "${l.text}"`).join('\n');
    return `  [${h.label || 'Hook ' + (i + 1)}] overlay: ${h.text_overlay || ''}\n${say}`;
  }).join('\n');
}

/**
 * Assemble a 3-layer Contents Brief.
 * @param {Array}  stackedHooks  Layer 1 — the (possibly edited) stacked hook options.
 * @param {Object} bodyReport    Layer 2 — {meta, report} of our winning reference video.
 * @param {Object} styleDna      Layer 3 — creator filming/editing style DNA.
 * @param {string} productInfo   Product claims/numbers.
 * @param {Object} meta          { manager, product }.
 */
export async function generateGuide({ stackedHooks = [], bodyReport = null, styleDna = null, productInfo = '', meta = {}, tries = 3 }) {
  const client = ai();
  if (!stackedHooks.length) throw new Error('훅(레이어 1)이 필요합니다.');
  if (!bodyReport) throw new Error('바디 레퍼런스 영상(레이어 2)이 필요합니다.');

  const prompt = `3레이어를 조립해 Contents Brief를 만들어라.

=== 레이어 1 · 스택된 훅 3안 (hook_options에 거의 그대로) ===
${hooksBlock(stackedHooks)}

=== 레이어 2 · 바디 레퍼런스 (구조·순서·문장 복제, 훅만 교체) ===
${bodyDigest(bodyReport.meta, bodyReport.report)}

=== 레이어 3 · 스타일 (촬영/편집 디렉션으로만) ===
${styleBlock(styleDna)}

=== 우리 제품 정보 ===
제품명: ${meta.product || '(미입력)'}
"""
${(productInfo || '(없음 — 바디 레퍼런스에서 클레임 추출)').slice(0, 3000)}
"""

지시:
1) hook_options = 위 스택 훅 3안 그대로. 훅은 hook_options에만, steps에는 훅 스텝을 넣지 마라(중복 금지).
2) steps = 검증된 보편 골격 순서로: Desire(욕구 자극) → Personal(개인 해결→제품 등장) → Ingredient(효과의 증거·감정필터) → Result(비포/애프터) → Social proof → CTA. 레퍼런스 영상·제품정보를 각 비트의 재료로 채운다. 성분/스펙 비트엔 감정 필터 적용(emotion_applied=true). 재료 없는 비트는 지어내지 말고 생략.
3) 스타일은 style_direction + 각 스텝 directive/pip로만. 대사는 절대 바꾸지 마라.
4) say/overlay 언어는 바디 레퍼런스 언어로 통일. 그 외 모든 설명 필드(label/directive/pip/our_angle/reference_hint/rationale/structure_summary/style_direction/tips)는 영어로. 한국어 출력 금지.`;

  const response = await withRetry(() => client.models.generateContent({
    model: MODEL,
    contents: [SYSTEM, prompt].join('\n\n'),
    config: { responseMimeType: 'application/json', responseSchema: GUIDE_SCHEMA, temperature: 0.5 },
  }), { tries, base: 2500 });

  const text = response.text;
  if (!text) throw new Error('No guide returned by Gemini.');
  const guide = JSON.parse(text);
  guide.creator = styleDna?.creator || bodyReport?.meta?.author || '';
  return guide;
}

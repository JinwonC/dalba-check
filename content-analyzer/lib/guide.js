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
    structure_summary: { type: 'string', description: '3레이어 조립 설명(한국어 2-3문장): 훅=스택, 바디=우리 영상 구조 복제, 스타일=촬영 디렉션.' },
    style_direction: {
      type: 'array',
      description: '레이어 3(스타일). 대사가 아니라 촬영/편집 디렉션. 가이드 전체에 옅게 녹임.',
      items: {
        type: 'object',
        properties: {
          aspect: { type: 'string', description: '측면(한국어): 컷 속도, 앵글, 조명, 자막 스타일, 비주얼 훅 연출 등.' },
          direction: { type: 'string', description: '"이렇게 찍어라" 디렉션(한국어).' },
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
          label: { type: 'string', description: '옵션 라벨(한국어).' },
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
          rationale: { type: 'string', description: '스택 근거(한국어 한 줄).' },
        },
        required: ['label', 'text_overlay', 'say', 'rationale'],
        propertyOrdering: ['label', 'text_overlay', 'say', 'rationale'],
      },
    },
    steps: {
      type: 'array',
      description: '스텝 순서. Step 1 = 스택 훅(A안). Step 2~ = 바디 레퍼런스(우리 영상)의 비트를 순서·소구순서 그대로 복제(문장 보존). 구조를 재배열하지 말 것.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '스텝 이름(영어 짧게): Hook, Education, Ingredient, Demo, Social Proof, CTA 등. 바디 레퍼런스 비트 이름 반영.' },
          layer: { type: 'string', description: '이 스텝의 출처 레이어: "hook" 또는 "body".' },
          directive: { type: 'string', description: '촬영 지시(한국어). 스타일 레이어(디렉션)를 여기에 반영. 대사는 바꾸지 않음.' },
          text_overlay: { type: 'string', description: '화면 텍스트 오버레이(크리에이터 언어). 바디 스텝은 그 비트의 바디 레퍼런스 영상에 실제 화면 텍스트/이미지 오버레이가 있었을 때만 채운다(visual 설명의 화면텍스트 근거). 없으면 반드시 빈 문자열. 훅 스텝은 스택 훅의 오버레이가 있을 때만.' },
          pip: { type: 'string', description: 'PIP(이미지/클립 팝업) 제안(한국어). 스타일 레이어의 실제 PIP 습관에 근거. 없으면 빈 문자열.' },
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
          reference_hint: { type: 'string', description: '무엇을 참고해 찍을지(한국어): 바디 스텝은 "우리 영상 N번 비트처럼", 훅 스텝은 원본 훅 소스.' },
          our_angle: { type: 'string', description: '이 스텝의 우리 제품 소구 한 줄(한국어).' },
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
- Step 1(Hook)은 A안을 기본으로 채운다.
- 훅의 text_overlay도 스택 훅에 오버레이가 있을 때만. 비어 있으면 그대로 비워둔다.

[레이어 2 · 바디] — 입력으로 "우리 잘 된 레퍼런스 영상"의 구조가 주어진다.
- 바디 스텝(Step 2~)은 이 영상의 비트 순서·소구 순서·문장을 "그대로 복제"한다. 구조를 재배열하거나 새 비트를 지어내지 말 것.
- 원문 대사(say)를 최대한 보존한다. 훅만 레이어1 것으로 교체하고, 교육파트/소셜프루프/CTA 흐름은 손대지 않는다.
- 단, "제품 소개·성분 설명" 비트의 대사에는 아래 감정 필터를 적용한다(구조·순서는 유지, 문장 표현만 감정형으로). emotion_applied=true로 표시.
- text_overlay(화면 텍스트/이미지)는 항상 넣지 않는다. 바디 레퍼런스 영상의 그 비트 visual에 실제 화면 텍스트나 이미지 오버레이가 있었을 때만 그걸 근거로 추천하고, 없으면 text_overlay를 빈 문자열로 둔다. 지어내서 채우지 말 것.

[레이어 3 · 스타일] — 입력으로 특정 크리에이터의 촬영/편집 스타일(DNA)이 주어진다.
- 이건 대사가 아니라 톤/리듬이다. 절대 훅·바디의 "대사 자체"를 바꾸지 않는다.
- 촬영/편집 디렉션으로만 반영한다: style_direction 배열 + 각 스텝의 directive/pip. (컷 전환 속도, 앵글 변화, 비주얼 훅 연출, 자막 스타일, PIP 습관 등)

${EMOTION_FILTER}

언어:
- say/text_overlay는 바디 레퍼런스 영상이 쓰는 언어로 통일한다(크리에이터가 그대로 발화할 대본). 훅도 그 언어에 맞춘다.
- directive/pip/our_angle/reference_hint/structure_summary/style_direction은 한국어.

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
비트(순서 그대로 — 이 순서·문장을 복제, 첫 훅 비트만 레이어1으로 교체):
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
1) hook_options = 위 스택 훅 3안 그대로. Step 1 = A안.
2) Step 2~ = 바디 레퍼런스 비트를 순서·문장 그대로 복제. 제품·성분 설명 비트에만 감정 필터 적용(emotion_applied=true), 나머지는 원문 보존.
3) 스타일은 style_direction + 각 스텝 directive/pip로만. 대사는 절대 바꾸지 마라.
4) say/overlay 언어는 바디 레퍼런스 언어로 통일.`;

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

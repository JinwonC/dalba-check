import { GoogleGenAI } from '@google/genai';
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

// Korean analysis; notable comment text kept verbatim (original language) + Korean note.
const COMMENTS_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: { type: 'string', description: '전반적인 댓글 분위기/감성 요약(한국어). 긍정/부정 비율 느낌 포함.' },
    themes: {
      type: 'array',
      description: '반복적으로 나오는 화제/패턴.',
      items: {
        type: 'object',
        properties: {
          theme: { type: 'string', description: '주제 이름(한국어).' },
          detail: { type: 'string', description: '구체 설명(한국어). 핵심 영어 표현은 따옴표 인용.' },
        },
        required: ['theme', 'detail'],
        propertyOrdering: ['theme', 'detail'],
      },
    },
    questions_objections: { type: 'array', items: { type: 'string' }, description: '자주 나오는 질문·반론·우려(한국어, 핵심 원문 인용 가능).' },
    content_requests: { type: 'array', items: { type: 'string' }, description: '시청자들이 요청한 다음 콘텐츠/주제(한국어).' },
    purchase_signals: { type: 'array', items: { type: 'string' }, description: '구매 의향/전환 신호로 보이는 코멘트 패턴(한국어).' },
    notable: {
      type: 'array',
      description: '주목할 만한 개별 댓글.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '댓글 원문(원어 그대로).' },
          note: { type: 'string', description: '왜 주목할 만한지 한국어 한 줄.' },
        },
        required: ['text', 'note'],
        propertyOrdering: ['text', 'note'],
      },
    },
    dalba_actions: { type: 'array', items: { type: 'string' }, description: "댓글에서 도출한 d'Alba를 위한 액션(한국어)." },
  },
  required: ['sentiment', 'themes', 'questions_objections', 'content_requests', 'purchase_signals', 'notable', 'dalba_actions'],
  propertyOrdering: ['sentiment', 'themes', 'questions_objections', 'content_requests', 'purchase_signals', 'notable', 'dalba_actions'],
};

const SYSTEM = `너는 d'Alba Piedmont(뷰티/스킨케어 브랜드)의 소셜 댓글 분석가다.
주어진 TikTok 댓글들을 분석한다.
- 모든 분석은 한국어로 쓴다. 단, notable의 댓글 text는 원문(영어 등) 그대로 보존하고 note만 한국어.
- 실제 댓글에 근거할 것. 지어내지 말고, 표본이 적으면 그렇게 말한다.
- 브랜드/마케팅 관점에서 유용한 신호(감성, 반복 질문·반론, 콘텐츠 요청, 구매 의향)를 뽑는다.`;

const NO_COMMENTS = { ko: '수집된 댓글이 없습니다.', en: 'No comments were collected.', de: 'Es wurden keine Kommentare gesammelt.', fr: 'Aucun commentaire collecté.', es: 'No se recopilaron comentarios.' };

/**
 * Analyze a list of comments with Gemini (text-only — fast, no video upload).
 * @param {object} args
 * @param {Array<{text:string,likes:number,author:string,pinned?:boolean}>} args.comments
 * @param {object} [args.meta]
 */
export async function analyzeComments({ comments = [], meta = {} }) {
  const lang = outLang(meta.lang);
  if (!comments.length) {
    return {
      sentiment: NO_COMMENTS[lang],
      themes: [], questions_objections: [], content_requests: [],
      purchase_signals: [], notable: [], dalba_actions: [],
    };
  }

  const list = comments
    .slice(0, 60)
    .map((c, i) => `${i + 1}. (♥${c.likes}${c.pinned ? ', 고정' : ''}) ${String(c.text).slice(0, 300)}`)
    .join('\n');

  const prompt = `다음은 TikTok 영상의 댓글이다 (좋아요 많은 순, 최대 60개).
영상: ${meta.title || ''} / @${meta.author || ''}

댓글:
"""
${list}
"""

위 댓글을 분석해 구조화 결과를 반환하라.`;

  const response = await ai().models.generateContent({
    model: MODEL,
    contents: `${langDirective(lang)}${retarget(SYSTEM, lang)}\n\n${prompt}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: localizeSchema(COMMENTS_SCHEMA, lang),
      temperature: 0.4,
    },
  });

  const text = response.text;
  if (!text) throw new Error('No comment analysis returned by Gemini.');
  return JSON.parse(text);
}

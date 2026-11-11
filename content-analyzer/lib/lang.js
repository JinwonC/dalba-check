// Output language for analyses. Prompts/schemas are written for Korean; for another language
// every "한국어" directive is retargeted and an explicit override is prepended. Field names
// (text_overlay_kr, audio_kr, translation) keep their shape and hold the chosen language.

export const OUTPUT_LANGS = {
  ko: { name: '한국어', en: 'Korean' },
  en: { name: '영어', en: 'English' },
  de: { name: '독일어', en: 'German' },
  fr: { name: '프랑스어', en: 'French' },
  es: { name: '스페인어', en: 'Spanish' },
};

export const outLang = (code) => (OUTPUT_LANGS[code] ? code : 'ko');

/** Replace Korean-language directives with the target language. */
export function retarget(text, code) {
  const c = outLang(code);
  if (c === 'ko') return text;
  const L = OUTPUT_LANGS[c];
  return String(text).replaceAll('한국어', `${L.name}(${L.en})`);
}

/** Deep-copy a response schema with every description retargeted. */
export function localizeSchema(schema, code) {
  if (outLang(code) === 'ko') return schema;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'description' ? retarget(x, code) : walk(x)]));
    }
    return v;
  };
  return walk(schema);
}

/** Leading instruction that pins the output language (empty for Korean). */
export function langDirective(code) {
  const c = outLang(code);
  if (c === 'ko') return '';
  const L = OUTPUT_LANGS[c];
  return `OUTPUT LANGUAGE: ${L.en}.
All analysis text MUST be written in ${L.en} — not Korean. Fields named *_kr or "translation" hold the ${L.en} translation of the original line (if the original is already ${L.en}, repeat it).
Keep original-language material (spoken lines, on-screen text, keywords, comment text) verbatim.

`;
}

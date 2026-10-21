/** Render a saved analysis record into readable plain text (for Drive/export). */
export function reportToPlainText(rec = {}) {
  const m = rec.meta || {};
  const rep = rec.report || {};
  const c = (rec.comments && rec.comments.analysis) || null;
  const s = m.stats || {};
  let t = `# ${m.title || '(제목 없음)'}\n`;
  if (m.manager) t += `담당자: ${m.manager}\n`;
  if (m.product) t += `제품명: ${m.product}\n`;
  if (m.country) t += `국가: ${m.country}\n`;
  t += `크리에이터: @${m.author || ''}\n링크: ${m.url || ''}\n`;
  t += `지표: 조회 ${s.views ?? '-'} · 좋아요 ${s.likes ?? '-'} · 댓글 ${s.comments ?? '-'} · 공유 ${s.shares ?? '-'}\n`;
  t += `해시태그: ${(m.hashtags || []).map((h) => '#' + h).join(' ')}\n\n`;

  t += `## 요약\n${rep.summary || ''}\n\n`;

  const h = rep.hook_breakdown;
  if (h) {
    t += `## 오프닝 훅 분석\n`;
    if (h.text_overlay) t += `텍스트 오버레이: ${h.text_overlay} (${h.text_overlay_kr || ''})\n`;
    (h.lines || []).forEach((l) => { t += `- "${l.line}" (${l.translation}) → ${l.analysis}\n`; });
    if (h.summary) t += `요약: ${h.summary}\n`;
    t += `\n`;
  }

  t += `## 씬별 분해\n`;
  (rep.scenes || []).forEach((sc) => {
    t += `[${sc.scene} · ${sc.time}] (${sc.shot})\n  화면: ${sc.visual}\n  대사(원문): ${sc.audio_original}\n  대사(한국어): ${sc.audio_kr}\n\n`;
  });

  if (rep.persuasion) {
    t += `## 설득 전환 요인\n`;
    (rep.persuasion.factors || []).forEach((f) => { t += `- ${f.factor}: ${f.detail}\n`; });
    if (rep.persuasion.structure) t += `전환 구조: ${rep.persuasion.structure}\n`;
    t += `\n`;
  }

  if (rep.keywords) {
    t += `## 핵심 키워드\n`;
    rep.keywords.forEach((k) => { t += `- ${k.keyword} ← ${k.note}\n`; });
    t += `\n`;
  }

  if (rep.insights) {
    const i = rep.insights;
    t += `## 크리에이티브 인사이트\n`;
    t += `잘된 점:\n` + (i.whats_working || []).map((x) => '  - ' + x).join('\n') + `\n`;
    t += `개선점:\n` + (i.improvements || []).map((x) => '  - ' + x).join('\n') + `\n`;
    t += `d'Alba 추천:\n` + (i.recommendations || []).map((x) => '  - ' + x).join('\n') + `\n`;
  }
  if (rep.dalba_relevance) t += `\nd'Alba 연관성: ${rep.dalba_relevance}\n`;

  if (c) {
    t += `\n## 댓글 분석 (${rec.comments.count || 0}개)\n감성: ${c.sentiment}\n`;
    if ((c.content_requests || []).length) t += `콘텐츠 요청:\n` + c.content_requests.map((x) => '  - ' + x).join('\n') + `\n`;
    if ((c.questions_objections || []).length) t += `질문·반론:\n` + c.questions_objections.map((x) => '  - ' + x).join('\n') + `\n`;
    if ((c.dalba_actions || []).length) t += `d'Alba 액션:\n` + c.dalba_actions.map((x) => '  - ' + x).join('\n') + `\n`;
  }
  return t;
}

/** Render a generated 3-layer guide into readable plain text (for Drive export). */
export function guideToPlainText(guide = {}, meta = {}) {
  const g = guide || {};
  let t = `Contents Brief\n${g.product_line || ''}\n[ Shooting Guide ]\n\n`;
  if (meta.manager) t += `Manager: ${meta.manager}\n`;
  if (g.creator) t += `Style reference: @${g.creator}\n`;
  t += `\n`;

  if (g.structure_summary) t += `■ Structure\n${g.structure_summary}\n\n`;
  if (g.reference_note) t += `Key direction: ${g.reference_note}\n\n`;

  if ((g.style_direction || []).length) {
    t += `■ Style Direction\n`;
    g.style_direction.forEach((p) => { t += `  · [${p.aspect}] ${p.direction}\n`; });
    t += `\n`;
  }

  if ((g.hook_options || []).length) {
    t += `■ Hook Options (3 stacked)\n`;
    g.hook_options.forEach((h) => {
      t += `  [${h.label}]\n`;
      if (h.text_overlay) t += `    Text overlay: ${h.text_overlay}\n`;
      (h.say || []).forEach((l) => { t += `    Say: ${l.text}\n`; });
      if (h.rationale) t += `    (Why: ${h.rationale})\n`;
    });
    t += `\n`;
  }

  (g.steps || []).forEach((s, i) => {
    t += `── Step ${i + 1} — ${s.name || ''}${s.time_budget ? ' (' + s.time_budget + ')' : ''}${s.emotion_applied ? ' ★Emotion filter' : ''} ──\n`;
    if (s.directive) t += `[Shoot] ${s.directive}\n`;
    if (s.text_overlay) t += `[Text overlay] ${s.text_overlay}\n`;
    if (s.pip) t += `[PIP] ${s.pip}\n`;
    (s.say || []).forEach((line) => { t += `  Say: ${line.text}\n`; });
    if (s.reference_hint) t += `  (Reference: ${s.reference_hint})\n`;
    if (s.our_angle) t += `  (Our angle: ${s.our_angle})\n`;
    t += `\n`;
  });

  if ((g.tips || []).length) {
    t += `■ Tips\n`;
    g.tips.forEach((tip) => { t += `  - ${tip.text}\n`; });
    t += `\n`;
  }

  const p = g.product || {};
  if (p.name || (p.bullets || []).length) {
    t += `■ Product — ${p.name || ''}\n`;
    (p.bullets || []).forEach((b) => { t += `  ✔ ${[b.highlight, b.text].filter(Boolean).join(' ')}\n`; });
  }
  return t;
}

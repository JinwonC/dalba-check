// Word-level diff between the standard clause text and a deal's edited text,
// so a manager can see exactly what was changed for this creator.

export type Part = { type: "same" | "add" | "del"; text: string };

// Words and line breaks are tokens; spaces are re-inserted when rendering.
const tokens = (s: string) => s.replace(/\r/g, "").split(/( +|\n)/).filter((x) => x !== "" && !/^ +$/.test(x));

export function diffWords(before: string, after: string): Part[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  // Longest common subsequence table, filled from the end.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: Part[] = [];
  const push = (type: Part["type"], text: string) => {
    const last = out[out.length - 1];
    const sep = text === "\n" || (last && last.text.endsWith("\n")) ? "" : " ";
    if (last && last.type === type) last.text += sep + text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

export const hasChanges = (parts: Part[]) => parts.some((p) => p.type !== "same");

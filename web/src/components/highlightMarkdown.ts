export type MdSpan = { text: string; kind: 'h' | 'k' | 'c' | 'f' | 'plain' };

const KEY = /^(name|description): /;
const CODE = /`[^`]*`/g;

/** Splits one line into highlight spans; the span texts always concatenate to `line`. */
export function highlightMarkdown(line: string): MdSpan[] {
  if (line === '') return [];
  if (/^#+( |$)/.test(line)) return [{ text: line, kind: 'h' }];
  if (line === '---') return [{ text: line, kind: 'f' }];

  const spans: MdSpan[] = [];
  let rest = line;
  const key = KEY.exec(line);
  if (key) {
    spans.push({ text: key[0], kind: 'k' });
    rest = line.slice(key[0].length);
  }
  let last = 0;
  for (const m of rest.matchAll(CODE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: rest.slice(last, at), kind: 'plain' });
    spans.push({ text: m[0], kind: 'c' });
    last = at + m[0].length;
  }
  if (last < rest.length) spans.push({ text: rest.slice(last), kind: 'plain' });
  return spans;
}

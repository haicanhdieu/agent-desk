export type MdSpan = { text: string; kind: 'h' | 'k' | 'c' | 'f' | 'plain' };

const KEY = /^(name|description): /;
const CODE = /`[^`]*`/g;

/** Splits one line into highlight spans; the span texts always concatenate to `line`. */
export function highlightMarkdown(original: string): MdSpan[] {
  // CRLF: match on the line without its trailing \r, but keep the \r in the output text.
  const cr = original.endsWith('\r') ? '\r' : '';
  const line = cr ? original.slice(0, -1) : original;
  if (line === '') return cr ? [{ text: cr, kind: 'plain' }] : [];
  if (/^#+( |$)/.test(line)) return [{ text: original, kind: 'h' }];
  if (line === '---') return [{ text: original, kind: 'f' }];

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
  if (cr) {
    const tail = spans[spans.length - 1];
    if (tail && tail.kind === 'plain') tail.text += cr;
    else spans.push({ text: cr, kind: 'plain' });
  }
  return spans;
}

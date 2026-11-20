export interface FrontMatter {
  fields: { key: string; value: string }[];
  body: string;
}

const FIELD = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;

/** Splits a leading `---` block into fields. Nothing in the text is dropped: if it is not a clean block, it is all body. */
export function splitFrontMatter(text: string): FrontMatter {
  const whole: FrontMatter = { fields: [], body: text };
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[0] !== '---') return whole;
  const close = lines.indexOf('---', 1);
  if (close === -1) return whole;

  const fields: { key: string; value: string }[] = [];
  for (const line of lines.slice(1, close)) {
    if (line.trim() === '') continue;
    const m = FIELD.exec(line);
    if (m) {
      fields.push({ key: m[1] ?? '', value: (m[2] ?? '').trim() });
      continue;
    }
    const last = fields[fields.length - 1];
    if (!last) return whole;
    last.value = last.value === '' ? line.trim() : `${last.value} ${line.trim()}`;
  }
  return { fields, body: lines.slice(close + 1).join('\n') };
}

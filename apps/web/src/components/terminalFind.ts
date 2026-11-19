import type { TermLine } from './Terminal';

/** One match: `start` and `end` are offsets into the line's text (its spans joined). */
export interface TermMatch {
  line: number;
  start: number;
  end: number;
}

export const lineText = (line: TermLine): string => line.map((s) => s.text).join('');

/** The log as plain text, one line per row. */
export const logText = (lines: TermLine[]): string => lines.map(lineText).join('\n');

/** Every case-insensitive, non-overlapping occurrence of `query`, in reading order. An empty query matches nothing. */
export function findMatches(lines: TermLine[], query: string): TermMatch[] {
  if (query === '') return [];
  const needle = query.toLowerCase();
  const out: TermMatch[] = [];
  lines.forEach((line, i) => {
    const text = lineText(line).toLowerCase();
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      out.push({ line: i, start: at, end: at + needle.length });
    }
  });
  return out;
}

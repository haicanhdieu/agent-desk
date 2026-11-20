import { diffLines } from 'diff';

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  /** The line without its `\n` and without a trailing `\r`. */
  text: string;
  /** 1-based line number in main; absent for 'add'. */
  baseNo?: number;
  /** 1-based line number in the draft; absent for 'del'. */
  draftNo?: number;
}

/** Line diff of the draft against main, compared as stored. The whole file is returned. */
export function lineDiff(base: string, draft: string): DiffLine[] {
  const out: DiffLine[] = [];
  let baseNo = 0;
  let draftNo = 0;
  for (const change of diffLines(base, draft)) {
    const pieces = change.value.split('\n');
    if (pieces[pieces.length - 1] === '') pieces.pop();
    for (const piece of pieces) {
      const text = piece.endsWith('\r') ? piece.slice(0, -1) : piece;
      if (change.added) {
        draftNo += 1;
        out.push({ kind: 'add', text, draftNo });
      } else if (change.removed) {
        baseNo += 1;
        out.push({ kind: 'del', text, baseNo });
      } else {
        baseNo += 1;
        draftNo += 1;
        out.push({ kind: 'same', text, baseNo, draftNo });
      }
    }
  }
  return out;
}

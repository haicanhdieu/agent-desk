import { describe, expect, it } from 'vitest';
import { lineDiff } from './lineDiff';

const same = (text: string, baseNo: number, draftNo: number) => ({ kind: 'same', text, baseNo, draftNo });
const add = (text: string, draftNo: number) => ({ kind: 'add', text, draftNo });
const del = (text: string, baseNo: number) => ({ kind: 'del', text, baseNo });

describe('lineDiff', () => {
  it('unchanged text is all same, numbered on both sides', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([same('a', 1, 1), same('b', 2, 2)]);
  });

  it('empty against empty is no lines', () => {
    expect(lineDiff('', '')).toEqual([]);
  });

  it('a final newline adds no empty line', () => {
    expect(lineDiff('a\n', 'a\n')).toEqual([same('a', 1, 1)]);
  });

  it('a line added at the start, middle and end', () => {
    expect(lineDiff('b\nc', 'a\nb\nc')).toEqual([add('a', 1), same('b', 1, 2), same('c', 2, 3)]);
    expect(lineDiff('a\nc', 'a\nb\nc')).toEqual([same('a', 1, 1), add('b', 2), same('c', 2, 3)]);
    expect(lineDiff('a\nb\n', 'a\nb\nc\n')).toEqual([same('a', 1, 1), same('b', 2, 2), add('c', 3)]);
  });

  it('a line removed at the start, middle and end', () => {
    expect(lineDiff('a\nb\nc', 'b\nc')).toEqual([del('a', 1), same('b', 2, 1), same('c', 3, 2)]);
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([same('a', 1, 1), del('b', 2), same('c', 3, 2)]);
    expect(lineDiff('a\nb\nc\n', 'a\nb\n')).toEqual([same('a', 1, 1), same('b', 2, 2), del('c', 3)]);
  });

  it('a changed line is removed, then added', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([same('a', 1, 1), del('b', 2), add('B', 2), same('c', 3, 3)]);
  });

  it('adding a newline after the last line shows that line removed and added', () => {
    expect(lineDiff('a\nb', 'a\nb\n')).toEqual([same('a', 1, 1), del('b', 2), add('b', 2)]);
  });

  it('a CRLF-only change shows as changed lines', () => {
    expect(lineDiff('a\r\nb', 'a\nb')).toEqual([del('a', 1), add('a', 1), same('b', 2, 2)]);
  });
});

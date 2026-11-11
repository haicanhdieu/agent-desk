import { describe, expect, it } from 'vitest';
import { highlightMarkdown } from './highlightMarkdown';

const join = (l: string) => highlightMarkdown(l).map((s) => s.text).join('');

describe('highlightMarkdown', () => {
  it('heading is one h span', () => {
    expect(highlightMarkdown('# Title')).toEqual([{ text: '# Title', kind: 'h' }]);
    expect(highlightMarkdown('## Steps')).toEqual([{ text: '## Steps', kind: 'h' }]);
  });
  it('front-matter keys', () => {
    expect(highlightMarkdown('name: code-build')).toEqual([
      { text: 'name: ', kind: 'k' }, { text: 'code-build', kind: 'plain' },
    ]);
    expect(highlightMarkdown('description: Do it.')[0]).toEqual({ text: 'description: ', kind: 'k' });
  });
  it('inline code includes backticks', () => {
    expect(highlightMarkdown('at `main`.')).toEqual([
      { text: 'at ', kind: 'plain' }, { text: '`main`', kind: 'c' }, { text: '.', kind: 'plain' },
    ]);
  });
  it('multiple inline code spans', () => {
    const kinds = highlightMarkdown('Run `a` and `b` now').map((s) => s.kind);
    expect(kinds).toEqual(['plain', 'c', 'plain', 'c', 'plain']);
  });
  it('fence', () => {
    expect(highlightMarkdown('---')).toEqual([{ text: '---', kind: 'f' }]);
  });
  it('plain, empty, unterminated backtick', () => {
    expect(highlightMarkdown('just text')).toEqual([{ text: 'just text', kind: 'plain' }]);
    expect(highlightMarkdown('')).toEqual([]);
    expect(highlightMarkdown('a `open').every((s) => s.kind === 'plain')).toBe(true);
  });
  it('key not at line start is plain', () => {
    expect(highlightMarkdown('  name: x').some((s) => s.kind === 'k')).toBe(false);
  });
  it('CRLF: fence and heading recognised, original text preserved', () => {
    expect(highlightMarkdown('---\r')).toEqual([{ text: '---\r', kind: 'f' }]);
    expect(highlightMarkdown('# H\r')).toEqual([{ text: '# H\r', kind: 'h' }]);
    expect(highlightMarkdown('name: x\r').map((s) => s.kind)).toEqual(['k', 'plain']);
    expect(join('a `b`\r')).toBe('a `b`\r');
    expect(join('\r')).toBe('\r');
  });
  it('spans concatenate back to the original line', () => {
    for (const l of ['', '# H', '---', 'name: x', 'description: a `b` c', '`a``b`', 'a `open', '``', '`', 'x `y` `z', '  # not heading', '- Never push to `main`.', 'tab\there `c`', '----']) {
      expect(join(l)).toBe(l);
    }
  });
});

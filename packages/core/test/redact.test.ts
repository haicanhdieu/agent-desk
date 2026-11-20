import { describe, expect, it } from 'vitest';
import { redact, unfinishedTokenStart } from '../src/redact';

describe('redact', () => {
  it('removes access-token URLs and ghs_ tokens', () => {
    const out = redact('https://x-access-token:ghs_abcdefghijklmnopqrstuv@github.com/a/b.git', []);
    expect(out).not.toContain('ghs_');
    expect(out).not.toContain('x-access-token');
    expect(out).toContain('github.com/a/b.git');
  });

  it('removes anthropic keys and supplied secrets everywhere', () => {
    const out = redact('key sk-ant-abc123_DEF-456xyz and hunter2 and hunter2', ['hunter2']);
    expect(out).toBe('key *** and *** and ***');
  });

  it('ignores empty secrets and regex metacharacters in secrets', () => {
    expect(redact('a.b+c', ['', 'a.b+c'])).toBe('***');
    expect(redact('abc', [''])).toBe('abc');
  });
});

describe('unfinishedTokenStart', () => {
  it('returns the length when the text does not end inside a token', () => {
    expect(unfinishedTokenStart('plain text')).toBe(10);
    expect(unfinishedTokenStart('')).toBe(0);
    expect(unfinishedTokenStart('ends with x')).toBe(11);
    expect(unfinishedTokenStart('ghs_ then more words')).toBe(20);
  });

  it.each([
    ['x-access-token:ghs_abc', 'x-access-token:'],
    ['sk-ant-api03-AB_c', 'sk-ant-'],
    ['ghs_ABCDEF', 'ghs_'],
    ['ghs_', 'ghs_'],
  ])('finds where an unfinished token starts: %s', (tail, start) => {
    const text = `see ${tail}`;
    expect(unfinishedTokenStart(text)).toBe(4);
    expect(text.slice(4)).toContain(start);
  });

  it.each(['x-acc', 'x-access-toke', 'sk-an', 'sk-ant'])('finds a cut start of a token pattern: %s', (tail) => {
    expect(unfinishedTokenStart(`see ${tail}`)).toBe(4);
  });

  it('does not treat a short cut start (under 4 chars) as a token', () => {
    for (const tail of ['x-', 'gh', 'sk', 'sk-', 'ghs'])
      expect(unfinishedTokenStart(`see ${tail}`)).toBe(4 + tail.length);
  });

  it('covers every token pattern that redact replaces', () => {
    const samples = [
      'x-access-token:ghs_abcdefghijklmnopqrstuv@',
      'ghs_abcdefghijklmnopqrstuv',
      'sk-ant-abc123_DEF-456xyz',
    ];
    for (const sample of samples) {
      expect(redact(sample, [])).toBe('***');
      for (let cut = 4; cut < sample.length; cut += 1) {
        const text = `a ${sample.slice(0, cut)}`;
        expect(unfinishedTokenStart(text), text).toBeLessThanOrEqual(2);
      }
    }
  });
});

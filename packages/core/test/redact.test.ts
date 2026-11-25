import { describe, expect, it } from 'vitest';
import { MIN_SECRET_LENGTH, maskCacheSize, redact, unfinishedTokenStart } from '../src/redact';

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

  it('removes GitHub classic and fine-grained tokens, also glued to a word character', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghr_']) {
      expect(redact(`a my_${prefix}${'a'.repeat(36)} b`, [])).toBe('a my_*** b');
    }
    expect(redact(`x github_pat_${'B'.repeat(30)} y`, [])).toBe('x *** y');
    expect(redact('ghp_short is not a token', [])).toBe('ghp_short is not a token');
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

describe('redact cost', () => {
  it('stays linear on a long run of access-token prefixes with no @', () => {
    const text = 'x-access-token:'.repeat(20000);
    const start = performance.now();
    expect(redact(text, [])).toBe(text);
    // Unbounded, this took about 3 s for 300k characters (quadratic); bounded it is a few milliseconds.
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('finds an unfinished token start in linear time on a hostile text', () => {
    const text = `${'x-access-token:'.repeat(20000)} `;
    const start = performance.now();
    expect(unfinishedTokenStart(text)).toBe(text.length);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('still masks a real access-token URL and a long real token', () => {
    expect(redact('https://x-access-token:abc123@github.com/a/b.git', [])).toBe('https://***github.com/a/b.git');
    const tok = `ghp_${'A'.repeat(400)}`;
    expect(redact(`t ${tok} e`, [])).toBe('t *** e');
  });
});

describe('credentials-file redaction', () => {
  const canary = (n: string): string => `canary-${n}-\u00e9\u4e2d-${'x'.repeat(12)}`;
  const doc = (): Record<string, unknown> => ({
    auth_mode: 'chatgpt',
    short: 'abc',
    n: 123456789,
    flag: true,
    nothing: null,
    d1: canary('d1'),
    nested: {
      d2: canary('d2'),
      deeper: { d3: canary('d3'), list: [canary('arr'), 'tiny', [canary('arr2')], { d4: canary('inarr') }] },
    },
    padding: 'p'.repeat(10_000),
    multi: 'line one\nline two canary',
  });
  const NAMES = ['d1', 'd2', 'd3', 'arr', 'arr2', 'inarr'];

  it.each(['codex', 'opencode'])(
    '%s: masks an auth_json value, each nested string, arrays and a copy without whitespace',
    () => {
      const value = JSON.stringify(doc(), null, 2);
      const compact = value.replace(/\s+/g, '');
      const text = [
        `whole ${value}`,
        `compact ${compact}`,
        ...NAMES.map((n) => `at ${canary(n)} end`),
        'encoded line one\\nline two canary',
        'raw line one\nline two canary',
      ].join('\n');
      const out = redact(text, [value]);
      for (const n of NAMES) expect(out).not.toContain(canary(n));
      expect(out).not.toContain('line two canary');
      expect(out).not.toContain('p'.repeat(MIN_SECRET_LENGTH));
      expect(out).toContain('at *** end');
    },
  );

  it('skips short and non-string values', () => {
    const value = JSON.stringify({ a: 'abc', b: 1234567, c: true, d: null, e: ['xy', 'long-enough-value'] });
    expect(redact('abc 1234567 true null xy', [value])).toBe('abc 1234567 true null xy');
    expect(redact('x long-enough-value y', [value])).toBe('x *** y');
  });

  it('falls back to the whole text when it is not JSON', () => {
    const text = 'not json {\nsecret-line-two-value\n';
    expect(redact(`log: ${text}`, [text])).toBe('log: ***');
    expect(redact('x secret-line-two-value y', [text])).toBe('x *** y');
  });

  it('masks a multi-line pasted value whole', () => {
    const pem = 'line-one-aaaaaaa\nline-two-bbbbbbb\nline-three-ccccccc';
    expect(redact(`before ${pem} after line-two-bbbbbbb`, [pem])).toBe('before *** after ***');
  });

  it('still masks a plain api key, including an own-endpoint key', () => {
    const key = 'sk-own-endpoint-0123456789';
    expect(redact(`Authorization: Bearer ${key}`, [key])).toBe('Authorization: Bearer ***');
  });
});

describe('redact: hostile and repeated secrets', () => {
  it('masks a credential nested 50,000 levels deep without throwing', () => {
    const depth = 50_000;
    const secret = `${'['.repeat(depth)}"deep-secret-value"${']'.repeat(depth)}`;
    let out = '';
    expect(() => {
      out = redact('x deep-secret-value y', [secret]);
    }).not.toThrow();
    expect(out).not.toContain('deep-secret-value');
  });

  it('gives identical output on repeated calls and keeps its memo bounded', () => {
    const secret = JSON.stringify({ token: 'repeat-secret-value' });
    const first = redact('a repeat-secret-value b', [secret]);
    expect(redact('a repeat-secret-value b', [secret])).toBe(first);
    expect(first).not.toContain('repeat-secret-value');
    for (let i = 0; i < 500; i += 1) redact('x', [`distinct-secret-${i}`]);
    expect(maskCacheSize()).toBeLessThanOrEqual(64);
    expect(redact('a repeat-secret-value b', [secret])).toBe(first);
  });
});

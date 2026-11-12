import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact';

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

import { describe, expect, it } from 'vitest';
import { ORG_SLUG_MAX, OrgSlug, slugFromName } from './slug';

describe('slugFromName', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugFromName('Acme Corp')).toBe('acme-corp');
  });
  it('collapses runs and trims hyphens', () => {
    expect(slugFromName('  Hello__World!! ')).toBe('hello-world');
  });
  it.each(['', 'ÄÖ'])('falls back to org for %j', (name) => {
    expect(slugFromName(name)).toBe('org');
  });
  it('cuts long names without a trailing hyphen', () => {
    const slug = slugFromName(`${'a'.repeat(62)} ${'b'.repeat(138)}`);
    expect(slug.length).toBeLessThanOrEqual(ORG_SLUG_MAX);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('a'.repeat(62));
  });
  it('always parses with OrgSlug for random strings', () => {
    for (let i = 0; i < 50; i++) {
      const name = Array.from({ length: 1 + (i % 90) }, () =>
        String.fromCharCode(Math.floor(Math.random() * 0x250)),
      ).join('');
      expect(OrgSlug.safeParse(slugFromName(name)).success).toBe(true);
    }
  });
});

describe('OrgSlug', () => {
  it.each(['', '-a', 'a-', 'A', 'a_b', 'a'.repeat(64)])('rejects %j', (s) => {
    expect(OrgSlug.safeParse(s).success).toBe(false);
  });
  it.each(['acme-eu-1', 'a'.repeat(63), 'a'])('accepts %j', (s) => {
    expect(OrgSlug.safeParse(s).success).toBe(true);
  });
});

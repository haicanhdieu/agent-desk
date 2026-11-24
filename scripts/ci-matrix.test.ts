import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMatrix } from './ci-matrix';

describe('buildMatrix', () => {
  it('expands shard counts into one entry per shard', () => {
    expect(buildMatrix({ db: 2, api: 1 })).toEqual({
      include: [
        { pkg: 'db', shard: 1, total: 2 },
        { pkg: 'db', shard: 2, total: 2 },
        { pkg: 'api', shard: 1, total: 1 },
      ],
    });
  });

  it('rejects a zero shard count', () => {
    expect(() => buildMatrix({ db: 0 })).toThrow();
  });

  it('rejects a fractional shard count', () => {
    expect(() => buildMatrix({ db: 1.5 })).toThrow();
  });

  it('rejects an unknown package name', () => {
    expect(() => buildMatrix({ web: 1 })).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => buildMatrix([1, 2])).toThrow();
    expect(() => buildMatrix(null)).toThrow();
  });
});

describe('.github/ci-shards.json', () => {
  const shards: unknown = JSON.parse(readFileSync(new URL('../.github/ci-shards.json', import.meta.url), 'utf8'));
  const matrix = buildMatrix(shards).include;

  it('splits the api integration suite (the 13 minute job) into 2 or 3 shards', () => {
    const api = matrix.filter((entry) => entry.pkg === 'api');
    expect(api.length).toBeGreaterThanOrEqual(2);
    expect(api.length).toBeLessThanOrEqual(3);
  });

  it('runs every shard of every package exactly once', () => {
    for (const { pkg, total } of matrix) {
      const numbers = matrix.filter((entry) => entry.pkg === pkg).map((entry) => entry.shard);
      expect(numbers).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    }
  });
});

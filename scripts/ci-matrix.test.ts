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

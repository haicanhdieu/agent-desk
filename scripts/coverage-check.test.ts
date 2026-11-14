import { describe, expect, it } from 'vitest';
import { checkCoverage } from './coverage-check';

const pct = { lines: 1, branches: 1, functions: 1, statements: 1 };

describe('checkCoverage', () => {
  it('passes when every gated package reported coverage', () => {
    const summary = Object.fromEntries(['api', 'worker', 'core', 'db', 'web', 'contracts'].map((p) => [p, pct]));
    expect(checkCoverage(summary)).toEqual([]);
  });

  it('reports a gated package that has no coverage', () => {
    const summary = Object.fromEntries(['api', 'worker', 'core', 'web', 'contracts'].map((p) => [p, pct]));
    expect(checkCoverage(summary)).toEqual(['db: no coverage was reported']);
  });

  it('rejects a malformed summary', () => {
    expect(() => checkCoverage({ api: { lines: 'x' } })).toThrow();
  });
});

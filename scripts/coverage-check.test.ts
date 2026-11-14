import { describe, expect, it } from 'vitest';
import { checkCoverage } from './coverage-check';

const PKGS = ['api', 'worker', 'core', 'db', 'web', 'contracts'];
const pct = { lines: 90, branches: 80, functions: 90, statements: 90 };
const summaryOf = (over: Record<string, Partial<typeof pct>> = {}) =>
  Object.fromEntries(PKGS.map((p) => [p, { ...pct, ...over[p] }]));
const thresholdsOf = (over: Record<string, { lines: number; branches?: number }> = {}) => ({
  packages: {
    ...Object.fromEntries(PKGS.map((p) => [p, p === 'web' ? { lines: 60 } : { lines: 70, branches: 60 }])),
    ...over,
  },
});

describe('checkCoverage', () => {
  it('passes when every package is above its floors', () => {
    expect(checkCoverage(summaryOf(), thresholdsOf())).toEqual([]);
  });

  it('passes at exactly the floor', () => {
    const summary = summaryOf({ core: { lines: 70, branches: 60 } });
    expect(checkCoverage(summary, thresholdsOf())).toEqual([]);
  });

  it('fails below the line floor and names package, metric, measured and required', () => {
    const summary = summaryOf({ db: { lines: 69.9 } });
    expect(checkCoverage(summary, thresholdsOf())).toEqual(['db: lines coverage 69.9% is below the required 70%']);
  });

  it('fails below the branch floor', () => {
    const summary = summaryOf({ api: { branches: 59 } });
    expect(checkCoverage(summary, thresholdsOf())).toEqual(['api: branches coverage 59% is below the required 60%']);
  });

  it('does not check branches for a package without a branch floor', () => {
    const summary = summaryOf({ web: { branches: 0 } });
    expect(checkCoverage(summary, thresholdsOf())).toEqual([]);
  });

  it('reports a gated package that has no coverage', () => {
    const { db: _db, ...rest } = summaryOf();
    expect(checkCoverage(rest, thresholdsOf())).toEqual(['db: no coverage was reported']);
  });

  it('reports a gated package that has no thresholds', () => {
    const { web: _web, ...packages } = thresholdsOf().packages;
    expect(checkCoverage(summaryOf(), { packages })).toEqual(['web: no coverage thresholds are configured']);
  });

  it('rejects a malformed summary', () => {
    expect(() => checkCoverage({ api: { lines: 'x' } }, thresholdsOf())).toThrow();
  });

  it('rejects a malformed thresholds config', () => {
    expect(() => checkCoverage(summaryOf(), { packages: { api: { lines: 'high' } } })).toThrow();
    expect(() => checkCoverage(summaryOf(), { packages: { api: { lines: 101 } } })).toThrow();
    expect(() => checkCoverage(summaryOf(), {})).toThrow();
  });
});

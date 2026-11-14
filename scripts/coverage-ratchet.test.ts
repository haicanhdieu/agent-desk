import { describe, expect, it } from 'vitest';
import { checkBaselineNotLowered, checkRatchet, improvementNotices, raiseBaseline } from './coverage-ratchet';

const PKGS = ['api', 'worker', 'core', 'db', 'web', 'contracts'];
const base = { lines: 80, branches: 70 };
const baselineOf = (over: Record<string, Partial<typeof base>> = {}) =>
  Object.fromEntries(PKGS.map((p) => [p, { ...base, ...over[p] }]));
const summaryOf = (over: Record<string, Partial<typeof base>> = {}) =>
  Object.fromEntries(PKGS.map((p) => [p, { ...base, functions: 1, statements: 1, ...over[p] }]));

describe('checkRatchet', () => {
  it('passes when equal to the baseline', () => {
    expect(checkRatchet(summaryOf(), baselineOf())).toEqual([]);
  });

  it('passes when within the 0.5 tolerance below', () => {
    expect(checkRatchet(summaryOf({ api: { lines: 79.5, branches: 69.5 } }), baselineOf())).toEqual([]);
  });

  it('fails more than 0.5 below on lines, naming package, metric, current, baseline and minimum', () => {
    expect(checkRatchet(summaryOf({ core: { lines: 79.4 } }), baselineOf())).toEqual([
      'core: lines coverage 79.4% dropped below the baseline 80% (allowed minimum 79.5%)',
    ]);
  });

  it('fails more than 0.5 below on branches', () => {
    expect(checkRatchet(summaryOf({ web: { branches: 69 } }), baselineOf())).toEqual([
      'web: branches coverage 69% dropped below the baseline 70% (allowed minimum 69.5%)',
    ]);
  });

  it('fails for a package in the summary but missing from the baseline', () => {
    const baseline = baselineOf();
    delete baseline.db;
    expect(checkRatchet(summaryOf(), baseline)).toEqual(['db: no coverage baseline is recorded']);
  });

  it('rejects a malformed baseline', () => {
    expect(() => checkRatchet(summaryOf(), { api: { lines: 'high' } })).toThrow();
    expect(() => checkRatchet(summaryOf(), { api: { lines: 1, branches: 1, extra: 2 } })).toThrow();
  });
});

describe('improvementNotices', () => {
  it('suggests --update when a metric is at least 1 point above the baseline', () => {
    const notices = improvementNotices(summaryOf({ api: { lines: 81 } }), baselineOf());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('api: lines coverage 81%');
    expect(notices[0]).toContain('--update');
  });

  it('stays quiet below 1 point of improvement', () => {
    expect(improvementNotices(summaryOf({ api: { lines: 80.9 } }), baselineOf())).toEqual([]);
  });
});

describe('raiseBaseline', () => {
  it('raises values and rounds down to one decimal', () => {
    const next = raiseBaseline(
      summaryOf({ api: { lines: 91.99, branches: 70.04 } }),
      baselineOf({ api: { lines: 90 } }),
    );
    expect(next.api).toEqual({ lines: 91.9, branches: 70 });
  });

  it('never lowers a value', () => {
    const next = raiseBaseline(summaryOf({ api: { lines: 10, branches: 10 } }), baselineOf());
    expect(next.api).toEqual(base);
  });

  it('adds a package that has no baseline yet', () => {
    const baseline = baselineOf();
    delete baseline.db;
    expect(raiseBaseline(summaryOf({ db: { lines: 72.47, branches: 78.84 } }), baseline).db).toEqual({
      lines: 72.4,
      branches: 78.8,
    });
  });
});

describe('checkBaselineNotLowered', () => {
  it('passes when the PR only raises values', () => {
    expect(checkBaselineNotLowered(baselineOf(), baselineOf({ api: { lines: 85 } }))).toEqual([]);
  });

  it('detects a decrease against the base copy', () => {
    expect(checkBaselineNotLowered(baselineOf(), baselineOf({ api: { branches: 69.9 } }))).toEqual([
      'api: branches baseline was lowered from 70 to 69.9; the baseline may only go up',
    ]);
  });

  it('detects a removed package', () => {
    const pr = baselineOf();
    delete pr.worker;
    expect(checkBaselineNotLowered(baselineOf(), pr)).toEqual([
      'worker: baseline was removed; the baseline may only go up',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { checkCoverage, matchesGlob, patchLinesThreshold } from './coverage-check';

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

describe('patch threshold', () => {
  it('is accepted by the gate schema and read back', () => {
    const config = { ...thresholdsOf(), patch: { lines: 80 } };
    expect(checkCoverage(summaryOf(), config)).toEqual([]);
    expect(patchLinesThreshold(config)).toBe(80);
  });

  it('is required when asked for', () => {
    expect(() => patchLinesThreshold(thresholdsOf())).toThrow();
  });

  it('rejects out-of-range or unknown patch settings', () => {
    expect(() => patchLinesThreshold({ ...thresholdsOf(), patch: { lines: 101 } })).toThrow();
    expect(() => checkCoverage(summaryOf(), { ...thresholdsOf(), patch: { lines: 'x' } })).toThrow();
    expect(() => checkCoverage(summaryOf(), { ...thresholdsOf(), patch: { lines: 80, extra: 1 } })).toThrow();
  });
});

const fileEntry = (lines: [number, number], branches: [number, number]) => ({
  lines: { total: lines[1], covered: lines[0], skipped: 0, pct: 0 },
  branches: { total: branches[1], covered: branches[0], skipped: 0, pct: 0 },
  functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
  statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
});
type FileEntry = ReturnType<typeof fileEntry>;
const perFileOf = (api: Record<string, FileEntry>) => ({ api: { total: fileEntry([0, 0], [0, 0]), ...api } });
const withSensitive = (group: Record<string, unknown> = {}) => ({
  ...thresholdsOf(),
  sensitive: [{ name: 'auth', globs: ['apps/api/src/auth/**'], lines: 90, branches: 85, ...group }],
});

describe('matchesGlob', () => {
  it('matches ** across directories and * within one segment', () => {
    expect(matchesGlob('apps/api/src/auth/**', 'apps/api/src/auth/a/b.ts')).toBe(true);
    expect(matchesGlob('apps/api/src/auth/**', 'apps/api/src/authx/b.ts')).toBe(false);
    expect(matchesGlob('packages/core/src/*.ts', 'packages/core/src/redact.ts')).toBe(true);
    expect(matchesGlob('packages/core/src/*.ts', 'packages/core/src/kube/x.ts')).toBe(false);
    expect(matchesGlob('packages/db/src/withOrg.ts', 'packages/db/src/withOrg.ts')).toBe(true);
    expect(matchesGlob('packages/db/src/withOrg.ts', 'packages/db/src/withOrgX.ts')).toBe(false);
  });
});

describe('checkCoverage sensitive groups', () => {
  const good = perFileOf({
    'apps/api/src/auth/a.ts': fileEntry([90, 100], [85, 100]),
    'apps/api/src/other.ts': fileEntry([0, 100], [0, 100]),
  });

  it('passes at exactly the floor', () => {
    expect(checkCoverage(summaryOf(), withSensitive(), good)).toEqual([]);
  });

  it('fails below the line floor naming group, metric, measured and required', () => {
    const files = perFileOf({ 'apps/api/src/auth/a.ts': fileEntry([89, 100], [85, 100]) });
    const [failure, ...rest] = checkCoverage(summaryOf(), withSensitive(), files);
    expect(rest).toEqual([]);
    expect(failure).toContain('sensitive path "auth"');
    expect(failure).toContain('lines coverage 89%');
    expect(failure).toContain('required 90%');
    expect(failure).toContain('docs/conventions/git-workflow.md');
  });

  it('fails below the branch floor', () => {
    const files = perFileOf({ 'apps/api/src/auth/a.ts': fileEntry([95, 100], [84, 100]) });
    const [failure, ...rest] = checkCoverage(summaryOf(), withSensitive(), files);
    expect(rest).toEqual([]);
    expect(failure).toContain('branches coverage 84%');
    expect(failure).toContain('required 85%');
  });

  it('weights by counts so a small perfect file does not mask a large uncovered one', () => {
    const files = perFileOf({
      'apps/api/src/auth/big.ts': fileEntry([0, 1000], [0, 1000]),
      'apps/api/src/auth/small.ts': fileEntry([10, 10], [10, 10]),
    });
    expect(checkCoverage(summaryOf(), withSensitive(), files)).toHaveLength(2);
  });

  it('fails when a group matches no files', () => {
    const [failure, ...rest] = checkCoverage(summaryOf(), withSensitive({ globs: ['apps/api/src/gone/**'] }), good);
    expect(rest).toEqual([]);
    expect(failure).toContain('sensitive path "auth"');
    expect(failure).toContain('matches no files');
  });

  it('matches files of any package and any of the group globs', () => {
    const files = { ...perFileOf({}), db: { 'packages/db/src/withOrg.ts': fileEntry([9, 10], [9, 10]) } };
    const config = withSensitive({ name: 'tenancy', globs: ['nope/**', 'packages/db/src/withOrg.ts'], lines: 90 });
    expect(checkCoverage(summaryOf(), config, files)).toEqual([]);
  });

  it('skips the branch check when the group has no branches', () => {
    const files = perFileOf({ 'apps/api/src/auth/a.ts': fileEntry([10, 10], [0, 0]) });
    expect(checkCoverage(summaryOf(), withSensitive(), files)).toEqual([]);
  });

  it('fails when sensitive groups are configured but no per-file coverage is given', () => {
    const [failure] = checkCoverage(summaryOf(), withSensitive());
    expect(failure).toContain('per-file coverage');
  });

  it('rejects a malformed sensitive config', () => {
    for (const bad of [{ globs: [] }, { globs: [''] }, { lines: 101 }, { name: '' }, { extra: 1 }]) {
      expect(() => checkCoverage(summaryOf(), withSensitive(bad), good)).toThrow();
    }
  });
});

describe('the real coverage-thresholds.json', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const raw: unknown = JSON.parse(readFileSync(path.join(root, 'coverage-thresholds.json'), 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((f) => f !== '');

  it('configures sensitive groups', () => {
    const { sensitive } = z.object({ sensitive: z.array(z.unknown()).min(1) }).parse(raw);
    expect(sensitive.length).toBeGreaterThan(0);
  });

  it('has a sensitive glob matching a real tracked file for every glob, so a rename cannot orphan one', () => {
    const { sensitive } = z
      .object({ sensitive: z.array(z.object({ name: z.string(), globs: z.array(z.string()) })) })
      .parse(raw);
    const orphans = sensitive.flatMap((g) =>
      g.globs.filter((glob) => !tracked.some((f) => matchesGlob(glob, f))).map((glob) => `${g.name}: ${glob}`),
    );
    expect(orphans).toEqual([]);
  });
});

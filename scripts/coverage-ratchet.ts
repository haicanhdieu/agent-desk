// Coverage ratchet: a package may not drop below the committed baseline by more than the tolerance.
// Usage (all via `pnpm --silent exec tsx scripts/coverage-ratchet.ts ...`):
//   --check <merged-dir> --baseline <file>   fail when coverage dropped below <file> (CI passes main's copy on PRs)
//   --update <merged-dir> [--baseline <file>] raise coverage-baseline.json from the merged summary; never lowers.
//                                          Run this after adding tests, then commit the file.
//   --compare <base-file> <pr-file>          fail when the PR copy of the baseline lowers or drops any value
// <merged-dir> is the --out dir of coverage-merge.ts. The baseline defaults to coverage-baseline.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { GATED_PACKAGES } from './coverage-check';

/** Points a package may fall below its baseline before the gate fails (absorbs local-vs-CI noise). */
export const RATCHET_TOLERANCE = 0.5;
/** Improvement, in points, at which a notice suggests bumping the baseline. */
export const IMPROVEMENT_NOTICE_POINTS = 1;
const DEFAULT_BASELINE = 'coverage-baseline.json';
const METRICS = ['lines', 'branches'] as const;

const percent = z.number().min(0).max(100);
const baselineSchema = z.record(z.string(), z.object({ lines: percent, branches: percent }).strict());
const summarySchema = z.record(z.string(), z.object({ lines: z.number(), branches: z.number() }).passthrough());

type Baseline = z.infer<typeof baselineSchema>;

const round = (n: number): number => Math.round(n * 10) / 10;
// Floor to one decimal; the epsilon keeps values like 72.4 (stored as 72.39999) from losing a tenth.
const floor1 = (n: number): number => Math.floor(n * 10 + 1e-9) / 10;

/** One failure per package and metric that fell more than RATCHET_TOLERANCE below the baseline. */
export function checkRatchet(rawSummary: unknown, rawBaseline: unknown): string[] {
  const summary = summarySchema.parse(rawSummary);
  const baseline = baselineSchema.parse(rawBaseline);
  const failures: string[] = [];
  for (const [pkg, measured] of Object.entries(summary)) {
    const recorded = baseline[pkg];
    if (recorded === undefined) {
      failures.push(`${pkg}: no coverage baseline is recorded`);
      continue;
    }
    for (const metric of METRICS) {
      const minimum = round(recorded[metric] - RATCHET_TOLERANCE);
      if (measured[metric] < minimum) {
        failures.push(
          `${pkg}: ${metric} coverage ${measured[metric]}% dropped below the baseline ${recorded[metric]}% (allowed minimum ${minimum}%)`,
        );
      }
    }
  }
  return failures;
}

/** Notices for metrics at least IMPROVEMENT_NOTICE_POINTS above the baseline. Never a failure. */
export function improvementNotices(rawSummary: unknown, rawBaseline: unknown): string[] {
  const summary = summarySchema.parse(rawSummary);
  const baseline = baselineSchema.parse(rawBaseline);
  const notices: string[] = [];
  for (const [pkg, measured] of Object.entries(summary)) {
    const recorded = baseline[pkg];
    if (recorded === undefined) continue;
    for (const metric of METRICS) {
      if (measured[metric] - recorded[metric] >= IMPROVEMENT_NOTICE_POINTS) {
        notices.push(
          `${pkg}: ${metric} coverage ${measured[metric]}% is above the baseline ${recorded[metric]}%; run "pnpm --silent exec tsx scripts/coverage-ratchet.ts --update <merged-dir>" to raise it`,
        );
      }
    }
  }
  return notices;
}

/** max(old, new rounded down to one decimal) per package and metric; never lowers. */
export function raiseBaseline(rawSummary: unknown, rawBaseline: unknown): Baseline {
  const summary = summarySchema.parse(rawSummary);
  const baseline = baselineSchema.parse(rawBaseline);
  const next: Baseline = { ...baseline };
  for (const [pkg, measured] of Object.entries(summary)) {
    const old = baseline[pkg];
    next[pkg] = {
      lines: Math.max(old?.lines ?? 0, floor1(measured.lines)),
      branches: Math.max(old?.branches ?? 0, floor1(measured.branches)),
    };
  }
  return next;
}

/** Failures for every value in the PR copy of the baseline that is lower than (or missing from) the base copy. */
export function checkBaselineNotLowered(rawBase: unknown, rawPr: unknown): string[] {
  const base = baselineSchema.parse(rawBase);
  const pr = baselineSchema.parse(rawPr);
  const failures: string[] = [];
  for (const [pkg, was] of Object.entries(base)) {
    const now = pr[pkg];
    if (now === undefined) {
      failures.push(`${pkg}: baseline was removed; the baseline may only go up`);
      continue;
    }
    for (const metric of METRICS) {
      if (now[metric] < was[metric]) {
        failures.push(
          `${pkg}: ${metric} baseline was lowered from ${was[metric]} to ${now[metric]}; the baseline may only go up`,
        );
      }
    }
  }
  return failures;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const readSummary = (dir: string): unknown => readJson(path.join(dir, 'summary.json'));

function fail(failures: string[], prefix: string): never {
  for (const failure of failures) process.stderr.write(`::error::${prefix}: ${failure}\n`);
  process.exit(1);
}

function main(): void {
  const [mode, first, second, third] = process.argv.slice(2);
  const usage =
    'usage: tsx scripts/coverage-ratchet.ts --check|--update <merged-dir> [--baseline <file>] | --compare <base> <pr>';
  if (mode === undefined || first === undefined) throw new Error(usage);
  if (mode === '--compare') {
    if (second === undefined) throw new Error(usage);
    const failures = checkBaselineNotLowered(readJson(first), readJson(second));
    if (failures.length > 0) fail(failures, 'coverage baseline');
    process.stdout.write('coverage baseline: no value was lowered\n');
    return;
  }
  if (second !== undefined && second !== '--baseline') throw new Error(usage);
  const file = third ?? DEFAULT_BASELINE;
  const summary = readSummary(first);
  if (mode === '--update') {
    const next = raiseBaseline(summary, readJson(file));
    for (const pkg of GATED_PACKAGES) if (!(pkg in next)) throw new Error(`${pkg}: no coverage was reported`);
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`coverage: raised ${file}\n`);
    return;
  }
  if (mode !== '--check') throw new Error(usage);
  const baseline = readJson(file);
  const failures = checkRatchet(summary, baseline);
  for (const notice of improvementNotices(summary, baseline)) process.stdout.write(`::notice::coverage: ${notice}\n`);
  if (failures.length > 0) {
    process.stderr.write(
      'coverage dropped; add tests, do not edit the baseline (after adding coverage you can raise it with the --update command)\n',
    );
    fail(failures, 'coverage ratchet');
  }
  process.stdout.write('coverage: ratchet passed\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

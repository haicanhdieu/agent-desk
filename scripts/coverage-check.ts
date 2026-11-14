// Reads the merged coverage summary and exits 1 when the gate fails.
// Usage: tsx scripts/coverage-check.ts <merged-dir> [thresholds-file]
//        tsx scripts/coverage-check.ts --patch-lines [thresholds-file]   (prints the patch coverage threshold)
//   <merged-dir> is the --out dir of coverage-merge.ts; thresholds-file defaults to coverage-thresholds.json.
// checkCoverage is the single place gate rules plug in.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const GATED_PACKAGES = ['api', 'worker', 'core', 'db', 'web', 'contracts'] as const;

const pctSchema = z.object({
  lines: z.number(),
  branches: z.number(),
  functions: z.number(),
  statements: z.number(),
});
const summarySchema = z.record(z.string(), pctSchema);

const percent = z.number().min(0).max(100);
const thresholdsSchema = z.object({
  packages: z.record(z.string(), z.object({ lines: percent, branches: percent.optional() }).strict()),
  /** Minimum coverage of the lines a PR changes; enforced by diff-cover in CI. */
  patch: z.object({ lines: percent }).strict().optional(),
});

/** The required patch coverage (percent of changed lines); throws when the config does not set one. */
export function patchLinesThreshold(rawThresholds: unknown): number {
  const { patch } = thresholdsSchema.parse(rawThresholds);
  if (patch === undefined) throw new Error('coverage thresholds: "patch.lines" is not configured');
  return patch.lines;
}

/** Returns one human-readable failure per violated rule; empty means the gate passes. */
export function checkCoverage(rawSummary: unknown, rawThresholds: unknown): string[] {
  const summary = summarySchema.parse(rawSummary);
  const { packages } = thresholdsSchema.parse(rawThresholds);
  const failures: string[] = [];
  for (const pkg of GATED_PACKAGES) {
    if (!(pkg in packages)) failures.push(`${pkg}: no coverage thresholds are configured`);
  }
  for (const [pkg, floors] of Object.entries(packages)) {
    const measured = summary[pkg];
    if (measured === undefined) {
      failures.push(`${pkg}: no coverage was reported`);
      continue;
    }
    for (const metric of ['lines', 'branches'] as const) {
      const required = floors[metric];
      if (required !== undefined && measured[metric] < required) {
        failures.push(`${pkg}: ${metric} coverage ${measured[metric]}% is below the required ${required}%`);
      }
    }
  }
  return failures;
}

function main(): void {
  if (process.argv[2] === '--patch-lines') {
    // Prints the number so a workflow step can pass it to diff-cover without hardcoding it.
    const file = process.argv[3] ?? 'coverage-thresholds.json';
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    process.stdout.write(`${patchLinesThreshold(raw)}\n`);
    return;
  }
  const dir = process.argv[2];
  if (dir === undefined) throw new Error('usage: tsx scripts/coverage-check.ts <merged-dir> [thresholds-file]');
  const thresholdsFile = process.argv[3] ?? 'coverage-thresholds.json';
  const summary: unknown = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const thresholds: unknown = JSON.parse(readFileSync(thresholdsFile, 'utf8'));
  const failures = checkCoverage(summary, thresholds);
  for (const failure of failures) process.stderr.write(`::error::coverage: ${failure}\n`);
  if (failures.length > 0) process.exit(1);
  process.stdout.write('coverage: gate passed\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

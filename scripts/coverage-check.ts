// Reads the merged coverage summary and exits 1 when the gate fails.
// Usage: tsx scripts/coverage-check.ts <merged-dir> [thresholds-file]
//        tsx scripts/coverage-check.ts --patch-lines [thresholds-file]   (prints the patch coverage threshold)
//   <merged-dir> is the --out dir of coverage-merge.ts; thresholds-file defaults to coverage-thresholds.json.
// checkCoverage is the single place gate rules plug in.
import { existsSync, readFileSync } from 'node:fs';
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

const counterSchema = z.object({ total: z.number(), covered: z.number() });
/** One package's `coverage-summary.json`: a `total` entry plus one entry per repo-relative file path. */
const fileSummarySchema = z.record(z.string(), z.object({ lines: counterSchema, branches: counterSchema }));
export type FileSummaries = Record<string, unknown>;

const percent = z.number().min(0).max(100);
const thresholdsSchema = z.object({
  packages: z.record(z.string(), z.object({ lines: percent, branches: percent.optional() }).strict()),
  /** Minimum coverage of the lines a PR changes; enforced by diff-cover in CI. */
  patch: z.object({ lines: percent }).strict().optional(),
  /** Security-relevant code (docs/conventions/git-workflow.md "Sensitive paths") held to higher floors than its package. */
  sensitive: z
    .array(
      z
        .object({
          name: z.string().min(1),
          globs: z.array(z.string().min(1)).min(1),
          lines: percent,
          branches: percent.optional(),
        })
        .strict(),
    )
    .optional(),
});

/** Minimal repo-path glob: `**` crosses directories, `*` and `?` stay within one path segment. */
export function matchesGlob(glob: string, file: string): boolean {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      i++;
      if (glob.charAt(i + 1) === '/') {
        i++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`).test(file);
}

/** The required patch coverage (percent of changed lines); throws when the config does not set one. */
export function patchLinesThreshold(rawThresholds: unknown): number {
  const { patch } = thresholdsSchema.parse(rawThresholds);
  if (patch === undefined) throw new Error('coverage thresholds: "patch.lines" is not configured');
  return patch.lines;
}

/** Returns one human-readable failure per violated rule; empty means the gate passes. */
export function checkCoverage(rawSummary: unknown, rawThresholds: unknown, rawFileSummaries?: FileSummaries): string[] {
  const summary = summarySchema.parse(rawSummary);
  const { packages, sensitive } = thresholdsSchema.parse(rawThresholds);
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
  if (sensitive !== undefined && sensitive.length > 0) {
    if (rawFileSummaries === undefined) {
      failures.push('sensitive paths: no per-file coverage was reported');
    } else {
      const files = Object.entries(rawFileSummaries).flatMap(([, raw]) =>
        Object.entries(fileSummarySchema.parse(raw)).filter(([file]) => file !== 'total'),
      );
      for (const group of sensitive) {
        failures.push(...checkSensitiveGroup(group, files));
      }
    }
  }
  return failures;
}

const SENSITIVE_HINT =
  'sensitive paths are listed in docs/conventions/git-workflow.md; add tests, do not lower the floor';

function checkSensitiveGroup(
  group: { name: string; globs: string[]; lines: number; branches?: number | undefined },
  files: [string, z.infer<typeof fileSummarySchema>[string]][],
): string[] {
  const matched = files.filter(([file]) => group.globs.some((glob) => matchesGlob(glob, file)));
  if (matched.length === 0) {
    return [
      `sensitive path "${group.name}": group matches no files (globs: ${group.globs.join(', ')}; stale or mistyped glob?); ${SENSITIVE_HINT}`,
    ];
  }
  const failures: string[] = [];
  for (const metric of ['lines', 'branches'] as const) {
    const required = group[metric];
    const total = matched.reduce((n, [, f]) => n + f[metric].total, 0);
    if (required === undefined || total === 0) continue;
    const covered = matched.reduce((n, [, f]) => n + f[metric].covered, 0);
    const pct = Math.round((covered / total) * 10000) / 100;
    if (pct < required) {
      failures.push(
        `sensitive path "${group.name}": ${metric} coverage ${pct}% (${covered}/${total}, ${matched.length} files) is below the required ${required}%; ${SENSITIVE_HINT}`,
      );
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
  const fileSummaries: FileSummaries = {};
  for (const pkg of GATED_PACKAGES) {
    const file = path.join(dir, pkg, 'coverage-summary.json');
    if (existsSync(file)) fileSummaries[pkg] = JSON.parse(readFileSync(file, 'utf8'));
  }
  const failures = checkCoverage(summary, thresholds, fileSummaries);
  for (const failure of failures) process.stderr.write(`::error::coverage: ${failure}\n`);
  if (failures.length > 0) process.exit(1);
  process.stdout.write('coverage: gate passed\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

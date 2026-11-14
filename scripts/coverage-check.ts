// Reads the merged coverage summary and exits 1 when the gate fails.
// Usage: tsx scripts/coverage-check.ts <merged-dir>   (the --out dir of coverage-merge.ts)
// Today it only requires every gated package to have reported; thresholds plug into checkCoverage.
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

/** Returns one human-readable failure per violated rule; empty means the gate passes. */
export function checkCoverage(raw: unknown): string[] {
  const summary = summarySchema.parse(raw);
  const failures: string[] = [];
  for (const pkg of GATED_PACKAGES) {
    if (!(pkg in summary)) failures.push(`${pkg}: no coverage was reported`);
  }
  return failures;
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) throw new Error('usage: tsx scripts/coverage-check.ts <merged-dir>');
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const failures = checkCoverage(raw);
  for (const failure of failures) process.stderr.write(`::error::coverage: ${failure}\n`);
  if (failures.length > 0) process.exit(1);
  process.stdout.write('coverage: gate passed\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Turns .github/ci-shards.json ({ "<package>": <shard count> }) into a GitHub Actions matrix.
// Usage: tsx scripts/ci-matrix.ts   (prints one-line JSON for `fromJSON`)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const SHARDED_PACKAGES = ['api', 'worker', 'core', 'db'] as const;

const shardsSchema = z.partialRecord(z.enum(SHARDED_PACKAGES), z.number().int().min(1));

export interface Matrix {
  include: { pkg: string; shard: number; total: number }[];
}

export function buildMatrix(shards: unknown): Matrix {
  const parsed = shardsSchema.parse(shards);
  const include: Matrix['include'] = [];
  for (const [pkg, total] of Object.entries(parsed)) {
    for (let shard = 1; shard <= total; shard++) include.push({ pkg, shard, total });
  }
  return { include };
}

function main(): void {
  const raw: unknown = JSON.parse(readFileSync('.github/ci-shards.json', 'utf8'));
  process.stdout.write(`${JSON.stringify(buildMatrix(raw))}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Merges the per-job `coverage-final.json` artifacts (unit + sharded integration) into one coverage map per package.
// Usage: tsx scripts/coverage-merge.ts <artifact-dir> <out-dir>
//   <artifact-dir>/<coverage->?<pkg>-<kind>[-<shard>]/coverage-final.json  (as downloaded by actions/download-artifact)
//   <out-dir>/<pkg>/coverage-final.json, <out-dir>/<pkg>/coverage-summary.json, <out-dir>/summary.json
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';

export type CoverageData = libCoverage.CoverageMapData;

export const METRICS = ['lines', 'branches', 'functions', 'statements'] as const;
export type Metric = (typeof METRICS)[number];
export type PackageSummary = Record<Metric, number>;
export type Summary = Record<string, PackageSummary>;

export interface Artifact {
  name: string;
  pkg: string;
  kind: string;
  shard: string | undefined;
  file: string;
}

const REPO_PATH_RE = /(?:^|\/)((?:apps|packages)\/[^/]+\/.+)$/;
const ARTIFACT_RE = /^(?:coverage-)?([a-z0-9]+)-(unit|integration)(?:-(\d+))?$/;

/** Runner paths are absolute and differ per machine; keep the part from `apps/` or `packages/` on. */
export function normalizePath(file: string, repoRoot?: string): string {
  if (repoRoot !== undefined) {
    const prefix = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`;
    if (file.startsWith(prefix)) return file.slice(prefix.length);
  }
  const match = REPO_PATH_RE.exec(file);
  return match?.[1] ?? file;
}

export function normalizeCoverage(data: CoverageData, repoRoot?: string): CoverageData {
  const out: CoverageData = {};
  for (const [file, cov] of Object.entries(data)) {
    const rel = normalizePath(file, repoRoot);
    out[rel] = { ...cov, path: rel };
  }
  return out;
}

export function mergeCoverage(inputs: CoverageData[], repoRoot?: string): libCoverage.CoverageMap {
  const map = libCoverage.createCoverageMap({});
  for (const input of inputs) map.merge(normalizeCoverage(input, repoRoot));
  return map;
}

export function discoverArtifacts(dir: string): Artifact[] {
  const found: Artifact[] = [];
  const entries = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const name of entries) {
    const file = path.join(dir, name, 'coverage-final.json');
    const match = ARTIFACT_RE.exec(name);
    if (match === null || !statSync(path.join(dir, name)).isDirectory() || !existsSync(file)) continue;
    const [, pkg, kind, shard] = match;
    if (pkg !== undefined && kind !== undefined) found.push({ name, pkg, kind, shard, file });
  }
  if (found.length === 0) throw new Error(`no coverage artifacts found under ${dir}`);
  return found;
}

function readCoverage(artifact: Artifact): CoverageData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifact.file, 'utf8'));
  } catch {
    throw new Error(`${artifact.name}: ${artifact.file} is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new Error(`${artifact.name}: ${artifact.file} has no files`);
  }
  // Shape is vitest's istanbul coverage-final.json; istanbul-lib-coverage validates each entry on merge.
  return parsed as CoverageData;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

/** Same shape as vitest's `json-summary` reporter: `total` plus one entry per file. */
function summaryJson(map: libCoverage.CoverageMap): Record<string, unknown> {
  const out: Record<string, unknown> = { total: map.getCoverageSummary().toJSON() };
  for (const file of map.files().sort()) out[file] = map.fileCoverageFor(file).toSummary().toJSON();
  return out;
}

export function mergeArtifacts(artifactDir: string, outDir: string, repoRoot?: string): Summary {
  const byPkg = new Map<string, CoverageData[]>();
  for (const artifact of discoverArtifacts(artifactDir)) {
    byPkg.set(artifact.pkg, [...(byPkg.get(artifact.pkg) ?? []), readCoverage(artifact)]);
  }
  const summary: Summary = {};
  for (const [pkg, inputs] of [...byPkg].sort(([a], [b]) => a.localeCompare(b))) {
    const map = mergeCoverage(inputs, repoRoot);
    writeJson(path.join(outDir, pkg, 'coverage-final.json'), map.toJSON());
    writeJson(path.join(outDir, pkg, 'coverage-summary.json'), summaryJson(map));
    const total = map.getCoverageSummary();
    summary[pkg] = {
      lines: total.lines.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
      statements: total.statements.pct,
    };
  }
  writeJson(path.join(outDir, 'summary.json'), summary);
  return summary;
}

export function renderSummaryTable(summary: Summary): string {
  const rows = Object.entries(summary).map(
    ([pkg, pct]) => `| ${pkg} | ${METRICS.map((m) => `${pct[m].toFixed(2)}%`).join(' | ')} |`,
  );
  return [
    '| Package | Lines | Branches | Functions | Statements |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

function main(): void {
  const [artifactDir, outDir] = process.argv.slice(2);
  if (artifactDir === undefined || outDir === undefined) {
    throw new Error('usage: tsx scripts/coverage-merge.ts <artifact-dir> <out-dir>');
  }
  const table = renderSummaryTable(mergeArtifacts(artifactDir, outDir));
  process.stdout.write(`${table}\n`);
  const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
  if (stepSummary !== undefined && stepSummary !== '') appendFileSync(stepSummary, `## Coverage\n\n${table}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

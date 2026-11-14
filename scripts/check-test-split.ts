// Guard: tests that need Docker (they reach `@agentdesk/db/testing`, which starts Testcontainers Postgres)
// must be named `*.int.test.ts`; `*.int.test.ts` files must actually need it.
// Usage: tsx scripts/check-test-split.ts   (exit 1 and list offenders when the split is wrong)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOCKER_MODULE = '@agentdesk/db/testing';
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const isTest = (p: string): boolean => /\.test\.tsx?$/.test(p);
const isInt = (p: string): boolean => /\.int\.test\.tsx?$/.test(p);

function resolveRelative(from: string, spec: string, files: Record<string, string>): string | undefined {
  const base = path.posix.join(path.posix.dirname(from), spec.replace(/\.(?:js|ts|tsx)$/, ''));
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => c in files);
}

function reachesDocker(start: string, files: Record<string, string>): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const match of (files[file] ?? '').matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec === undefined) continue;
      if (spec === DOCKER_MODULE) return true;
      if (spec.startsWith('.')) {
        const next = resolveRelative(file, spec, files);
        if (next !== undefined) stack.push(next);
      }
    }
  }
  return false;
}

/** `files` maps repo-relative path to source. Returns tests whose name disagrees with whether they need Docker. */
export function findMisnamed(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter(isTest)
    .filter((file) => reachesDocker(file, files) !== isInt(file))
    .sort();
}

function main(): void {
  const tracked = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'apps', 'packages'],
    {
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter((f) => /\.tsx?$/.test(f));
  const files: Record<string, string> = {};
  for (const f of tracked) files[f] = readFileSync(f, 'utf8');
  const offenders = findMisnamed(files);
  for (const f of offenders) {
    const msg = isInt(f)
      ? 'is named *.int.test.ts but never reaches @agentdesk/db/testing'
      : 'reaches @agentdesk/db/testing (Docker) but is not named *.int.test.ts';
    console.error(`test-split: ${f} ${msg}`);
  }
  process.exit(offenders.length > 0 ? 1 : 0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

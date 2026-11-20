import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard for Dependabot alerts on pnpm-lock.yaml (issue #166). It reads the lockfile only (no network)
// and fails when a resolved package version sits inside a known-vulnerable range. Add a row when a new alert is fixed.
const root = resolve(__dirname, '..');

type Version = readonly [number, number, number];

const parse = (version: string): Version => {
  const [major = 0, minor = 0, patch = 0] = version
    .split(/[-+]/)[0]
    ?.split('.')
    .map((part) => Number.parseInt(part, 10)) ?? [0, 0, 0];
  return [major, minor, patch];
};

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const inRange = (version: string, from: string, before: string): boolean => {
  const v = parse(version);
  return compare(v, parse(from)) >= 0 && compare(v, parse(before)) < 0;
};

/** Every `name@version` resolved in the `packages:` section of the lockfile. */
function resolvedVersions(lockfile: string): Map<string, string[]> {
  const section = lockfile.split(/^packages:$/m)[1]?.split(/^snapshots:$/m)[0] ?? '';
  const found = new Map<string, string[]>();
  for (const match of section.matchAll(/^ {2}'?((?:@[^/\s']+\/)?[^@\s']+)@([^:\s']+)'?:/gm)) {
    const [, name, version] = match;
    if (name === undefined || version === undefined) continue;
    found.set(name, [...(found.get(name) ?? []), version]);
  }
  return found;
}

const ADVISORIES = [
  { alert: 18, name: 'minimatch', from: '7.0.0', before: '11.0.1', summary: 'DoS via globparts amplification' },
  { alert: 17, name: 'glob', from: '9.0.0', before: '14.0.2', summary: 'AbortSignal cancellation bypass' },
  { alert: 1, name: 'esbuild', from: '0.0.0', before: '0.25.0', summary: 'dev server readable by any website' },
] as const;

describe('pnpm-lock.yaml', () => {
  const resolved = resolvedVersions(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));

  it('parses the resolved packages', () => {
    expect(resolved.get('esbuild')?.length).toBeGreaterThan(0);
  });

  it.each(ADVISORIES)('resolves no $name version affected by Dependabot alert #$alert ($summary)', (advisory) => {
    const affected = (resolved.get(advisory.name) ?? []).filter((v) => inRange(v, advisory.from, advisory.before));
    expect(affected).toEqual([]);
  });
});

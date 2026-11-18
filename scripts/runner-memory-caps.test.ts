import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// A run pod has a 4 GiB memory limit and the repo's own tools size their pools from the host CPU count, so an
// uncapped `pnpm test` or `pnpm typecheck` can OOM the pod (the kernel kills it with exit 137 and the run shows as
// paused). runner-env.sh caps what one pod runs at once; these tests pin that.
const root = resolve(__dirname, '..');
const envScript = resolve(__dirname, 'runner-env.sh');

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'runner-env-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Sources runner-env.sh in a clean shell and returns the variables the caps are made of. */
function sourced(env: Record<string, string> = {}): Record<string, string> {
  const r = spawnSync(
    'bash',
    [
      '-c',
      `. "${envScript}"; printf '%s\\n' "VITEST_MAX_WORKERS=\${VITEST_MAX_WORKERS-}" "E2E_WORKERS=\${E2E_WORKERS-}" "NODE_OPTIONS=\${NODE_OPTIONS-}"`,
    ],
    { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: home, ...env } },
  );
  expect(r.status).toBe(0);
  return Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

describe('runner-env.sh memory caps', () => {
  it('limits vitest to 2 workers and Playwright to 1', () => {
    const v = sourced();
    expect(v['VITEST_MAX_WORKERS']).toBe('2');
    expect(v['E2E_WORKERS']).toBe('1');
  });

  it('caps the Node heap so garbage collection runs well before the pod limit', () => {
    expect(sourced()['NODE_OPTIONS']).toBe('--max-old-space-size=1024');
  });

  it('keeps NODE_OPTIONS the caller already set and adds the cap once', () => {
    expect(sourced({ NODE_OPTIONS: '--no-warnings' })['NODE_OPTIONS']).toBe('--no-warnings --max-old-space-size=1024');
    expect(sourced({ NODE_OPTIONS: '--max-old-space-size=3072' })['NODE_OPTIONS']).toBe('--max-old-space-size=3072');
  });

  it('keeps a worker count the caller already set', () => {
    expect(sourced({ VITEST_MAX_WORKERS: '4', E2E_WORKERS: '3' })).toMatchObject({
      VITEST_MAX_WORKERS: '4',
      E2E_WORKERS: '3',
    });
  });

  it('is safe to source twice', () => {
    const r = spawnSync('bash', ['-c', `. "${envScript}"; . "${envScript}"; printf %s "$NODE_OPTIONS"`], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', HOME: home },
    });
    expect(r.stdout).toBe('--max-old-space-size=1024');
  });
});

const PackageJson = z.object({ scripts: z.record(z.string(), z.string()) });
const TurboJson = z.object({ globalPassThroughEnv: z.array(z.string()).optional() });
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'));

describe('root scripts and turbo', () => {
  it('every root turbo run that fans out across packages sets --concurrency', () => {
    const { scripts } = PackageJson.parse(readJson('package.json'));
    const unbounded = Object.entries(scripts)
      .filter(([, cmd]) => /turbo run (?!dev\b|build\b)/.test(cmd))
      .flatMap(([name, cmd]) =>
        cmd
          .split('&&')
          .map((part) => part.trim())
          .filter((part) => part.startsWith('turbo run') && !/--concurrency=\d+/.test(part))
          .map((part) => `${name}: ${part}`),
      );
    expect(unbounded).toEqual([]);
  });

  it('lets the caps through turbo to every task (strict env mode drops anything not listed)', () => {
    const { globalPassThroughEnv = [] } = TurboJson.parse(readJson('turbo.json'));
    expect(globalPassThroughEnv).toEqual(expect.arrayContaining(['NODE_OPTIONS', 'VITEST_MAX_WORKERS']));
  });
});

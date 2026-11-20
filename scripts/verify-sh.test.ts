import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// .agent/skills/dev-build/scripts/verify.sh runs lint, typecheck and tests for every touched package. A run pod has
// 2 GiB, and each of those commands is a node process of 0.5-1 GiB, so how many run at once is what keeps the pod alive.
// The tests drive the real script in a throwaway git repo with a stub `pnpm` that records how many run at the same time.
const verify = resolve(__dirname, '..', '.agent', 'skills', 'dev-build', 'scripts', 'verify.sh');
// 2 packages give 4 light commands (enough to tell a cap of 1, 2 or 3 apart) and keep a serial run near 2.4 s. With 4
// packages a CHECK_CONCURRENCY=1 run is 12 x 0.4 s = 4.8 s of fixed sleeping, right at the 5 s test timeout.
const PACKAGES = ['a', 'b'];

let dir: string;
let repo: string;
let bin: string;
let state: string;
let base: string;

const sh = (cwd: string, cmd: string): string =>
  spawnSync('bash', ['-c', cmd], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).stdout.trim();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-sh-'));
  repo = join(dir, 'repo');
  bin = join(dir, 'bin');
  state = join(dir, 'state');
  for (const d of [repo, bin, state]) mkdirSync(d);
  sh(
    repo,
    'git init -q -b main && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m base',
  );
  base = sh(repo, 'git rev-parse HEAD');
  for (const p of PACKAGES) {
    mkdirSync(join(repo, 'packages', p), { recursive: true });
    writeFileSync(join(repo, 'packages', p, 'index.ts'), `export const ${p} = 1;\n`);
  }
  sh(repo, 'git add -A && git commit -q -m change');
  // `pnpm` counts the commands running at this moment (its own marker included) and holds for a short while.
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub(
    'pnpm',
    `mkdir "$STUB_STATE/run.$$"; ls "$STUB_STATE" | grep -c '^run\\.' >> "$STUB_STATE/peaks"; sleep 0.4; rmdir "$STUB_STATE/run.$$"`,
  );
  stub('devbox', 'echo "fix: clean."');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A run pod exports CHECK_CONCURRENCY (scripts/runner-env.sh); drop it so the tests do not depend on the caller's env.
const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const inherited = { ...process.env };
  delete inherited['CHECK_CONCURRENCY'];
  delete inherited['VERIFY_MAX_PARALLEL'];
  return {
    ...inherited,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_STATE: state,
    VERIFY_LOCK_DIR: join(dir, 'lock'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...extra,
  };
};

const peak = (): number =>
  Math.max(0, ...readFileSync(join(state, 'peaks'), 'utf8').split('\n').filter(Boolean).map(Number));

/** Starts verify.sh and resolves with its exit code once it ends. */
const runVerify = (extra: NodeJS.ProcessEnv = {}): Promise<number | null> =>
  new Promise((done) => {
    const child = spawn('bash', [verify, repo, base], { env: env(extra), stdio: 'ignore' });
    child.on('close', done);
  });

describe('verify.sh', () => {
  it('passes when every command passes', async () => {
    expect(await runVerify()).toBe(0);
  });

  it('runs at most 2 lint/typecheck commands at the same time, however many packages changed', async () => {
    expect(await runVerify()).toBe(0);
    // 2 packages x (lint + typecheck) = 4 light commands; run all at once they peak at 4.
    expect(peak()).toBeLessThanOrEqual(2);
    expect(peak()).toBe(2);
  });

  it('follows CHECK_CONCURRENCY: 1 runs the lint/typecheck commands one at a time', async () => {
    expect(await runVerify({ CHECK_CONCURRENCY: '1' })).toBe(0);
    expect(peak()).toBe(1);
  });

  it('VERIFY_MAX_PARALLEL wins over CHECK_CONCURRENCY', async () => {
    expect(await runVerify({ CHECK_CONCURRENCY: '1', VERIFY_MAX_PARALLEL: '3' })).toBe(0);
    expect(peak()).toBe(3);
  });

  it('two verify runs at once (units of a multi-unit run) take turns instead of piling up', async () => {
    const codes = await Promise.all([runVerify(), runVerify()]);
    expect(codes).toEqual([0, 0]);
    expect(peak()).toBeLessThanOrEqual(2);
    // The second run waits for the first to finish, so the two together take a while.
  }, 30_000);

  it('frees its turn when it ends, even if a command failed', async () => {
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 1\n');
    expect(await runVerify()).toBe(1);
    // The lock is gone: the next run starts at once instead of waiting for a dead holder.
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n');
    expect(await runVerify()).toBe(0);
  }, 30_000);

  it('takes over a turn whose holder is gone', async () => {
    mkdirSync(join(dir, 'lock'));
    writeFileSync(join(dir, 'lock', 'pid'), '999999\n');
    expect(await runVerify()).toBe(0);
  });
});

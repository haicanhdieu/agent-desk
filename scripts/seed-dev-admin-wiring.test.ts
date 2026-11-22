import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The local stack seeds admin@dev.local right after migrate (BR-28). The tests run copies of the real scripts in a
// temp root with stubbed pnpm, compose, pg_ctl, temporal and setsid, so nothing connects anywhere or writes .env into
// the checkout.
const repoScripts = resolve(__dirname);

let dir: string;
let root: string;
let bin: string;
let calls: string;

const stub = (name: string, body: string): void => {
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
};

const pnpmStub = (failing?: string): string =>
  `echo "$*" >> "${calls}"\n${failing ? `case "$*" in *${failing}*) exit 1;; esac\n` : ''}exit 0`;

const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync('bash', [join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(dir, 'home'), ...env },
  });

const lines = (): string[] => readFileSync(calls, 'utf8').trim().split('\n');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seed-dev-admin-'));
  root = join(dir, 'root');
  bin = join(dir, 'bin');
  calls = join(dir, 'calls.log');
  for (const d of [join(root, 'scripts'), join(root, 'apps', 'web'), bin, join(dir, 'home')]) {
    mkdirSync(d, { recursive: true });
  }
  for (const f of ['dev.sh', 'runner-stack.sh', 'runner-env.sh'])
    copyFileSync(join(repoScripts, f), join(root, 'scripts', f));
  writeFileSync(join(root, '.env'), '');
  writeFileSync(join(root, '.env.example'), '');
  writeFileSync(join(root, 'apps', 'web', 'package.json'), '{"scripts":{}}');
  writeFileSync(calls, '');
  stub('compose-stub', 'exit 0');
  stub('node', `exec ${process.execPath} "$@"`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('dev.sh up', () => {
  it('migrates, then seeds the dev admin, then starts turbo', () => {
    stub('pnpm', pnpmStub());
    const r = run('dev.sh', ['up'], { COMPOSE: join(bin, 'compose-stub'), DEV_WEB: '0' });
    expect(r.status).toBe(0);
    const l = lines();
    expect(l[0]).toBe('--filter @agentdesk/api migrate');
    expect(l[1]).toBe('--filter @agentdesk/api seed:dev-admin');
    expect(l[2]).toMatch(/^exec turbo run dev/);
  });

  it('stops when the seed fails and does not start turbo', () => {
    stub('pnpm', pnpmStub('seed:dev-admin'));
    const r = run('dev.sh', ['up'], { COMPOSE: join(bin, 'compose-stub'), DEV_WEB: '0' });
    expect(r.status).not.toBe(0);
    expect(lines().some((x) => x.includes('turbo'))).toBe(false);
  });
});

describe('runner-stack.sh up', () => {
  const stackEnv = (): Record<string, string> => {
    const pgbin = join(dir, 'pgbin');
    mkdirSync(pgbin);
    for (const n of ['pg_ctl', 'initdb']) {
      const f = join(pgbin, n);
      writeFileSync(f, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(f, 0o755);
    }
    const stack = join(dir, 'stack');
    mkdirSync(join(stack, 'pgdata'), { recursive: true });
    writeFileSync(join(stack, 'pgdata', 'PG_VERSION'), '16');
    stub('temporal', 'exit 0');
    stub('setsid', 'exec "$@"');
    return {
      RUNNER_STACK_APPS: '0',
      TEST_PG_BIN_DIR: pgbin,
      RUNNER_STACK_DIR: stack,
      // Keeps runner-env.sh from replacing the stubs with a real toolchain installed under the pod's $HOME.
      RUNNER_TOOLS_DIR: join(dir, 'no-tools'),
    };
  };

  it('seeds the dev admin right after migrate, also for a services-only start', () => {
    stub('pnpm', pnpmStub());
    const r = run('runner-stack.sh', ['up'], stackEnv());
    expect(r.status).toBe(0);
    expect(lines()).toEqual(['--filter @agentdesk/api migrate', '--filter @agentdesk/api seed:dev-admin']);
  });

  it('starts the api and worker without the pod BOT_NAME', () => {
    const seen = (app: string): string => join(dir, `bot-name-${app}`);
    stub(
      'pnpm',
      [
        'case "$*" in',
        `*"@agentdesk/api dev"*) echo "\${BOT_NAME-unset}" > "${seen('api')}";;`,
        `*"@agentdesk/worker dev"*) echo "\${BOT_NAME-unset}" > "${seen('worker')}";;`,
        'esac',
        'exit 0',
      ].join('\n'),
    );
    // api_ready only succeeds once both launched processes have recorded what they saw.
    stub('curl', `[ -f "${seen('api')}" ] && [ -f "${seen('worker')}" ]`);
    const r = run('runner-stack.sh', ['up'], { ...stackEnv(), RUNNER_STACK_APPS: '1', BOT_NAME: 'agent-desk-qa[bot]' });
    expect(r.status).toBe(0);
    expect(readFileSync(seen('api'), 'utf8').trim()).toBe('unset');
    expect(readFileSync(seen('worker'), 'utf8').trim()).toBe('unset');
  });

  it('fails with a clear message when the seed fails', () => {
    stub('pnpm', pnpmStub('seed:dev-admin'));
    const r = run('runner-stack.sh', ['up'], stackEnv());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('seed-dev-admin failed');
  });
});

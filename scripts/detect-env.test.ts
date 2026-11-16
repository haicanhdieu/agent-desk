import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// Drives scripts/detect-env.sh with a controlled PATH (stub devbox/docker) and HOME (stub runner tools).
const script = resolve(__dirname, 'detect-env.sh');

let dir: string;
let bin: string;
let sys: string;

// The system tools the script needs, linked into their own dir so a real docker/devbox/podman on the host (CI
// runners have docker) never leaks into PATH.
const SYSTEM_TOOLS = ['id', 'uname', 'cat', 'awk', 'df', 'sleep', 'sysctl'];
const which = (tool: string): string =>
  spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
const BASH = which('bash');

function linkSystemTools(): void {
  for (const tool of SYSTEM_TOOLS) {
    const found = which(tool);
    if (found !== '') symlinkSync(found, join(sys, tool));
  }
}

function stub(name: string, body = 'exit 0'): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

function run(env: Record<string, string> = {}, args: string[] = []): { status: number | null; out: string } {
  const r = spawnSync(BASH, [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${bin}:${sys}`, HOME: dir, ...env },
  });
  return { status: r.status, out: r.stdout };
}

function field(out: string, key: string): string | undefined {
  return out
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'detect-env-'));
  bin = join(dir, 'bin');
  sys = join(dir, 'sys');
  mkdirSync(bin);
  mkdirSync(sys);
  linkSystemTools();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detect-env.sh', () => {
  it('reports unknown and unit tests only when nothing is available', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(field(r.out, 'mode')).toBe('unknown');
    expect(field(r.out, 'docker_engine')).toBe('no');
    expect(field(r.out, 'tests')).toMatch(/^pnpm test:unit/);
  });

  it('reports human-devbox when devbox is on PATH', () => {
    stub('devbox');
    expect(field(run().out, 'mode')).toBe('human-devbox');
  });

  it('reports human-docker when only a container engine answers', () => {
    stub('docker');
    const r = run();
    expect(field(r.out, 'mode')).toBe('human-docker');
    expect(field(r.out, 'docker_engine')).toBe('yes');
  });

  it('does not count a docker CLI whose engine is unreachable', () => {
    stub('docker', 'exit 1');
    expect(field(run().out, 'docker_engine')).toBe('no');
  });

  it('reports runner-pod from the Job env even when devbox is present, and asks for setup without tools', () => {
    stub('devbox');
    const r = run({ AGENTDESK_TOKEN_FILE: '/var/run/agentdesk/token' });
    expect(field(r.out, 'mode')).toBe('runner-pod');
    expect(field(r.out, 'runner_signal')).toBe('yes');
    expect(field(r.out, 'tests')).toContain('RUNNER_SETUP_PROFILE=test');
  });

  it('sees installed runner tools and points at the local test commands', () => {
    const tools = join(dir, '.local/opt/runner-tools');
    for (const [sub, name] of [
      ['postgresql/bin', 'postgres'],
      ['temporal-cli', 'temporal'],
      ['temporal-test-server', 'temporal-test-server'],
    ] as const) {
      mkdirSync(join(tools, sub), { recursive: true });
      writeFileSync(join(tools, sub, name), '');
      chmodSync(join(tools, sub, name), 0o755);
    }
    const r = run({ AGENTDESK_GIT_HOST: 'example.test', TEST_PG_MODE: 'local' });
    expect(field(r.out, 'postgres_bin')).toBe('yes');
    expect(field(r.out, 'temporal_cli')).toBe('yes');
    expect(field(r.out, 'temporal_test_server')).toBe('yes');
    expect(field(r.out, 'env_sourced')).toBe('yes');
    expect(field(r.out, 'tests')).toContain('scripts/runner-stack.sh up');
  });

  it('prints one valid JSON object with --json', () => {
    stub('devbox');
    const r = run({}, ['--json']);
    expect(r.status).toBe(0);
    const parsed = z
      .object({ mode: z.string(), uid: z.number(), devbox: z.string(), tests: z.string() })
      .parse(JSON.parse(r.out));
    expect(parsed.mode).toBe('human-devbox');
    expect(parsed.devbox).toBe('yes');
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot, parseConfig } from '../src/config';

const base = {
  PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_APP_URL: 'x',
  DATABASE_OWNER_URL: 'x',
  DATABASE_ADMIN_URL: 'x',
  TEMPORAL_ADDRESS: 'x',
  TEMPORAL_NAMESPACE: 'default',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  RUNNER_IMAGE: 'r',
};

describe('FAKE_STATE_DIR (R21)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-root-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const api = join(root, 'apps', 'api');
  const worker = join(root, 'apps', 'worker');
  mkdirSync(api, { recursive: true });
  mkdirSync(worker, { recursive: true });

  it('a relative dir resolves against the workspace root, the same from api and worker', () => {
    const fromApi = parseConfig({ ...base, FAKE_STATE_DIR: '.agentdesk/fake' }, { cwd: api }).FAKE_STATE_DIR;
    const fromWorker = parseConfig(base, { cwd: worker }).FAKE_STATE_DIR; // default '.agentdesk/fake'
    expect(fromApi).toBe(join(resolve(root), '.agentdesk/fake'));
    expect(fromWorker).toBe(fromApi);
  });

  it('an absolute dir is kept; no workspace root → relative to cwd', () => {
    expect(parseConfig({ ...base, FAKE_STATE_DIR: '/tmp/x' }, { cwd: api }).FAKE_STATE_DIR).toBe('/tmp/x');
    const lone = mkdtempSync(join(tmpdir(), 'no-ws-'));
    expect(findWorkspaceRoot(lone)).toBeNull();
    expect(parseConfig({ ...base, FAKE_STATE_DIR: 'state' }, { cwd: lone }).FAKE_STATE_DIR).toBe(join(lone, 'state'));
  });

  it('finds this repository root from the package dir', () => {
    expect(findWorkspaceRoot(process.cwd())).toBe(resolve(process.cwd(), '../..'));
  });
});

describe('production refuses dev-only settings', () => {
  it('rejects KUBE_MODE=fake (explicit or defaulted) in production', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', KUBE_MODE: 'fake' })).toThrow(/KUBE_MODE/);
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(/KUBE_MODE/);
  });

  it('accepts a real KUBE_MODE in production and keeps the fake default in development', () => {
    expect(parseConfig({ ...base, NODE_ENV: 'production', KUBE_MODE: 'incluster' }).KUBE_MODE).toBe('incluster');
    expect(parseConfig(base).KUBE_MODE).toBe('fake');
  });
});

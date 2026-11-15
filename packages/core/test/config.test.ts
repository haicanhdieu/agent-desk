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

describe('plugin and setup config', () => {
  it('defaults', () => {
    const c = parseConfig(base);
    expect(c.RUN_PLUGIN_MARKETPLACES).toEqual({
      'claude-plugins-official': 'anthropics/claude-plugins-official',
      'anthropic-plugin-directory': 'builtin',
    });
    expect(c.RUN_SETUP_TIMEOUT_SECONDS).toBe(600);
    expect(c.SETUP_TEST_TTL_SECONDS).toBe(900);
    expect(c.RUN_VOLUME_STORAGE_CLASS).toBeUndefined();
    expect(c.RUN_KEPT_DONE_SESSIONS_PER_PROJECT).toBe(10);
    expect(c.RUN_IDLE_END_SECONDS).toBe(600);
  });
  it('RUN_IDLE_END_SECONDS is a test seam: blank is the default, below 1 is refused', () => {
    expect(parseConfig({ ...base, RUN_IDLE_END_SECONDS: '5' }).RUN_IDLE_END_SECONDS).toBe(5);
    expect(parseConfig({ ...base, RUN_IDLE_END_SECONDS: '' }).RUN_IDLE_END_SECONDS).toBe(600);
    expect(() => parseConfig({ ...base, RUN_IDLE_END_SECONDS: '0' })).toThrow('RUN_IDLE_END_SECONDS');
  });
  it('parses volume settings; blank storage class is unset, zero kept sessions is allowed', () => {
    expect(parseConfig({ ...base, RUN_VOLUME_STORAGE_CLASS: 'agentdesk-run-volumes' }).RUN_VOLUME_STORAGE_CLASS).toBe(
      'agentdesk-run-volumes',
    );
    expect(parseConfig({ ...base, RUN_VOLUME_STORAGE_CLASS: '' }).RUN_VOLUME_STORAGE_CLASS).toBeUndefined();
    expect(parseConfig({ ...base, RUN_KEPT_DONE_SESSIONS_PER_PROJECT: '0' }).RUN_KEPT_DONE_SESSIONS_PER_PROJECT).toBe(
      0,
    );
    expect(() => parseConfig({ ...base, RUN_KEPT_DONE_SESSIONS_PER_PROJECT: '-1' })).toThrow(
      'RUN_KEPT_DONE_SESSIONS_PER_PROJECT',
    );
  });
  it('parses overrides and blank falls back to defaults', () => {
    const c = parseConfig({
      ...base,
      RUN_PLUGIN_MARKETPLACES: '{"a":"o/r"}',
      RUN_SETUP_TIMEOUT_SECONDS: '30',
      SETUP_TEST_TTL_SECONDS: '',
    });
    expect(c.RUN_PLUGIN_MARKETPLACES).toEqual({ a: 'o/r' });
    expect(c.RUN_SETUP_TIMEOUT_SECONDS).toBe(30);
    expect(c.SETUP_TEST_TTL_SECONDS).toBe(900);
  });
  it.each(['[]', '"x"', '{"a":1}', 'nope'])('rejects RUN_PLUGIN_MARKETPLACES=%s', (v) => {
    expect(() => parseConfig({ ...base, RUN_PLUGIN_MARKETPLACES: v })).toThrow(/RUN_PLUGIN_MARKETPLACES/);
  });
  it.each([
    ['RUN_SETUP_TIMEOUT_SECONDS', '0'],
    ['RUN_SETUP_TIMEOUT_SECONDS', '3301'],
    ['SETUP_TEST_TTL_SECONDS', '59'],
    ['SETUP_TEST_TTL_SECONDS', '3601'],
  ])('rejects %s=%s', (k, v) => {
    expect(() => parseConfig({ ...base, [k]: v })).toThrow(k);
  });
});

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
    const prod = { ...base, NODE_ENV: 'production', KUBE_MODE: 'incluster', RUN_VOLUME_STORAGE_CLASS: 'delete-class' };
    expect(parseConfig(prod).KUBE_MODE).toBe('incluster');
    expect(parseConfig(base).KUBE_MODE).toBe('fake');
  });

  describe('RUN_VOLUME_STORAGE_CLASS', () => {
    const prod = { ...base, NODE_ENV: 'production', KUBE_MODE: 'incluster' };

    it('is required in production, so run volumes never land on a retaining cluster default', () => {
      expect(() => parseConfig(prod)).toThrow(/RUN_VOLUME_STORAGE_CLASS/);
      expect(() => parseConfig({ ...prod, RUN_VOLUME_STORAGE_CLASS: '' })).toThrow(/RUN_VOLUME_STORAGE_CLASS/);
      expect(() => parseConfig({ ...prod, RUN_VOLUME_STORAGE_CLASS: '  ' })).toThrow(/RUN_VOLUME_STORAGE_CLASS/);
    });

    it('accepts a named class in production', () => {
      expect(parseConfig({ ...prod, RUN_VOLUME_STORAGE_CLASS: 'delete-class' }).RUN_VOLUME_STORAGE_CLASS).toBe(
        'delete-class',
      );
    });

    it('stays optional in development and test', () => {
      expect(parseConfig(base).RUN_VOLUME_STORAGE_CLASS).toBeUndefined();
      expect(parseConfig({ ...base, NODE_ENV: 'test' }).RUN_VOLUME_STORAGE_CLASS).toBeUndefined();
    });
  });
});

describe('BOT_NAME', () => {
  const github = {
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'agent-desk-devlocal',
    GITHUB_PRIVATE_KEY: 'pem',
    GITHUB_WEBHOOK_SECRET: 'w',
    GITHUB_CLIENT_ID: 'c',
    GITHUB_CLIENT_SECRET: 's',
  };

  it('defaults to the app login <slug>[bot] so the desk recognises its own comments', () => {
    expect(parseConfig({ ...base, ...github }).BOT_NAME).toBe('agent-desk-devlocal[bot]');
    expect(parseConfig({ ...base, ...github, BOT_NAME: '' }).BOT_NAME).toBe('agent-desk-devlocal[bot]');
  });

  it('an explicit BOT_NAME wins over the slug', () => {
    expect(parseConfig({ ...base, ...github, BOT_NAME: 'custom[bot]' }).BOT_NAME).toBe('custom[bot]');
  });

  it('keeps the generic default when no GitHub app is configured', () => {
    expect(parseConfig(base).BOT_NAME).toBe('agentdesk[bot]');
  });
});

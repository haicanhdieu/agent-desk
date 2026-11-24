import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    expect(c.RUN_VOLUME_STORAGE_CLASS).toBeUndefined();
    expect(c.RUN_KEPT_DONE_SESSIONS_PER_PROJECT).toBe(10);
    expect(c.RUN_IDLE_END_SECONDS).toBe(1800);
    expect(c.RUN_ENDING_DEADLINE_SECONDS).toBe(90);
  });

  it('the run pod defaults to 2 GiB (QA runs 2 GiB pods; the runner caps in scripts/runner-env.sh are sized for it)', () => {
    const c = parseConfig(base);
    expect(c.RUN_POD_MEMORY_REQUEST).toBe('1Gi');
    expect(c.RUN_POD_MEMORY_LIMIT).toBe('2Gi');
  });
  it('RUN_ENDING_DEADLINE_SECONDS is a test seam: blank is the default, below 1 is refused', () => {
    expect(parseConfig({ ...base, RUN_ENDING_DEADLINE_SECONDS: '5' }).RUN_ENDING_DEADLINE_SECONDS).toBe(5);
    expect(parseConfig({ ...base, RUN_ENDING_DEADLINE_SECONDS: '' }).RUN_ENDING_DEADLINE_SECONDS).toBe(90);
    expect(() => parseConfig({ ...base, RUN_ENDING_DEADLINE_SECONDS: '0' })).toThrow('RUN_ENDING_DEADLINE_SECONDS');
  });
  it('RUN_RECONNECT_WINDOW_SECONDS: default 1800, blank is the default, below 1 is refused', () => {
    expect(parseConfig(base).RUN_RECONNECT_WINDOW_SECONDS).toBe(1800);
    expect(parseConfig({ ...base, RUN_RECONNECT_WINDOW_SECONDS: '5' }).RUN_RECONNECT_WINDOW_SECONDS).toBe(5);
    expect(parseConfig({ ...base, RUN_RECONNECT_WINDOW_SECONDS: '' }).RUN_RECONNECT_WINDOW_SECONDS).toBe(1800);
    expect(() => parseConfig({ ...base, RUN_RECONNECT_WINDOW_SECONDS: '0' })).toThrow('RUN_RECONNECT_WINDOW_SECONDS');
  });
  it('the terminal lease settings are test seams: blank is the default, below the minimum is refused', () => {
    const c = parseConfig(base);
    expect(c.RUN_LEASE_TTL_SECONDS).toBe(300);
    expect(c.TERMINAL_LEASE_INTERVAL_MS).toBe(120_000);
    expect(parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '5', TERMINAL_LEASE_INTERVAL_MS: '50' })).toMatchObject({
      RUN_LEASE_TTL_SECONDS: 5,
      TERMINAL_LEASE_INTERVAL_MS: 50,
    });
    expect(parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '', TERMINAL_LEASE_INTERVAL_MS: '' })).toMatchObject({
      RUN_LEASE_TTL_SECONDS: 300,
      TERMINAL_LEASE_INTERVAL_MS: 120_000,
    });
    expect(() => parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '0' })).toThrow('RUN_LEASE_TTL_SECONDS');
    expect(() => parseConfig({ ...base, TERMINAL_LEASE_INTERVAL_MS: '1' })).toThrow('TERMINAL_LEASE_INTERVAL_MS');
  });
  it('TERMINAL_LEASE_INTERVAL_MS is capped at what a timer can hold (2^31-1 ms)', () => {
    expect(
      parseConfig({ ...base, TERMINAL_LEASE_INTERVAL_MS: '2147483647', RUN_LEASE_TTL_SECONDS: '9999999' }),
    ).toMatchObject({
      TERMINAL_LEASE_INTERVAL_MS: 2147483647,
    });
    expect(() => parseConfig({ ...base, TERMINAL_LEASE_INTERVAL_MS: '2147483648' })).toThrow(
      'TERMINAL_LEASE_INTERVAL_MS',
    );
  });
  it('the lease interval must leave room for a missed tick: at most half of RUN_LEASE_TTL_SECONDS', () => {
    expect(
      parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '10', TERMINAL_LEASE_INTERVAL_MS: '5000' })
        .TERMINAL_LEASE_INTERVAL_MS,
    ).toBe(5000);
    expect(() => parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '10', TERMINAL_LEASE_INTERVAL_MS: '5001' })).toThrow(
      'TERMINAL_LEASE_INTERVAL_MS',
    );
    // The default interval (120 s) does not fit a short lease time set alone.
    expect(() => parseConfig({ ...base, RUN_LEASE_TTL_SECONDS: '60' })).toThrow('TERMINAL_LEASE_INTERVAL_MS');
  });
  it('PROJECT_ENV_MAX_ENTRIES defaults to 500, takes a set value, and blank is the default', () => {
    expect(parseConfig(base).PROJECT_ENV_MAX_ENTRIES).toBe(500);
    expect(parseConfig({ ...base, PROJECT_ENV_MAX_ENTRIES: '20' }).PROJECT_ENV_MAX_ENTRIES).toBe(20);
    expect(parseConfig({ ...base, PROJECT_ENV_MAX_ENTRIES: '' }).PROJECT_ENV_MAX_ENTRIES).toBe(500);
  });
  it.each(['0', '-1', '1.5', 'abc'])('PROJECT_ENV_MAX_ENTRIES %j is refused', (v) => {
    expect(() => parseConfig({ ...base, PROJECT_ENV_MAX_ENTRIES: v })).toThrow('PROJECT_ENV_MAX_ENTRIES');
  });
  it('HOST defaults to all interfaces, can be narrowed, and blank falls back to the default', () => {
    expect(parseConfig(base).HOST).toBe('0.0.0.0');
    expect(parseConfig({ ...base, HOST: '127.0.0.1' }).HOST).toBe('127.0.0.1');
    expect(parseConfig({ ...base, HOST: '' }).HOST).toBe('0.0.0.0');
  });
  it('RUN_IDLE_END_SECONDS is a test seam: blank is the default, below 1 is refused', () => {
    expect(parseConfig({ ...base, RUN_IDLE_END_SECONDS: '5' }).RUN_IDLE_END_SECONDS).toBe(5);
    expect(parseConfig({ ...base, RUN_IDLE_END_SECONDS: '' }).RUN_IDLE_END_SECONDS).toBe(1800);
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
    });
    expect(c.RUN_PLUGIN_MARKETPLACES).toEqual({ a: 'o/r' });
    expect(c.RUN_SETUP_TIMEOUT_SECONDS).toBe(30);
  });
  it.each(['[]', '"x"', '{"a":1}', 'nope'])('rejects RUN_PLUGIN_MARKETPLACES=%s', (v) => {
    expect(() => parseConfig({ ...base, RUN_PLUGIN_MARKETPLACES: v })).toThrow(/RUN_PLUGIN_MARKETPLACES/);
  });
  it.each([
    ['RUN_SETUP_TIMEOUT_SECONDS', '0'],
    ['RUN_SETUP_TIMEOUT_SECONDS', '3301'],
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

describe('AGENT_MODELS_SOURCE', () => {
  it('defaults to live, treats blank as the default and accepts builtin', () => {
    expect(parseConfig(base).AGENT_MODELS_SOURCE).toBe('live');
    expect(parseConfig({ ...base, AGENT_MODELS_SOURCE: '' }).AGENT_MODELS_SOURCE).toBe('live');
    expect(parseConfig({ ...base, AGENT_MODELS_SOURCE: 'builtin' }).AGENT_MODELS_SOURCE).toBe('builtin');
  });

  it('rejects any other value', () => {
    expect(() => parseConfig({ ...base, AGENT_MODELS_SOURCE: 'other' })).toThrow();
  });
});

describe('PLATFORM_ADMIN_EMAILS', () => {
  it('drops a leftover PLATFORM_ADMIN_EMAILS', () => {
    expect('PLATFORM_ADMIN_EMAILS' in parseConfig({ ...base, PLATFORM_ADMIN_EMAILS: 'a@x.io' })).toBe(false);
  });
});

describe('MODEL_PRICES_SOURCE', () => {
  it('defaults to litellm, treats blank as the default and accepts fake and off', () => {
    expect(parseConfig(base).MODEL_PRICES_SOURCE).toBe('litellm');
    expect(parseConfig({ ...base, MODEL_PRICES_SOURCE: '' }).MODEL_PRICES_SOURCE).toBe('litellm');
    expect(parseConfig({ ...base, MODEL_PRICES_SOURCE: 'fake' }).MODEL_PRICES_SOURCE).toBe('fake');
    expect(parseConfig({ ...base, MODEL_PRICES_SOURCE: 'off' }).MODEL_PRICES_SOURCE).toBe('off');
  });

  it('rejects any other value', () => {
    expect(() => parseConfig({ ...base, MODEL_PRICES_SOURCE: 'other' })).toThrow();
  });

  it('rejects fake in production', () => {
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: 'production',
        KUBE_MODE: 'incluster',
        RUN_VOLUME_STORAGE_CLASS: 'sc',
        MODEL_PRICES_SOURCE: 'fake',
      }),
    ).toThrow(/MODEL_PRICES_SOURCE/);
  });
});

describe('MODEL_PRICES_URL', () => {
  it('is undefined when unset or blank', () => {
    expect(parseConfig(base).MODEL_PRICES_URL).toBeUndefined();
    expect(parseConfig({ ...base, MODEL_PRICES_URL: '' }).MODEL_PRICES_URL).toBeUndefined();
  });

  it('accepts an https url', () => {
    expect(parseConfig({ ...base, MODEL_PRICES_URL: 'https://prices.example/x.json' }).MODEL_PRICES_URL).toBe(
      'https://prices.example/x.json',
    );
  });

  it.each([
    'http://prices.example/x.json',
    'file:///etc/passwd',
    'ftp://prices.example/x.json',
    'https://u:p@h/x',
    'https://h/x#f',
    `https://h/${'a'.repeat(2049)}`,
    'not a url',
  ])('rejects %s', (value) => {
    expect(() => parseConfig({ ...base, MODEL_PRICES_URL: value })).toThrow(/MODEL_PRICES_URL/);
  });
});

describe('.env.example price keys', () => {
  it('lists fake prices and an empty url line', () => {
    const text = readFileSync(resolve(__dirname, '../../../.env.example'), 'utf8');
    expect(text).toMatch(/^MODEL_PRICES_SOURCE=fake$/m);
    expect(text).toMatch(/^MODEL_PRICES_URL=$/m);
  });
});

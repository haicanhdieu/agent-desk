import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEV_ADMIN_EMAIL, devAdminSeedEnabled, isLocalDatabaseUrl, runDevAdminSeed } from '../src/seed-dev-admin';
import { validEnv } from './helpers/app';

describe('dev platform admin seed gate', () => {
  it('is enabled only when dev login is on', () => {
    expect(devAdminSeedEnabled({ AUTH_DEV_LOGIN: true })).toBe(true);
    expect(devAdminSeedEnabled({ AUTH_DEV_LOGIN: false })).toBe(false);
  });

  it('skips and never calls seed when dev login is off', async () => {
    const seed = vi.fn(async () => undefined);
    await expect(runDevAdminSeed(validEnv({ AUTH_DEV_LOGIN: 'false' }), seed)).resolves.toBe('skipped');
    expect(seed).not.toHaveBeenCalled();
  });

  it('seeds admin@dev.local once through the app database url when dev login is on', async () => {
    const seed = vi.fn(async () => undefined);
    const env = validEnv({ AUTH_DEV_LOGIN: 'true' });
    await expect(runDevAdminSeed(env, seed)).resolves.toBe('seeded');
    expect(DEV_ADMIN_EMAIL).toBe('admin@dev.local');
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(env.DATABASE_APP_URL, 'admin@dev.local');
  });

  it('rejects and never calls seed when production has dev login on', async () => {
    const seed = vi.fn(async () => undefined);
    const env = validEnv({
      NODE_ENV: 'production',
      AUTH_DEV_LOGIN: 'true',
      KUBE_MODE: 'incluster',
      ENABLE_FAKE_PROVIDER: 'false',
      RUN_VOLUME_STORAGE_CLASS: 'standard',
    });
    await expect(runDevAdminSeed(env, seed)).rejects.toThrow(/AUTH_DEV_LOGIN/);
    expect(seed).not.toHaveBeenCalled();
  });
});

describe('dev platform admin seed local-database guard', () => {
  it('skips and never calls seed for a remote database', async () => {
    const seed = vi.fn(async () => undefined);
    const env = validEnv({
      AUTH_DEV_LOGIN: 'true',
      DATABASE_APP_URL: 'postgres://app:s3cretpw@db.shared.example.com:5432/agentdesk',
    });
    await expect(runDevAdminSeed(env, seed)).resolves.toBe('skipped-remote');
    expect(seed).not.toHaveBeenCalled();
  });

  it.each([
    ['localhost', 'postgres://app:pw@localhost:54329/agentdesk'],
    ['127.0.0.1', 'postgres://app:pw@127.0.0.1:54329/agentdesk'],
    ['[::1]', 'postgres://app:pw@[::1]:54329/agentdesk'],
  ])('seeds when the database host is %s', async (_name, url) => {
    const seed = vi.fn(async () => undefined);
    await expect(runDevAdminSeed(validEnv({ AUTH_DEV_LOGIN: 'true', DATABASE_APP_URL: url }), seed)).resolves.toBe(
      'seeded',
    );
    expect(seed).toHaveBeenCalledWith(url, 'admin@dev.local');
  });

  it('treats an unparseable or look-alike database url as not local', () => {
    expect(isLocalDatabaseUrl('not a url with pw:secret')).toBe(false);
    expect(isLocalDatabaseUrl('postgres://app@localhost.evil.com/x')).toBe(false);
  });

  it.each([
    ['a host query parameter', 'postgres://app:pw@localhost/d?host=evil.com'],
    ['an empty authority with a host parameter', 'postgres:///d?host=evil.com'],
    ['an empty authority (PGHOST fallback)', 'postgres:///d'],
    ['a multi-host list', 'postgres://localhost,evil.com/d'],
    ['a userinfo trick', 'postgres://localhost@evil.com/db'],
    ['a hostaddr query parameter', 'postgres://app@localhost/d?hostaddr=10.0.0.1'],
  ])('treats %s as not local', (_name, url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });

  it('treats an uppercase loopback host as local', () => {
    expect(isLocalDatabaseUrl('postgres://app:pw@LOCALHOST:54329/d')).toBe(true);
  });
});

describe('dev platform admin seed entrypoint', () => {
  const entry = resolve(__dirname, '../src/seed-dev-admin.ts');
  const tsx = resolve(__dirname, '../node_modules/.bin/tsx');

  it.each([
    ['its real path', false],
    ['a symlinked path', true],
  ])(
    'runs main() when started through %s',
    (_name, symlinked) => {
      const dir = mkdtempSync(join(tmpdir(), 'seed-entry-'));
      try {
        let path = entry;
        if (symlinked) {
          path = join(dir, 'seed-link.ts');
          symlinkSync(entry, path);
        }
        const res = spawnSync(tsx, [path], {
          encoding: 'utf8',
          env: { PATH: process.env['PATH'] ?? '', ...validEnv({ AUTH_DEV_LOGIN: 'false' }) },
        });
        expect(res.stdout).toContain('seed-dev-admin: skipped (dev login is off)');
        expect(res.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEV_ADMIN_EMAIL, devAdminSeedEnabled, runDevAdminSeed } from '../src/seed-dev-admin';
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

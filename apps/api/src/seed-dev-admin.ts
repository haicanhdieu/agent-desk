import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createDb, seedPlatformAdmin } from '@agentdesk/db';
import { parseConfig, type Config } from './config/config.schema';

export const DEV_ADMIN_EMAIL = 'admin@dev.local';

/** The seed runs only where dev login is on; parseConfig already refuses dev login in production. */
export function devAdminSeedEnabled(config: Pick<Config, 'AUTH_DEV_LOGIN'>): boolean {
  return config.AUTH_DEV_LOGIN;
}

/** True only for a loopback database host; an unparseable url is not local. Never logs the url (it carries credentials). */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // pg lets a host/hostaddr query parameter override the authority, and an empty authority falls back to PGHOST; fail closed on both.
    if (u.searchParams.has('host') || u.searchParams.has('hostaddr')) return false;
    // new URL keeps the case of a non-special scheme's host, so compare lowercased.
    const host = u.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** Parses env with parseConfig; returns 'skipped' (dev login off) or 'skipped-remote' (database not loopback) without calling seed, else seeds DEV_ADMIN_EMAIL once. */
export async function runDevAdminSeed(
  env: Record<string, string | undefined>,
  seed: (databaseAppUrl: string, email: string) => Promise<void>,
): Promise<'skipped' | 'skipped-remote' | 'seeded'> {
  const config = parseConfig(env);
  if (!devAdminSeedEnabled(config)) return 'skipped';
  if (!isLocalDatabaseUrl(config.DATABASE_APP_URL)) return 'skipped-remote';
  await seed(config.DATABASE_APP_URL, DEV_ADMIN_EMAIL);
  return 'seeded';
}

async function seedWithAppDb(databaseAppUrl: string, email: string): Promise<void> {
  const db = createDb(databaseAppUrl);
  try {
    await seedPlatformAdmin(db, email);
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const result = await runDevAdminSeed(process.env, seedWithAppDb);
  const lines = {
    skipped: 'seed-dev-admin: skipped (dev login is off)',
    'skipped-remote': 'seed-dev-admin: skipped (database is not local)',
    seeded: 'seed-dev-admin: done',
  };
  console.log(lines[result]);
}

// Only the process entry runs main() (argv[1] is realpath'd to match import.meta.url under symlinks); tests import runDevAdminSeed without connecting anywhere.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error('seed-dev-admin: failed', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

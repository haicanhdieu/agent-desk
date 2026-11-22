import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createDb, seedPlatformAdmin } from '@agentdesk/db';
import { parseConfig, type Config } from './config/config.schema';

export const DEV_ADMIN_EMAIL = 'admin@dev.local';

/** The seed runs only where dev login is on; parseConfig already refuses dev login in production. */
export function devAdminSeedEnabled(config: Pick<Config, 'AUTH_DEV_LOGIN'>): boolean {
  return config.AUTH_DEV_LOGIN;
}

/** Parses env with parseConfig; when the gate is off returns 'skipped' without calling seed, else seeds DEV_ADMIN_EMAIL once. */
export async function runDevAdminSeed(
  env: Record<string, string | undefined>,
  seed: (databaseAppUrl: string, email: string) => Promise<void>,
): Promise<'skipped' | 'seeded'> {
  const config = parseConfig(env);
  if (!devAdminSeedEnabled(config)) return 'skipped';
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
  console.log(result === 'skipped' ? 'seed-dev-admin: skipped (dev login is off)' : 'seed-dev-admin: done');
}

// Only the process entry runs main() (argv[1] is realpath'd to match import.meta.url under symlinks); tests import runDevAdminSeed without connecting anywhere.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error('seed-dev-admin: failed', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

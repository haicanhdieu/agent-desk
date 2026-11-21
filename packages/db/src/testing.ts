import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { bootstrapDatabase } from './bootstrap';
import { startLocalPg } from './local-pg';
import { runMigrations } from './migrate';
import { readTestPgConfig } from './test-pg-config';

export const TEST_PASSWORDS = { owner: 'owner-pw', app: 'app-pw', temporal: 'temporal-pw' } as const;

export function urlFor(adminUrl: string, user: string, password: string, database: string): string {
  const u = new URL(adminUrl);
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

export interface TestPg {
  adminUrl: string;
  ownerUrl: string;
  appUrl: string;
  stop: () => Promise<void>;
}

async function startServer(): Promise<{ adminUrl: string; stop: () => Promise<void> }> {
  const config = readTestPgConfig();
  if (config.mode === 'local') return startLocalPg(config);
  const container = await new PostgreSqlContainer('postgres:18').start();
  return { adminUrl: container.getConnectionUri(), stop: async () => void (await container.stop()) };
}

/**
 * A fresh, migrated Postgres for one test file. TEST_PG_MODE picks the server (test-pg-config.ts): a
 * Testcontainers `postgres:18` by default, or local binaries (one server per call) where there is no container
 * engine. Either way the roles, passwords and migrations are the same, and appUrl connects as agentdesk_app (RLS).
 */
export async function startPg(): Promise<TestPg> {
  return start(async (ownerUrl) => runMigrations(ownerUrl));
}

async function start(migrateInitial: (ownerUrl: string) => Promise<void>): Promise<TestPg> {
  const server = await startServer();
  try {
    await bootstrapDatabase(server.adminUrl, TEST_PASSWORDS);
    const ownerUrl = urlFor(server.adminUrl, 'agentdesk_owner', TEST_PASSWORDS.owner, 'agentdesk');
    const appUrl = urlFor(server.adminUrl, 'agentdesk_app', TEST_PASSWORDS.app, 'agentdesk');
    await migrateInitial(ownerUrl);
    return { adminUrl: server.adminUrl, ownerUrl, appUrl, stop: server.stop };
  } catch (e) {
    await server.stop();
    throw e;
  }
}

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

interface JournalEntry {
  tag: string;
}

/**
 * A fresh Postgres migrated up to and including `tag` (e.g. '0021_agent_auto_resume_max'), using a temp copy of
 * migrations/ with a trimmed meta/_journal.json; `migrateRest()` then applies the remaining migrations. Used to
 * test an upgrade: seed rows at the old schema, then migrate forward.
 */
export async function startPgAt(tag: string): Promise<TestPg & { migrateRest: () => Promise<void> }> {
  const pgEnv = await start(async (ownerUrl) => {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: JournalEntry[] };
    const last = journal.entries.findIndex((e) => e.tag === tag);
    if (last < 0) throw new Error(`startPgAt: no migration tagged ${tag}`);
    const entries = journal.entries.slice(0, last + 1);
    const tmp = await mkdtemp(path.join(tmpdir(), 'agentdesk-migrations-'));
    try {
      await mkdir(path.join(tmp, 'meta'));
      for (const e of entries) await cp(path.join(migrationsFolder, `${e.tag}.sql`), path.join(tmp, `${e.tag}.sql`));
      await writeFile(path.join(tmp, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
      const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
      try {
        await migrate(drizzle(pool), { migrationsFolder: tmp });
      } finally {
        await pool.end();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
  return { ...pgEnv, migrateRest: () => runMigrations(pgEnv.ownerUrl) };
}

import { PostgreSqlContainer } from '@testcontainers/postgresql';
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
  const server = await startServer();
  try {
    await bootstrapDatabase(server.adminUrl, TEST_PASSWORDS);
    const ownerUrl = urlFor(server.adminUrl, 'agentdesk_owner', TEST_PASSWORDS.owner, 'agentdesk');
    const appUrl = urlFor(server.adminUrl, 'agentdesk_app', TEST_PASSWORDS.app, 'agentdesk');
    await runMigrations(ownerUrl);
    return { adminUrl: server.adminUrl, ownerUrl, appUrl, stop: server.stop };
  } catch (e) {
    await server.stop();
    throw e;
  }
}

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { bootstrapDatabase } from '../../src/bootstrap';
import { runMigrations } from '../../src/migrate';

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

export async function startPg(): Promise<TestPg> {
  const container = await new PostgreSqlContainer('postgres:18').start();
  const adminUrl = container.getConnectionUri();
  await bootstrapDatabase(adminUrl, TEST_PASSWORDS);
  const ownerUrl = urlFor(adminUrl, 'agentdesk_owner', TEST_PASSWORDS.owner, 'agentdesk');
  const appUrl = urlFor(adminUrl, 'agentdesk_app', TEST_PASSWORDS.app, 'agentdesk');
  await runMigrations(ownerUrl);
  return { adminUrl, ownerUrl, appUrl, stop: async () => void (await container.stop()) };
}

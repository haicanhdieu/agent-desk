import { bootstrapDatabase, runMigrations } from '@agentdesk/db';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  const adminUrl = required('DATABASE_ADMIN_URL');
  const passwords = {
    owner: required('AGENTDESK_OWNER_PASSWORD'),
    app: required('AGENTDESK_APP_PASSWORD'),
    temporal: required('TEMPORAL_PASSWORD'),
  };
  await bootstrapDatabase(adminUrl, passwords);

  const ownerUrl = new URL(adminUrl);
  ownerUrl.username = 'agentdesk_owner';
  ownerUrl.password = passwords.owner;
  ownerUrl.pathname = '/agentdesk';
  await runMigrations(ownerUrl.toString());
  console.log('migrate: done');
}

main().catch((err: unknown) => {
  console.error('migrate: failed', err instanceof Error ? err.message : err);
  process.exit(1);
});

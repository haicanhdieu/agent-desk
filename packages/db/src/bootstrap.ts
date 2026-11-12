import pg from 'pg';

export interface BootstrapPasswords {
  owner: string;
  app: string;
  temporal: string;
}

const ROLES = [
  { name: 'agentdesk_owner', key: 'owner' },
  { name: 'agentdesk_app', key: 'app' },
  { name: 'temporal', key: 'temporal' },
] as const;

const DATABASES = [
  { name: 'agentdesk', owner: 'agentdesk_owner' },
  { name: 'temporal', owner: 'temporal' },
  { name: 'temporal_visibility', owner: 'temporal' },
] as const;

/** Run `fn` on a short-lived client connected to `url`. */
async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Idempotently creates the roles and databases, then applies connect/schema grants.
 * Role and database names are fixed constants (never caller input); passwords are quoted as literals.
 * Passwords are re-applied on every run so rotating a secret and re-running the migrate hook works.
 */
export async function bootstrapDatabase(adminUrl: string, passwords: BootstrapPasswords): Promise<void> {
  await withClient(adminUrl, async (c) => {
    for (const role of ROLES) {
      const pw = c.escapeLiteral(passwords[role.key]);
      const exists = await c.query('select 1 from pg_roles where rolname = $1', [role.name]);
      const attrs = role.name === 'agentdesk_app' ? 'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE' : 'NOSUPERUSER';
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await c.query(`${verb} ROLE ${role.name} LOGIN ${attrs} PASSWORD ${pw}`);
    }
    for (const db of DATABASES) {
      const exists = await c.query('select 1 from pg_database where datname = $1', [db.name]);
      if (!exists.rowCount) await c.query(`CREATE DATABASE ${db.name} OWNER ${db.owner}`);
    }
    await c.query('REVOKE ALL ON DATABASE agentdesk FROM PUBLIC');
    await c.query('GRANT CONNECT ON DATABASE agentdesk TO agentdesk_app');
  });

  const agentdeskUrl = new URL(adminUrl);
  agentdeskUrl.pathname = '/agentdesk';
  await withClient(agentdeskUrl.toString(), async (c) => {
    await c.query('GRANT USAGE ON SCHEMA public TO agentdesk_app');
  });
}

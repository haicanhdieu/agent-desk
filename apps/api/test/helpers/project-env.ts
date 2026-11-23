import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { roles, rolePermissions, withOrg } from '@agentdesk/db';
import type { TestApp } from './app';
import { acceptInvite, asPlatformAdmin, loginAs } from './auth';

/** Inserts a non-built-in role of the org holding exactly `permissions` (all `any`), through `withOrg`; returns its id. */
export async function customRole(t: TestApp, orgId: string, permissions: string[]): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({
        orgId,
        key: `custom-${randomUUID().slice(0, 8)}`,
        name: 'Custom',
        builtIn: false,
        assignableScopes: ['org', 'project'],
      })
      .returning({ id: roles.id });
    if (!role) throw new Error('customRole: insert returned no row');
    if (permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissions.map((permission) => ({ orgId, roleId: role.id, permission, condition: 'any' })));
    }
    return role.id;
  });
}

/** Platform-invites `${handle}@dev.local` with the role id at org scope, accepts it and returns the session cookie. */
export async function loginWithRole(t: TestApp, orgId: string, handle: string, roleId: string): Promise<string> {
  const admin = await asPlatformAdmin(t);
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
    payload: { email: `${handle}@dev.local`, roleId, scope: { type: 'org' } },
  });
  if (res.statusCode !== 201) throw new Error(`loginWithRole ${handle} answered ${res.statusCode}: ${res.body}`);
  const first = await loginAs(t, handle);
  const accepted = await acceptInvite(t, first, res.json<{ id: string }>().id);
  if (accepted.statusCode !== 200) throw new Error(`loginWithRole accept answered ${accepted.statusCode}`);
  return loginAs(t, handle);
}

export interface SlowStore {
  /** Lets every blocked and later `put` through. */
  release: () => void;
  /** Puts the original `put` back. */
  restore: () => void;
}

/** Makes the test app's secret store `put` wait on a promise the test releases. */
export function slowStore(t: TestApp): SlowStore {
  const original = t.secrets.put.bind(t.secrets);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.secrets.put = async (name, data) => {
    await gate;
    await original(name, data);
  };
  return {
    release,
    restore: () => {
      t.secrets.put = original;
    },
  };
}

/** Seeds `n` rows of `kind` for the project with SQL `generate_series` (names `SEED_<kind>_<i>`, 1-byte values for plain). */
export async function seedEnvRows(
  t: TestApp,
  orgId: string,
  projectId: string,
  n: number,
  kind: 'plain' | 'secret',
): Promise<void> {
  await withOrg(t.db, orgId, async (tx) => {
    await tx.execute(sql`
      insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
      select ${orgId}::uuid, ${projectId}::uuid, 'SEED_' || ${kind}::text || '_' || i,
             ${kind}::text,
             case when ${kind}::text = 'plain' then 'v' else null end,
             octet_length('SEED_' || ${kind}::text || '_' || i) + case when ${kind}::text = 'plain' then 1 else 0 end,
             'seed'
      from generate_series(1, ${n}) as i`);
  });
}

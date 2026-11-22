import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPgAt } from './helpers/pg';

// Issue 216: member and viewer lose the four Desk reads, in the template catalog and in every existing org's copy.
// The upgrade starts at 0031 (member and viewer still hold the reads), seeds orgs the way 0026 copied them, then
// applies the new migration and applies its SQL a second time.

const DESK_READS = ['agent:read', 'skill:read', 'rule:read', 'setup:read'];
const MIGRATION = new URL('../migrations/0032_revoke_desk_reads_member_viewer.sql', import.meta.url);

let old: Awaited<ReturnType<typeof startPgAt>>;
const orgA = randomUUID();
const orgB = randomUUID();

async function owner<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], orgId?: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: old.ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    if (orgId) await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const res = await client.query<T>(sql, params);
    await client.query('commit');
    return res.rows;
  } finally {
    await client.end();
  }
}

/** The way 0026 copied the templates into an org: roles, then role_permissions, in the org's own scope. */
async function copyTemplates(orgId: string): Promise<void> {
  await owner(`insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())`, [orgId]);
  await owner(
    `insert into roles (org_id, key, name, built_in, template_id, assignable_scopes)
     select $1::uuid, t.key, t.name, true, t.id, t.assignable_scopes from role_templates t`,
    [orgId],
    orgId,
  );
  await owner(
    `insert into role_permissions (org_id, role_id, permission, condition)
     select $1::uuid, r.id, tp.permission, tp.condition
     from roles r join role_template_permissions tp on tp.template_id = r.template_id where r.org_id = $1::uuid`,
    [orgId],
    orgId,
  );
}

const templateLines = async (key: string): Promise<string[]> =>
  (
    await owner<{ line: string }>(
      `select p.permission || '=' || p.condition as line from role_templates t
       join role_template_permissions p on p.template_id = t.id where t.key = $1 order by 1`,
      [key],
    )
  ).map((r) => r.line);

const orgLines = async (orgId: string, key: string): Promise<string[]> =>
  (
    await owner<{ line: string }>(
      `select p.permission || '=' || p.condition as line from roles r
       join role_permissions p on p.role_id = r.id where r.org_id = $1 and r.key = $2 order by 1`,
      [orgId, key],
      orgId,
    )
  ).map((r) => r.line);

beforeAll(async () => {
  old = await startPgAt('0031_invitation_org_for_email');
  await copyTemplates(orgA);
  await copyTemplates(orgB);
}, 180_000);

afterAll(async () => {
  await old?.stop();
});

describe('migration 0032: member and viewer lose the Desk reads', () => {
  it('starts from the old matrix, where member and viewer hold all four reads', async () => {
    for (const key of ['member', 'viewer']) {
      for (const p of DESK_READS) expect(await templateLines(key), `${key} ${p}`).toContain(`${p}=any`);
      for (const p of DESK_READS) expect(await orgLines(orgA, key), `${key} ${p} in org A`).toContain(`${p}=any`);
    }
  });

  it('removes the four reads from the member and viewer templates and from every existing org copy', async () => {
    await old.migrateRest();
    expect(await templateLines('member')).toEqual(
      [
        'project:read=any',
        'run:read=any',
        'run:create=any',
        'run:update=own',
        'run:cancel=own',
        'terminal:attach=own',
      ].sort(),
    );
    expect(await templateLines('viewer')).toEqual(['project:read=any', 'run:read=any']);
    for (const orgId of [orgA, orgB]) {
      expect(await orgLines(orgId, 'member'), `member in ${orgId}`).toEqual(await templateLines('member'));
      expect(await orgLines(orgId, 'viewer'), `viewer in ${orgId}`).toEqual(await templateLines('viewer'));
    }
  });

  it('leaves owner and admin untouched, in the templates and in every org', async () => {
    for (const key of ['owner', 'admin']) {
      for (const p of DESK_READS) expect(await templateLines(key), `${key} template`).toContain(`${p}=any`);
      for (const orgId of [orgA, orgB]) {
        expect(await orgLines(orgId, key), `${key} in ${orgId}`).toEqual(await templateLines(key));
      }
    }
  });

  it('is idempotent: applying its SQL again changes nothing', async () => {
    const before = await owner<{ n: string }>('select count(*)::text as n from role_template_permissions');
    const sql = await readFile(MIGRATION, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) await owner(statement);
    const after = await owner<{ n: string }>('select count(*)::text as n from role_template_permissions');
    expect(after).toEqual(before);
    expect(await orgLines(orgA, 'viewer')).toEqual(['project:read=any', 'run:read=any']);
  });
});

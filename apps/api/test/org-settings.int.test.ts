import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgDto } from '@agentdesk/contracts';
import { auditLog, connections, organization, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, updateOrg } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
const logLines: Record<string, unknown>[] = [];

beforeAll(async () => {
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logLines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  t = await createTestApp({ logger });
});
afterAll(async () => {
  await t.close();
});

async function seedProject(orgId: string, name: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        capabilities: { code: true, board: true },
        externalId: randomUUID(),
        accountName: 'dev',
      })
      .returning({ id: connections.id });
    const [project] = await tx
      .insert(projects)
      .values({
        orgId,
        name,
        repoPath: `dev/${name.toLowerCase()}`,
        codeConnectionId: conn?.id ?? '',
        boardConnectionId: conn?.id ?? '',
      })
      .returning({ id: projects.id });
    return project?.id ?? '';
  });
}

interface Cast {
  orgId: string;
  slug: string;
  o: string;
  a: string;
  p1admin: string;
  m: string;
  v: string;
}

async function buildCast(slug: string): Promise<Cast> {
  const org = await createOrg(t, `Org ${slug}`, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  return {
    orgId: org.id,
    slug,
    o: await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' }),
    a: await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'org' }),
    p1admin: await inviteAndLogin(t, org.id, h('pa'), 'admin', { type: 'project', projectIds: [p1] }),
    m: await inviteAndLogin(t, org.id, h('m'), 'member', { type: 'org' }),
    v: await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' }),
  };
}

async function orgRow(orgId: string): Promise<{ name: string; slug: string }> {
  const rows = await t.db.orm
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId));
  const row = rows[0];
  if (!row) throw new Error('org row missing');
  return row;
}

async function updates(orgId: string): Promise<{ payload: Record<string, unknown>; targetId: string | null }[]> {
  return withOrg(t.db, orgId, async (tx) =>
    tx
      .select({ payload: auditLog.payload, targetId: auditLog.targetId, action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'org.updated')),
  );
}

const pointerOf = (res: { json: () => unknown }): string | undefined =>
  (res.json() as { errors?: { pointer: string }[] }).errors?.[0]?.pointer;

describe('PATCH /api/orgs/:orgId', () => {
  it('an owner renames the org and one org.updated audit row records the change', async () => {
    const f = await buildCast('os-rename');
    const res = await updateOrg(t, f.o, f.orgId, { name: 'Renamed' });
    expect(res.statusCode).toBe(200);
    expect(expectContract('orgs.update', res)).toEqual({ id: f.orgId, name: 'Renamed', slug: f.slug } satisfies OrgDto);
    expect(await orgRow(f.orgId)).toEqual({ name: 'Renamed', slug: f.slug });
    const rows = await updates(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(f.orgId);
    expect(rows[0]?.payload).toMatchObject({ from: { name: `Org ${f.slug}` }, to: { name: 'Renamed' } });
  });

  it('waits for a concurrent writer of the org row, so the audit from holds the committed name', async () => {
    const f = await buildCast('os-race');
    let patch: ReturnType<typeof updateOrg> | undefined;
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, f.orgId)).for('update');
      patch = updateOrg(t, f.o, f.orgId, { name: 'C' });
      await new Promise((r) => setTimeout(r, 400));
      await tx.update(organization).set({ name: 'B' }).where(eq(organization.id, f.orgId));
    });
    const res = await patch;
    expect(res?.statusCode).toBe(200);
    expect(await orgRow(f.orgId)).toEqual({ name: 'C', slug: f.slug });
    const rows = await updates(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ from: { name: 'B' }, to: { name: 'C' } });
  });

  it('a slug change is audited with the slug fields', async () => {
    const f = await buildCast('os-slug');
    const res = await updateOrg(t, f.o, f.orgId, { slug: 'os-slug-new' });
    expect(res.statusCode).toBe(200);
    expect((await orgRow(f.orgId)).slug).toBe('os-slug-new');
    const rows = await updates(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ from: { slug: 'os-slug' }, to: { slug: 'os-slug-new' } });
  });

  it('name and slug at once give one row with both fields', async () => {
    const f = await buildCast('os-both');
    const res = await updateOrg(t, f.o, f.orgId, { name: 'Both', slug: 'os-both-new' });
    expect(res.statusCode).toBe(200);
    const rows = await updates(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      from: { name: 'Org os-both', slug: 'os-both' },
      to: { name: 'Both', slug: 'os-both-new' },
    });
  });

  it('PATCH with the current slug and a new name is 200 and audits only name', async () => {
    const f = await buildCast('os-same-slug');
    const res = await updateOrg(t, f.o, f.orgId, { name: 'New', slug: f.slug });
    expect(res.statusCode).toBe(200);
    const rows = await updates(f.orgId);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as { from: object; to: object };
    expect(payload.from).toEqual({ name: 'Org os-same-slug' });
    expect(payload.to).toEqual({ name: 'New' });
  });

  it('PATCH with the current name and slug is 200 and writes no audit row', async () => {
    const f = await buildCast('os-noop');
    const res = await updateOrg(t, f.o, f.orgId, { name: `Org ${f.slug}`, slug: f.slug });
    expect(res.statusCode).toBe(200);
    expect(await updates(f.orgId)).toHaveLength(0);
  });

  it('refuses bad bodies with 400 and changes nothing', async () => {
    const f = await buildCast('os-bad');
    const cases: [Record<string, unknown>, string | undefined][] = [
      [{}, undefined],
      [{ name: '' }, '/name'],
      [{ name: 'x'.repeat(101) }, '/name'],
      [{ slug: 'Bad_Slug' }, '/slug'],
      [{ slug: '-bad' }, '/slug'],
    ];
    for (const [body, pointer] of cases) {
      const res = await updateOrg(t, f.o, f.orgId, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      if (pointer) expect(pointerOf(res)).toBe(pointer);
    }
    expect(await orgRow(f.orgId)).toEqual({ name: `Org ${f.slug}`, slug: f.slug });
    expect(await updates(f.orgId)).toHaveLength(0);
  });

  it('a slug taken by another org is 409 with a /slug pointer, and a released slug is free at once', async () => {
    const a = await buildCast('os-taken-a');
    const b = await buildCast('os-taken-b');
    const res = await updateOrg(t, a.o, a.orgId, { slug: b.slug });
    expect(res.statusCode).toBe(409);
    expect(pointerOf(res)).toBe('/slug');
    expect((await orgRow(a.orgId)).slug).toBe(a.slug);
    expect(await updates(a.orgId)).toHaveLength(0);

    expect((await updateOrg(t, a.o, a.orgId, { slug: 'os-taken-a-moved' })).statusCode).toBe(200);
    expect((await updateOrg(t, b.o, b.orgId, { slug: a.slug })).statusCode).toBe(200);
    expect((await orgRow(b.orgId)).slug).toBe(a.slug);
  });

  it('an org admin may update; a project admin, member and viewer get 403 and nothing changes', async () => {
    const f = await buildCast('os-roles');
    for (const cookie of [f.p1admin, f.m, f.v]) {
      const res = await updateOrg(t, cookie, f.orgId, { name: 'Nope' });
      expect(res.statusCode).toBe(403);
    }
    expect(await orgRow(f.orgId)).toEqual({ name: `Org ${f.slug}`, slug: f.slug });
    expect(await updates(f.orgId)).toHaveLength(0);
    expect((await updateOrg(t, f.a, f.orgId, { name: 'By admin' })).statusCode).toBe(200);
    expect((await orgRow(f.orgId)).name).toBe('By admin');
  });

  it('a header naming another org than the active one is 409 org-mismatch and org B is untouched', async () => {
    const a = await buildCast('os-xa');
    const b = await buildCast('os-xb');
    const res = await updateOrg(t, a.o, b.orgId, { name: 'Hijack' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'org-mismatch' });
    expect(await orgRow(b.orgId)).toEqual({ name: `Org ${b.slug}`, slug: b.slug });
    expect(await updates(b.orgId)).toHaveLength(0);
  });

  it('an owner of org A cannot touch org B: an :orgId other than the active org is 404 with the active org in the header', async () => {
    const a = await buildCast('os-url-a');
    const b = await buildCast('os-url-b');
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/orgs/${b.orgId}`,
      headers: { cookie: a.o, 'x-org-id': a.orgId },
      payload: { name: 'Hijack' },
    });
    expect(res.statusCode).toBe(404);
    expect(await orgRow(b.orgId)).toEqual({ name: `Org ${b.slug}`, slug: b.slug });
    expect(await orgRow(a.orgId)).toEqual({ name: `Org ${a.slug}`, slug: a.slug });
    expect(await updates(b.orgId)).toHaveLength(0);
  });

  it('ignores an orgId in the body', async () => {
    const a = await buildCast('os-body-a');
    const b = await buildCast('os-body-b');
    const res = await updateOrg(t, a.o, a.orgId, { name: 'Mine', orgId: b.orgId });
    expect(res.statusCode).toBe(200);
    expect((await orgRow(a.orgId)).name).toBe('Mine');
    expect((await orgRow(b.orgId)).name).toBe(`Org ${b.slug}`);
  });

  it('keeps a name with markup and SQL text unchanged', async () => {
    const f = await buildCast('os-text');
    const name = "<b>x</b>'; drop table";
    const res = await updateOrg(t, f.o, f.orgId, { name });
    expect(res.statusCode).toBe(200);
    expect(res.json<OrgDto>().name).toBe(name);
    expect((await orgRow(f.orgId)).name).toBe(name);
  });

  it('logs the update with ids only at info', async () => {
    const f = await buildCast('os-log');
    logLines.length = 0;
    expect((await updateOrg(t, f.o, f.orgId, { name: 'Logged' })).statusCode).toBe(200);
    const line = logLines.find((l) => l['orgId'] === f.orgId && l['level'] === 30 && l['msg'] === 'org updated');
    expect(line).toBeDefined();
    expect(typeof line?.['requestId']).toBe('string');
    expect(JSON.stringify(logLines)).not.toContain('@dev.local');
  });
});

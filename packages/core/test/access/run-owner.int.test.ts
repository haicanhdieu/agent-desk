import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connections, createDb, projects, roleAssignments, roles, runs, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { copyRoleTemplates, resolveRunOwner, type RunOwnerInput } from '../../src';

let pgServer: TestPg;
let db: Db;
let admin: pg.Pool;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
}, 180_000);
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgServer.stop();
});

const BOT = 'agent-desk[bot]';
const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-01-01T11:00:00.000Z';
const T2 = '2026-01-01T12:00:00.000Z';
const T3 = '2026-01-01T13:00:00.000Z';

interface World {
  orgId: string;
  p1: string;
  p2: string;
  b: string;
  v: string;
  roleIds: Record<string, string>;
}

async function makeUser(handle: string, externalId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`insert into "user" (id, name, email, handle) values ($1, $2, $3, $2)`, [
    id,
    handle,
    `${handle}-${id}@example.test`,
  ]);
  await admin.query(
    `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
    [randomUUID(), externalId, id],
  );
  return id;
}

async function makeWorld(): Promise<World> {
  const orgId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const b = await makeUser('bee', `ext-b-${suffix}`);
  const v = await makeUser('vee', `ext-v-${suffix}`);
  const { p1, p2, roleIds } = await withOrg(db, orgId, async (tx) => {
    await copyRoleTemplates(tx, orgId);
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        externalId: `fake-${orgId}`,
        accountName: 'acme',
        capabilities: { code: true, board: true },
      })
      .returning({ id: connections.id });
    const mk = async (name: string) => {
      const [p] = await tx
        .insert(projects)
        .values({
          orgId,
          name,
          repoPath: `acme/${randomUUID()}`,
          codeConnectionId: conn!.id,
          boardConnectionId: conn!.id,
        })
        .returning({ id: projects.id });
      return p!.id;
    };
    const p1 = await mk('one');
    const p2 = await mk('two');
    const rows = await tx.select({ id: roles.id, key: roles.key }).from(roles);
    const roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
    await tx.insert(roleAssignments).values([
      { orgId, userId: b, roleId: roleIds.member!, scopeType: 'project', projectId: p1 },
      { orgId, userId: v, roleId: roleIds.viewer!, scopeType: 'org' },
    ]);
    return { p1, p2, roleIds };
  });
  return { orgId, p1, p2, b, v, roleIds };
}

async function addRun(
  w: World,
  o: {
    projectId: string;
    ticketRef: string;
    ownerUserId: string | null;
    startedAt: string | null;
    finishedAt?: string | null;
  },
): Promise<string> {
  return withOrg(db, w.orgId, async (tx) => {
    const [r] = await tx
      .insert(runs)
      .values({
        orgId: w.orgId,
        projectId: o.projectId,
        command: '/dev',
        ticketRef: o.ticketRef,
        ticketKind: 'issue',
        checkoutRef: 'main',
        triggerSource: 'webhook',
        ownerUserId: o.ownerUserId,
        startedAt: o.startedAt ? new Date(o.startedAt) : null,
        finishedAt: o.finishedAt ? new Date(o.finishedAt) : null,
      })
      .returning({ id: runs.id });
    return r!.id;
  });
}

const resolve = (w: World, input: RunOwnerInput) => withOrg(db, w.orgId, (tx) => resolveRunOwner(tx, input));
const human = (projectId: string, authorId: string | undefined): RunOwnerInput => ({
  projectId,
  boardProvider: 'fake',
  botLogin: BOT,
  event: { author: 'someone', authorId, ticketRef: 'acme/app#1', createdAt: T1 },
});
const bot = (projectId: string, ticketRef: string, createdAt: string): RunOwnerInput => ({
  projectId,
  boardProvider: 'fake',
  botLogin: BOT,
  event: { author: BOT, authorId: 'bot-1', ticketRef, createdAt },
});
const extId = async (userId: string) =>
  (await admin.query<{ account_id: string }>(`select account_id from account where user_id = $1`, [userId])).rows[0]!
    .account_id;

describe('resolveRunOwner: human commenter', () => {
  it('returns the linked commenter as owner when they hold run:create on the project', async () => {
    const w = await makeWorld();
    expect(await resolve(w, human(w.p1, await extId(w.b)))).toEqual({
      kind: 'owner',
      userId: w.b,
      originRunId: null,
    });
  });

  it('ignores a linked commenter without run:create (viewer)', async () => {
    const w = await makeWorld();
    const r = await resolve(w, human(w.p1, await extId(w.v)));
    expect(r).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_not_permitted' });
  });

  it('ignores a commenter whose grant covers another project only', async () => {
    const w = await makeWorld();
    const r = await resolve(w, human(w.p2, await extId(w.b)));
    expect(r).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_not_permitted' });
  });

  it('ignores an author id nobody is linked to', async () => {
    const w = await makeWorld();
    const r = await resolve(w, human(w.p1, 'no-such-id'));
    expect(r).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_unlinked' });
  });

  it('ignores an event without an author id', async () => {
    const w = await makeWorld();
    const r = await resolve(w, human(w.p1, undefined));
    expect(r).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_unlinked' });
  });

  it('ignores an empty author id', async () => {
    const w = await makeWorld();
    const r = await resolve(w, human(w.p1, ''));
    expect(r).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_unlinked' });
  });
});

describe('resolveRunOwner: bot-written trigger', () => {
  it('uses the single active run on the ticket as origin', async () => {
    const w = await makeWorld();
    const origin = await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#2', ownerUserId: w.v, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toEqual({
      kind: 'owner',
      userId: w.b,
      originRunId: origin,
    });
  });

  it('falls back to the single active run in the project when none is on the ticket', async () => {
    const w = await makeWorld();
    const origin = await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#9', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toEqual({
      kind: 'owner',
      userId: w.b,
      originRunId: origin,
    });
  });

  it('ignores a bot comment with two candidate runs on the ticket', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#2', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toEqual({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
      detail: 'bot comment has no single originating run',
    });
  });

  it('ignores a bot comment with no run on the ticket and two in the project', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#8', ownerUserId: w.b, startedAt: T0 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#9', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
      detail: 'bot comment has no single originating run',
    });
  });

  it('ignores a bot comment with no candidate run at all', async () => {
    const w = await makeWorld();
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
    });
  });

  it('never takes an origin from another project', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p2, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
    });
  });

  it('ignores an origin run that has no owner', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: null, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toEqual({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
      detail: 'originating run has no owner',
    });
  });

  it('ignores an origin whose owner lost the project assignment', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    await withOrg(db, w.orgId, (tx) => tx.delete(roleAssignments).where(eq(roleAssignments.userId, w.b)));
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T1))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_not_permitted',
    });
  });

  it('does not take a run that finished before the comment, nor one that started after it', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0, finishedAt: T1 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T3 });
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: null });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', T2))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
    });
  });

  it("a bot comment at the origin's started_at or finished_at still matches it", async () => {
    const w = await makeWorld();
    const origin = await addRun(w, {
      projectId: w.p1,
      ticketRef: 'acme/app#1',
      ownerUserId: w.b,
      startedAt: T0,
      finishedAt: T1,
    });
    for (const at of [T0, T1]) {
      expect(await resolve(w, bot(w.p1, 'acme/app#1', at))).toEqual({
        kind: 'owner',
        userId: w.b,
        originRunId: origin,
      });
    }
  });

  it('ignores a bot comment whose time cannot be parsed', async () => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', 'not a time'))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
    });
  });

  it.each([
    '1',
    'Jan 1, 2026 GMT+0100',
    '2026/01/01 10:00 GMT',
    '2026-02-30T00:00:00Z',
    '2026-02-31T10:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-02-29T10:00:00Z',
    '2026-13-01T00:00:00Z',
  ])('ignores, without throwing, a bot comment time JS parses but Postgres rejects: %s', async (at) => {
    const w = await makeWorld();
    await addRun(w, { projectId: w.p1, ticketRef: 'acme/app#1', ownerUserId: w.b, startedAt: T0 });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', at))).toMatchObject({
      kind: 'ignored',
      outcome: 'ignored_owner_unlinked',
    });
  });

  it('accepts the leap day 2024-02-29 as a bot comment time', async () => {
    const w = await makeWorld();
    const origin = await addRun(w, {
      projectId: w.p1,
      ticketRef: 'acme/app#1',
      ownerUserId: w.b,
      startedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(await resolve(w, bot(w.p1, 'acme/app#1', '2024-02-29T10:00:00Z'))).toEqual({
      kind: 'owner',
      userId: w.b,
      originRunId: origin,
    });
  });

  it('treats a comment by the bot login as a bot comment even with a linked author id', async () => {
    const w = await makeWorld();
    const input = bot(w.p1, 'acme/app#1', T1);
    input.event.authorId = await extId(w.v);
    // no run to originate from: must not fall through to the human path and resolve the viewer
    expect(await resolve(w, input)).toMatchObject({ kind: 'ignored', outcome: 'ignored_owner_unlinked' });
  });
});

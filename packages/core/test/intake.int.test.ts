import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { eq, sql } from 'drizzle-orm';
import {
  agents,
  connections,
  createDb,
  inboundEvents,
  projects,
  roleAssignments,
  roles,
  rules,
  runs,
  withOrg,
  type Db,
} from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import type { AdapterRegistry, BoardAdapter, CodeHostAdapter, Ticket, TicketEvent } from '../src';
import {
  copyRoleTemplates,
  isUniqueViolation,
  OWNER_UNDETECTED_NOTICE,
  processTicketEvent,
  startRunWorkflow,
  sweepOutbox,
  type IntakeDeps,
  type WorkflowStarter,
} from '../src';
import { botTriggerEvent } from './fixtures/bot-comment';

let pgServer: TestPg;
let db: Db;
let admin: pg.Pool;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgServer.stop();
});

interface Seed {
  orgId: string;
  projectId: string;
  externalId: string;
  repoPath: string;
  /** Login of the linked commenter (account ('fake', author)); unique per seed, so the link is never ambiguous. */
  author: string;
  /** The Agent Desk user linked to `author`. */
  ownerId: string;
  /** Role ids of the org's built-in roles. */
  roleIds: Record<string, string>;
}

async function makeLinkedUser(handle: string, accountId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`insert into "user" (id, name, email, handle) values ($1, $2, $3, $2)`, [
    id,
    handle,
    `${handle}-${id}@example.test`,
  ]);
  await admin.query(
    `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
    [randomUUID(), accountId, id],
  );
  return id;
}

let seq = 0;
async function seed(
  over: {
    labelFilter?: string[];
    maxRunsPerTicket?: number;
    prompt?: string;
    model?: string | null;
    agentModel?: string;
    /** Role the linked commenter holds on the project; `none` links the account but grants nothing. */
    role?: 'member' | 'viewer' | 'none';
    /** Extra provider user ids that also link to the commenter (account ids). */
    extraAccountIds?: string[];
  } = {},
): Promise<Seed> {
  seq += 1;
  const author = `alice-${seq}-${randomUUID().slice(0, 8)}`;
  const ownerId = await makeLinkedUser(author, author);
  for (const extra of over.extraAccountIds ?? []) {
    await admin.query(
      `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
      [randomUUID(), extra, ownerId],
    );
  }
  const orgId = randomUUID();
  const externalId = `fake-${orgId}`;
  const repoPath = `acme/app-${seq}`;
  const roleIds: Record<string, string> = {};
  const projectId = await withOrg(db, orgId, async (tx) => {
    await copyRoleTemplates(tx, orgId);
    for (const r of await tx.select({ id: roles.id, key: roles.key }).from(roles)) roleIds[r.key] = r.id;
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        externalId,
        accountName: 'acme',
        capabilities: { code: true, board: true },
      })
      .returning({ id: connections.id });
    const [p] = await tx
      .insert(projects)
      .values({
        orgId,
        name: repoPath,
        repoPath,
        codeConnectionId: conn!.id,
        boardConnectionId: conn!.id,
        ...(over.maxRunsPerTicket ? { maxRunsPerTicket: over.maxRunsPerTicket } : {}),
      })
      .returning({ id: projects.id });
    const [a] = await tx
      .insert(agents)
      .values({ orgId, projectId: p!.id, name: 'default', model: over.agentModel ?? 'sonnet' })
      .returning({ id: agents.id });
    await tx.insert(rules).values({
      orgId,
      projectId: p!.id,
      command: 'code-review',
      ...(over.prompt !== undefined ? { skillName: null, prompt: over.prompt } : { skillName: 'code-review' }),
      agentId: a!.id,
      target: 'any',
      labelFilter: over.labelFilter ?? [],
      model: over.model ?? null,
    });
    const role = over.role ?? 'member';
    if (role !== 'none') {
      await tx.insert(roleAssignments).values({
        orgId,
        userId: ownerId,
        roleId: roleIds[role]!,
        scopeType: 'project',
        projectId: p!.id,
      });
    }
    return p!.id;
  });
  return { orgId, projectId, externalId, repoPath, author, ownerId, roleIds };
}

const ticket = (n: number): Ticket => ({
  ref: String(n),
  kind: 'issue',
  number: n,
  title: `Ticket ${n}`,
  url: `http://fake.invalid/issues/${n}`,
  labels: [{ name: 'bug', color: 'ff0000' }],
  linkedRefs: [],
});

function harness(over: Partial<IntakeDeps> = {}, getTicketImpl?: (ref: string) => Promise<Ticket>) {
  const getTicket = vi.fn(async (_p: unknown, ref: string) => (getTicketImpl ?? (async (r) => ticket(Number(r))))(ref));
  const comment = vi.fn(async (_p: unknown, _ref: string, _text: string) => 'posted-1');
  const board = { getTicket, comment } as unknown as BoardAdapter; // only getTicket and comment are exercised by the intake
  const host = {
    checkoutRef: (t: { kind: string; number: number }) => (t.kind === 'pr' ? `refs/pull/${t.number}/head` : 'main'),
  } as unknown as CodeHostAdapter; // only checkoutRef is exercised by the intake
  const registry: AdapterRegistry = { board: () => board, codeHost: () => host, providers: () => ['fake'] };
  const startRun = vi.fn(async (_orgId: string, _runId: string) => {});
  const deps: IntakeDeps = {
    db,
    registry,
    startRun,
    clock: { now: () => new Date('2026-11-12T00:00:00Z') },
    botLogin: 'agentdesk[bot]',
    ...over,
  };
  return { deps, startRun, getTicket, comment };
}

const eventFor = (s: Seed, over: Partial<TicketEvent> = {}): TicketEvent => {
  const id = randomUUID();
  return {
    provider: 'fake',
    deliveryId: `d-${id}`,
    commentId: `c-${id}`,
    externalId: s.externalId,
    repoPath: s.repoPath,
    ticketRef: '7',
    ticketKind: 'issue',
    body: '/code-review fast',
    author: s.author,
    authorId: s.author,
    authorAssociation: 'MEMBER',
    createdAt: '2026-11-12T00:00:00Z',
    ...over,
  };
};

const runsOf = (s: Seed) => withOrg(db, s.orgId, (tx) => tx.select().from(runs).where(eq(runs.projectId, s.projectId)));
const inboundOf = (s: Seed) =>
  withOrg(db, s.orgId, (tx) => tx.select().from(inboundEvents).where(eq(inboundEvents.projectId, s.projectId)));

describe('processTicketEvent', () => {
  it('creates a queued run with ticket snapshot columns and starts it once', async () => {
    const s = await seed();
    const h = harness();
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run).toMatchObject({
      id: r.runId,
      number: 1,
      status: 'queued',
      command: 'code-review',
      args: 'fast',
      skillName: 'code-review',
      ticketRef: '7',
      ticketKind: 'issue',
      ticketNumber: 7,
      ticketTitle: 'Ticket 7',
      ticketUrl: 'http://fake.invalid/issues/7',
      ticketLabels: [{ name: 'bug', color: 'ff0000' }],
      checkoutRef: 'main',
      triggerSource: 'webhook',
      triggeredBy: s.author,
      triggeredByExternalId: s.author,
      workflowId: null,
    });
    expect(h.getTicket).toHaveBeenCalledTimes(1); // router had no need for it, the snapshot did
    expect(h.startRun).toHaveBeenCalledExactlyOnceWith(s.orgId, r.runId);
    expect((await inboundOf(s))[0]).toMatchObject({ outcome: 'run_created', orgId: s.orgId, projectId: s.projectId });
  });

  it('stores the provider user id of the person who triggered the run', async () => {
    const providerUserId = `ext-${randomUUID()}`;
    const s = await seed({ extraAccountIds: [providerUserId] });
    const h = harness();
    await processTicketEvent(h.deps, eventFor(s, { authorId: providerUserId }), 'webhook');
    expect((await runsOf(s))[0]).toMatchObject({ triggeredBy: s.author, triggeredByExternalId: providerUserId });
  });

  it('the same delivery twice is a duplicate with one run', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s);
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('run_created');
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'duplicate' });
    expect(await runsOf(s)).toHaveLength(1);
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('Review Focus 1: same comment via webhook then poll yields one run and one start', async () => {
    const s = await seed();
    const h = harness();
    const first = eventFor(s, { commentId: 'shared-comment' });
    const second = eventFor(s, { commentId: 'shared-comment' });
    expect(first.deliveryId).not.toBe(second.deliveryId);
    expect((await processTicketEvent(h.deps, first, 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, second, 'poll')).outcome).toBe('duplicate_comment');
    expect(await runsOf(s)).toHaveLength(1);
    expect(h.startRun).toHaveBeenCalledTimes(1);
    expect((await inboundOf(s)).map((r) => r.outcome).sort()).toEqual(['duplicate_comment', 'run_created']);
  });

  it('Review Focus 4: ignored events keep command, author and ticket_ref', async () => {
    const s = await seed();
    const h = harness();
    const noCmd = eventFor(s, { body: 'hi\n/code-review' });
    const contrib = eventFor(s, { authorAssociation: 'CONTRIBUTOR', author: 'mallory' });
    expect((await processTicketEvent(h.deps, noCmd, 'webhook')).outcome).toBe('ignored_no_command');
    expect((await processTicketEvent(h.deps, contrib, 'webhook')).outcome).toBe('ignored_unauthorized');
    const rows = await inboundOf(s);
    const byOutcome = (o: string) => rows.find((r) => r.outcome === o);
    expect(byOutcome('ignored_no_command')).toMatchObject({ author: s.author, ticketRef: '7', command: 'hi' });
    expect(byOutcome('ignored_unauthorized')).toMatchObject({
      author: 'mallory',
      ticketRef: '7',
      command: 'code-review',
    });
    expect(byOutcome('ignored_unauthorized')?.detail).toContain('CONTRIBUTOR');
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
  });

  it('records an unknown project once with a null org, and replays are duplicates', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { externalId: 'fake-nobody' });
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'ignored_unknown_project' });
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'duplicate' });
    const rows = await admin.query('select outcome, org_id, project_id from inbound_events where delivery_id = $1', [
      e.deliveryId,
    ]);
    expect(rows.rows).toEqual([{ outcome: 'ignored_unknown_project', org_id: null, project_id: null }]);
    // the same delivery arriving later for a now-known project still collides on the global unique key
    expect(
      await processTicketEvent(h.deps, { ...e, externalId: s.externalId, repoPath: s.repoPath }, 'webhook'),
    ).toEqual({
      outcome: 'duplicate',
    });
    expect(await runsOf(s)).toHaveLength(0);
  });

  it('a delivery id owned by another org is a duplicate, not an error', async () => {
    const a = await seed();
    const b = await seed();
    const h = harness();
    const e = eventFor(a);
    await processTicketEvent(h.deps, e, 'webhook');
    expect(
      await processTicketEvent(h.deps, { ...e, externalId: b.externalId, repoPath: b.repoPath }, 'webhook'),
    ).toEqual({ outcome: 'duplicate' });
    expect(await runsOf(b)).toHaveLength(0);
  });

  it('skips resolution when the project is known', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { externalId: 'whatever', repoPath: 'elsewhere/x' });
    const r = await processTicketEvent(h.deps, e, 'poll', { orgId: s.orgId, projectId: s.projectId });
    expect(r.outcome).toBe('run_created');
    expect((await runsOf(s))[0]?.triggerSource).toBe('polling');
  });

  it('guards: max runs per ticket and an active run of the same skill', async () => {
    const s = await seed({ maxRunsPerTicket: 1 });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('ignored_max_runs');
    const t = await seed();
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('ignored_active_run');
    await withOrg(db, t.orgId, (tx) =>
      tx.update(runs).set({ status: 'succeeded' }).where(eq(runs.projectId, t.projectId)),
    );
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
  });

  it('a prompt rule copies its prompt onto the run with a null skill name', async () => {
    const s = await seed({ prompt: 'Triage this.\nAdd labels.' });
    const r = await processTicketEvent(harness().deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    const [run] = await runsOf(s);
    const [rule] = await withOrg(db, s.orgId, (tx) => tx.select().from(rules).where(eq(rules.projectId, s.projectId)));
    expect(run).toMatchObject({ prompt: 'Triage this.\nAdd labels.', skillName: null, ruleId: rule?.id });
  });

  it('a rule that names a model freezes it on the run', async () => {
    const s = await seed({ model: 'haiku', agentModel: 'sonnet' });
    const { deps } = harness();
    await processTicketEvent(deps, eventFor(s), 'webhook');
    expect((await runsOf(s))[0]?.model).toBe('haiku');
  });

  it('a rule that follows the default copies the agent default model at intake', async () => {
    const s = await seed({ model: null, agentModel: 'opus' });
    const { deps } = harness();
    await processTicketEvent(deps, eventFor(s), 'webhook');
    expect((await runsOf(s))[0]?.model).toBe('opus');
  });

  it('a run already queued keeps its model when the default changes', async () => {
    const s = await seed({ model: null, agentModel: 'sonnet' });
    const { deps } = harness();
    await processTicketEvent(deps, eventFor(s), 'webhook');
    await withOrg(db, s.orgId, (tx) =>
      tx.update(agents).set({ model: 'opus' }).where(eq(agents.projectId, s.projectId)),
    );
    expect((await runsOf(s))[0]?.model).toBe('sonnet');
  });

  it('guards: an active run of the same prompt rule', async () => {
    const t = await seed({ prompt: 'Triage this.' });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('ignored_active_run');
    await withOrg(db, t.orgId, (tx) =>
      tx.update(runs).set({ status: 'succeeded' }).where(eq(runs.projectId, t.projectId)),
    );
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
  });

  it('label-filtered rules use the fetched ticket', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    const t = await seed({ labelFilter: ['docs'] });
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('ignored_labels');
  });

  it('numbers runs 1..5 per project under concurrent inserts', async () => {
    const s = await seed();
    const h = harness();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => processTicketEvent(h.deps, eventFor(s, { ticketRef: String(100 + n) }), 'webhook')),
    );
    expect(results.every((r) => r.outcome === 'run_created')).toBe(true);
    const numbers = (await runsOf(s)).map((r) => r.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(h.startRun).toHaveBeenCalledTimes(5);
  });
});

describe('processTicketEvent: run owner', () => {
  const ORIGIN_START = '2026-11-11T23:00:00Z';
  const BOT_AT = '2026-11-12T00:00:00Z';

  /** A running run of the commenter on ticket 7 with no skill, so it does not trip the active-run guard. */
  const originRun = (s: Seed, over: { ownerUserId?: string | null; ticketRef?: string } = {}) =>
    withOrg(db, s.orgId, async (tx) => {
      const [r] = await tx
        .insert(runs)
        .values({
          orgId: s.orgId,
          projectId: s.projectId,
          command: 'origin',
          ticketRef: over.ticketRef ?? '7',
          ticketKind: 'issue',
          checkoutRef: 'main',
          triggerSource: 'webhook',
          status: 'running',
          ownerUserId: over.ownerUserId === undefined ? s.ownerId : over.ownerUserId,
          startedAt: new Date(ORIGIN_START),
        })
        .returning({ id: runs.id });
      return r!.id;
    });
  const outcomes = async (s: Seed) => (await inboundOf(s)).map((r) => r.outcome);

  it('the run belongs to the linked commenter and has no origin run', async () => {
    const s = await seed();
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    expect((await runsOf(s))[0]).toMatchObject({ ownerUserId: s.ownerId, originRunId: null });
  });

  it('logs the owner decision at info with ids only', async () => {
    const s = await seed();
    const log = { warn: vi.fn(), info: vi.fn() };
    const h = harness({ log });
    const e = eventFor(s);
    await processTicketEvent(h.deps, e, 'webhook');
    expect(log.info).toHaveBeenCalledWith(
      {
        deliveryId: e.deliveryId,
        projectId: s.projectId,
        channel: 'webhook',
        origin: 'human',
        outcome: 'owner',
        ownerUserId: s.ownerId,
      },
      'intake run owner decided',
    );
  });

  it('a commenter that is not linked starts no run and the board is not called', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { author: 'stranger', authorId: `stranger-${randomUUID()}` });
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'ignored_owner_unlinked' });
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(await inboundOf(s)).toMatchObject([
      { outcome: 'ignored_owner_unlinked', author: 'stranger', command: 'code-review' },
    ]);
  });

  it('a commenter without a provider user id is unlinked', async () => {
    const s = await seed();
    const h = harness();
    const e = { ...eventFor(s), authorId: undefined };
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('ignored_owner_unlinked');
    expect(await runsOf(s)).toHaveLength(0);
  });

  it.each(['viewer', 'none'] as const)('a linked commenter with role %s lacks run:create', async (role) => {
    const s = await seed({ role });
    const h = harness();
    expect(await processTicketEvent(h.deps, eventFor(s), 'webhook')).toEqual({
      outcome: 'ignored_owner_not_permitted',
    });
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
    expect(h.getTicket).not.toHaveBeenCalled();
  });

  it('the owner check comes before rule matching: an unlinked commenter on an unknown command is unlinked', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { body: '/no-such-rule', authorId: `nobody-${randomUUID()}` });
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('ignored_owner_unlinked');
  });

  it('a grant on another project of the org does not allow a run here', async () => {
    const s = await seed({ role: 'none' });
    await withOrg(db, s.orgId, async (tx) => {
      const [conn] = await tx.select({ id: connections.id }).from(connections);
      const [other] = await tx
        .insert(projects)
        .values({
          orgId: s.orgId,
          name: 'elsewhere',
          repoPath: `acme/elsewhere-${randomUUID()}`,
          codeConnectionId: conn!.id,
          boardConnectionId: conn!.id,
        })
        .returning({ id: projects.id });
      await tx.insert(roleAssignments).values({
        orgId: s.orgId,
        userId: s.ownerId,
        roleId: s.roleIds.member!,
        scopeType: 'project',
        projectId: other!.id,
      });
    });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('ignored_owner_not_permitted');
    expect(await runsOf(s)).toHaveLength(0);
  });

  it("a bot comment during the owner's active run starts a run owned by that owner, with origin_run_id set", async () => {
    const s = await seed();
    const originId = await originRun(s);
    const h = harness();
    const e = botTriggerEvent(eventFor(s), BOT_AT);
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('run_created');
    const chained = (await runsOf(s)).find((r) => r.id !== originId);
    expect(chained).toMatchObject({ ownerUserId: s.ownerId, originRunId: originId, triggeredBy: 'agentdesk[bot]' });
  });

  it('a bot comment with no originating run is unlinked and starts nothing', async () => {
    const s = await seed();
    const h = harness();
    const e = botTriggerEvent(eventFor(s), BOT_AT);
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'ignored_owner_unlinked' });
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
  });

  describe('a bot comment on a PR that links to issues', () => {
    const prTicket = (linkedRefs: string[]): Ticket => ({ ...ticket(209), kind: 'pr', linkedRefs });
    const prEvent = (s: Seed) => botTriggerEvent(eventFor(s, { ticketRef: '209', ticketKind: 'pr' }), BOT_AT);

    it('is owned by the owner of the linked issue run while two other runs are active in the project', async () => {
      const s = await seed();
      const linked = await originRun(s, { ticketRef: '208' });
      const other = await originRun(s, { ticketRef: '207' });
      const h = harness({}, async (ref) => (ref === '209' ? prTicket(['208']) : ticket(Number(ref))));
      expect((await processTicketEvent(h.deps, prEvent(s), 'webhook')).outcome).toBe('run_created');
      const chained = (await runsOf(s)).find((r) => r.id !== linked && r.id !== other);
      expect(chained).toMatchObject({ ownerUserId: s.ownerId, originRunId: linked, ticketRef: '209' });
    });

    it('falls back to the time match when the PR cannot be fetched, and never throws', async () => {
      const failing = async (ref: string): Promise<Ticket> => {
        if (ref === '209') throw new Error('board down');
        return ticket(Number(ref));
      };
      const one = await seed();
      const only = await originRun(one, { ticketRef: '300' });
      const h1 = harness({}, failing);
      expect((await processTicketEvent(h1.deps, prEvent(one), 'webhook')).outcome).toBe('run_created');
      expect((await runsOf(one)).find((r) => r.id !== only)).toMatchObject({ originRunId: only });

      const two = await seed();
      await originRun(two, { ticketRef: '300' });
      await originRun(two, { ticketRef: '301' });
      const h2 = harness({}, failing);
      expect((await processTicketEvent(h2.deps, prEvent(two), 'webhook')).outcome).toBe('ignored_owner_unlinked');
    });
  });

  describe('the notice for a bot trigger whose owner cannot be detected', () => {
    it('is posted once on the ticket and starts no run', async () => {
      const s = await seed();
      const h = harness();
      const e = botTriggerEvent(eventFor(s), BOT_AT);
      expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'ignored_owner_unlinked' });
      expect(h.comment).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ repoPath: s.repoPath }),
        '7',
        OWNER_UNDETECTED_NOTICE,
      );
      expect(await runsOf(s)).toHaveLength(0);
      expect(h.startRun).not.toHaveBeenCalled();
    });

    it('is not posted twice when the same comment arrives again under another delivery id', async () => {
      const s = await seed();
      const h = harness();
      const first = botTriggerEvent(eventFor(s), BOT_AT);
      await processTicketEvent(h.deps, first, 'webhook');
      const again = { ...first, deliveryId: `d-${randomUUID()}` };
      expect((await processTicketEvent(h.deps, again, 'poll')).outcome).toBe('ignored_owner_unlinked');
      expect(h.comment).toHaveBeenCalledTimes(1);
    });

    it('is not posted for a human trigger, for a refused permission, or when a run starts', async () => {
      const stranger = await seed();
      const h1 = harness();
      const human = eventFor(stranger, { author: 'stranger', authorId: `stranger-${randomUUID()}` });
      expect((await processTicketEvent(h1.deps, human, 'webhook')).outcome).toBe('ignored_owner_unlinked');
      expect(h1.comment).not.toHaveBeenCalled();

      const viewer = await seed({ role: 'viewer' });
      await originRun(viewer);
      const h2 = harness();
      const denied = botTriggerEvent(eventFor(viewer), BOT_AT);
      expect((await processTicketEvent(h2.deps, denied, 'webhook')).outcome).toBe('ignored_owner_not_permitted');
      expect(h2.comment).not.toHaveBeenCalled();

      const ok = await seed();
      await originRun(ok);
      const h3 = harness();
      expect((await processTicketEvent(h3.deps, botTriggerEvent(eventFor(ok), BOT_AT), 'webhook')).outcome).toBe(
        'run_created',
      );
      expect(h3.comment).not.toHaveBeenCalled();
    });

    it('never changes the outcome when the board comment fails or hangs, and logs only the error name', async () => {
      const s = await seed();
      const warn = vi.fn();
      const h = harness({ log: { warn }, ticketTimeoutMs: 20 });
      h.comment.mockRejectedValueOnce(new Error('secret-looking detail'));
      expect(await processTicketEvent(h.deps, botTriggerEvent(eventFor(s), BOT_AT), 'webhook')).toEqual({
        outcome: 'ignored_owner_unlinked',
      });
      expect(warn).toHaveBeenCalledWith({ err: 'Error' }, 'owner notice not posted');

      h.comment.mockImplementationOnce(() => new Promise<string>(() => {}));
      expect((await processTicketEvent(h.deps, botTriggerEvent(eventFor(s), BOT_AT), 'webhook')).outcome).toBe(
        'ignored_owner_unlinked',
      );
      expect(warn).toHaveBeenCalledWith({ err: 'TicketFetchTimeoutError' }, 'owner notice not posted');
    });

    it('is not a command: the notice posted back is ignored and starts nothing', async () => {
      const s = await seed();
      const h = harness();
      const echo = { ...botTriggerEvent(eventFor(s), BOT_AT), body: OWNER_UNDETECTED_NOTICE };
      expect((await processTicketEvent(h.deps, echo, 'webhook')).outcome).toBe('ignored_no_command');
      expect(h.comment).not.toHaveBeenCalled();
    });
  });

  it('a bot comment whose originating run has no owner is unlinked', async () => {
    const s = await seed();
    await originRun(s, { ownerUserId: null });
    const h = harness();
    const e = botTriggerEvent(eventFor(s), BOT_AT);
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('ignored_owner_unlinked');
    expect(await runsOf(s)).toHaveLength(1);
  });

  it('a bot comment whose origin owner lost run:create is not permitted', async () => {
    const s = await seed({ role: 'viewer' });
    await originRun(s);
    const h = harness();
    const e = botTriggerEvent(eventFor(s), BOT_AT);
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('ignored_owner_not_permitted');
    expect(await runsOf(s)).toHaveLength(1);
  });

  it('a bot comment is matched by the comment time: a run that ended before it is not its origin', async () => {
    const s = await seed();
    await withOrg(db, s.orgId, async (tx) => {
      await tx.insert(runs).values({
        orgId: s.orgId,
        projectId: s.projectId,
        command: 'origin',
        ticketRef: '7',
        ticketKind: 'issue',
        checkoutRef: 'main',
        triggerSource: 'webhook',
        status: 'succeeded',
        ownerUserId: s.ownerId,
        startedAt: new Date(ORIGIN_START),
        finishedAt: new Date('2026-11-11T23:30:00Z'),
      });
    });
    const h = harness();
    const e = botTriggerEvent(eventFor(s), BOT_AT);
    expect((await processTicketEvent(h.deps, e, 'poll')).outcome).toBe('ignored_owner_unlinked');
  });

  it('a refused comment replayed (webhook, then poll) stays refused and is not retried into a run', async () => {
    const s = await seed({ role: 'viewer' });
    const h = harness();
    const first = eventFor(s);
    await processTicketEvent(h.deps, first, 'webhook');
    await processTicketEvent(h.deps, eventFor(s, { commentId: first.commentId }), 'poll');
    expect(await processTicketEvent(h.deps, first, 'webhook')).toEqual({ outcome: 'duplicate' });
    expect(await outcomes(s)).toEqual(['ignored_owner_not_permitted', 'ignored_owner_not_permitted']);
    expect(await runsOf(s)).toHaveLength(0);
  });
});

describe('processTicketEvent races and errors', () => {
  it('same comment, different deliveries, concurrently: exactly one run (20 rounds, both channel mixes)', async () => {
    const s = await seed();
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      const commentId = `race-${i}`;
      const a = eventFor(s, { commentId, ticketRef: String(500 + i) });
      const b = eventFor(s, { commentId, ticketRef: String(500 + i) });
      const channels: ['webhook' | 'poll', 'webhook' | 'poll'] =
        i % 2 === 0 ? ['webhook', 'poll'] : ['webhook', 'webhook'];
      const results = await Promise.all([
        processTicketEvent(h.deps, a, channels[0]),
        processTicketEvent(h.deps, b, channels[1]),
      ]);
      expect(results.map((r) => r.outcome).sort(), `round ${i}`).toEqual(['duplicate_comment', 'run_created']);
    }
    expect(await runsOf(s)).toHaveLength(20);
    expect(h.startRun).toHaveBeenCalledTimes(20);
  });

  it('isUniqueViolation only matches the named constraint when one is given', () => {
    const err = (constraint: string) => Object.assign(new Error('x'), { cause: { code: '23505', constraint } });
    expect(isUniqueViolation(err('runs_project_trigger_comment_key'), 'runs_project_trigger_comment_key')).toBe(true);
    expect(isUniqueViolation(err('runs_project_number_key'), 'runs_project_trigger_comment_key')).toBe(false);
    expect(isUniqueViolation(err('runs_project_number_key'))).toBe(true);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });

  it('a routing error is recorded as outcome error (name only), creates no run, and does not throw', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const log = { warn: vi.fn() };
    const h = harness({ log }, async () => {
      throw new TypeError('secret detail that must not be stored');
    });
    const e = eventFor(s);
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'error' });
    const rows = await inboundOf(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'error', detail: 'TypeError', author: s.author, ticketRef: '7' });
    expect(JSON.stringify(rows[0])).not.toContain('secret detail');
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { deliveryId: e.deliveryId, projectId: s.projectId, err: 'TypeError' },
      expect.any(String),
    );
    // a different delivery of the same comment (the poller) can still create the run once the board recovers
    const retry = harness();
    expect((await processTicketEvent(retry.deps, eventFor(s, { commentId: e.commentId }), 'poll')).outcome).toBe(
      'run_created',
    );
  });

  it('a pull request without a known number is not run against refs/pull/0/head', async () => {
    const s = await seed();
    const h = harness({}, async () => {
      throw new Error('board unavailable');
    });
    const r = await processTicketEvent(h.deps, eventFor(s, { ticketRef: 'abc', ticketKind: 'pr' }), 'webhook');
    expect(r.outcome).toBe('ignored_target');
    expect(await runsOf(s)).toHaveLength(0);
  });
});

describe('processTicketEvent: linked issue refs', () => {
  const prTicket = (n: number, linkedRefs: string[]): Ticket => ({
    ...ticket(n),
    ref: String(n),
    kind: 'pr',
    linkedRefs,
  });
  const prEvent = (s: Seed, n: number): TicketEvent => eventFor(s, { ticketRef: String(n), ticketKind: 'pr' });
  const issueEvent = (s: Seed, n: number): TicketEvent => eventFor(s, { ticketRef: String(n), ticketKind: 'issue' });
  const finishRuns = (s: Seed) =>
    withOrg(db, s.orgId, (tx) => tx.update(runs).set({ status: 'succeeded' }).where(eq(runs.projectId, s.projectId)));

  it('a PR run stores linked_issue_refs from the prefetched ticket', async () => {
    const s = await seed();
    const h = harness({}, async (ref) => prTicket(Number(ref), ['150', '142']));
    expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run?.linkedIssueRefs).toEqual(['142', '150']);
  });

  it("an issue run stores '{}' even when its ticket has linkedRefs", async () => {
    const s = await seed();
    const h = harness({}, async (ref) => ({ ...ticket(Number(ref)), linkedRefs: ['5', '6'] }));
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run?.linkedIssueRefs).toEqual([]);
  });

  it('stored refs are positive integers only, deduplicated and capped at 10', async () => {
    const s = await seed();
    const more = Array.from({ length: 12 }, (_, i) => String(200 + i));
    const h = harness({}, async (ref) =>
      prTicket(Number(ref), ['acme/other#5', '0', '-1', 'x', '142', '142', ...more]),
    );
    expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run?.linkedIssueRefs).toEqual(['142', ...more.slice(0, 9)]);
    expect(JSON.stringify(run?.linkedIssueRefs)).not.toContain('acme/other#5');
  });

  it("a failed lookup still starts the PR run, with '{}'", async () => {
    const s = await seed();
    const log = { warn: vi.fn() };
    const h = harness({ log }, async () => {
      throw new Error('secret ticket text');
    });
    expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run?.linkedIssueRefs).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith({ err: 'Error' }, expect.any(String));
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('secret ticket text');
  });

  it("a lookup slower than ticketTimeoutMs still starts the PR run, with '{}'", async () => {
    const s = await seed();
    const log = { warn: vi.fn() };
    const h = harness({ log, ticketTimeoutMs: 50 }, () => new Promise<Ticket>(() => undefined));
    expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run?.linkedIssueRefs).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith({ err: 'TicketFetchTimeoutError' }, expect.any(String));
  });

  it('the run limit stays per ref', async () => {
    const s = await seed({ maxRunsPerTicket: 2 });
    const h = harness({}, async (ref) => (ref === '148' ? prTicket(148, ['142']) : ticket(Number(ref))));
    // issue 142 has 1 run while PR 148, linked to it, reaches its own limit
    expect((await processTicketEvent(h.deps, issueEvent(s, 142), 'webhook')).outcome).toBe('run_created');
    for (let i = 0; i < 2; i++) {
      expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('run_created');
      await finishRuns(s);
    }
    expect((await processTicketEvent(h.deps, prEvent(s, 148), 'webhook')).outcome).toBe('ignored_max_runs');
    expect((await processTicketEvent(h.deps, issueEvent(s, 142), 'webhook')).outcome).toBe('run_created');

    // the reverse: issue 142 at its limit, PR 148 at 1 run
    const t = await seed({ maxRunsPerTicket: 2 });
    expect((await processTicketEvent(h.deps, prEvent(t, 148), 'webhook')).outcome).toBe('run_created');
    for (let i = 0; i < 2; i++) {
      expect((await processTicketEvent(h.deps, issueEvent(t, 142), 'webhook')).outcome).toBe('run_created');
      await finishRuns(t);
    }
    expect((await processTicketEvent(h.deps, issueEvent(t, 142), 'webhook')).outcome).toBe('ignored_max_runs');
    expect((await processTicketEvent(h.deps, prEvent(t, 148), 'webhook')).outcome).toBe('run_created');
  });
});

describe('processTicketEvent: the ticket fetch holds no database connection', () => {
  /** Connections checked out of the app pool right now (the intake runs alone in these tests). */
  const busy = (): number => db.pool.totalCount - db.pool.idleCount;

  it('fetches the ticket before the routing transaction opens, once, for a run', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const seen: number[] = [];
    const h = harness({}, async (ref) => {
      seen.push(busy());
      return ticket(Number(ref));
    });
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    expect(seen).toEqual([0]);
    const [run] = await runsOf(s);
    expect(run).toMatchObject({ ticketTitle: 'Ticket 7', ticketUrl: 'http://fake.invalid/issues/7' });
  });

  it('does not call the provider for events that cannot run (no command, unauthorized, no rule, same comment)', async () => {
    const s = await seed();
    const h = harness();
    await processTicketEvent(h.deps, eventFor(s, { body: 'just chatting' }), 'webhook');
    await processTicketEvent(h.deps, eventFor(s, { authorAssociation: 'NONE' }), 'webhook');
    await processTicketEvent(h.deps, eventFor(s, { body: '/unknown-cmd' }), 'webhook');
    expect(h.getTicket).not.toHaveBeenCalled();
    const first = eventFor(s);
    expect((await processTicketEvent(h.deps, first, 'webhook')).outcome).toBe('run_created');
    expect(h.getTicket).toHaveBeenCalledTimes(1);
    expect((await processTicketEvent(h.deps, first, 'webhook')).outcome).toBe('duplicate');
    expect((await processTicketEvent(h.deps, eventFor(s, { commentId: first.commentId }), 'poll')).outcome).toBe(
      'duplicate_comment',
    );
    expect(h.getTicket).toHaveBeenCalledTimes(1);
  });

  it('a ticket fetch that hangs is bounded: the run is still created without the snapshot', async () => {
    const s = await seed();
    const h = harness({ ticketTimeoutMs: 50 }, () => new Promise<Ticket>(() => undefined));
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run).toMatchObject({ ticketTitle: null, ticketUrl: null, ticketKind: 'issue', ticketNumber: 7 });
  });

  it('a hanging fetch the router needs (label filter) is a routing error, recorded by name', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const h = harness({ ticketTimeoutMs: 50 }, () => new Promise<Ticket>(() => undefined));
    expect(await processTicketEvent(h.deps, eventFor(s), 'webhook')).toEqual({ outcome: 'error' });
    const [row] = await inboundOf(s);
    expect(row).toMatchObject({ outcome: 'error', detail: 'TicketFetchTimeoutError' });
  });
});

describe('startRunWorkflow and sweepOutbox', () => {
  const starter = (impl: WorkflowStarter['start']) => {
    const start = vi.fn(impl);
    return { start, starter: { start } satisfies WorkflowStarter };
  };

  it('start failure leaves the run queued; the sweep starts it later and records workflow_id', async () => {
    const s = await seed();
    const failing = starter(async () => {
      throw new Error('temporal down');
    });
    const log = { warn: vi.fn() };
    const h = harness({ startRun: (o, r) => startRunWorkflow(failing.starter, db, o, r, log).then(() => {}) });
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    expect((await runsOf(s))[0]).toMatchObject({ status: 'queued', workflowId: null });
    expect(log.warn).toHaveBeenCalledTimes(1);

    const ok = starter(async () => ({}));
    // too young: nothing to do (the cut-off is evaluated by the database clock)
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(0);
    // "+31 s": age the run in the database instead of sleeping
    await withOrg(db, s.orgId, (tx) =>
      tx
        .update(runs)
        .set({ queuedAt: sql`queued_at - interval '31 seconds'` })
        .where(eq(runs.id, r.runId ?? '')),
    );
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(1);
    expect(ok.start).toHaveBeenCalledWith('RunWorkflow', {
      taskQueue: 'agentdesk',
      workflowId: `run-${r.runId}`,
      args: [{ orgId: s.orgId, runId: r.runId }],
    });
    expect((await runsOf(s))[0]?.workflowId).toBe(`run-${r.runId}`);
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(0);
  });

  it('a failing workflow_id update is logged, not thrown', async () => {
    const ok = starter(async () => ({}));
    const log = { warn: vi.fn() };
    // a db whose transactions fail; only withOrg's db.orm.transaction is reached
    const broken = { orm: { transaction: async () => Promise.reject(new Error('db down')) } } as unknown as Db;
    expect(await startRunWorkflow(ok.starter, broken, randomUUID(), randomUUID(), log)).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('treats WorkflowExecutionAlreadyStarted as success and records workflow_id', async () => {
    const s = await seed();
    const h = harness();
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    const dup = starter(async () => {
      throw new WorkflowExecutionAlreadyStartedError('exists', `run-${r.runId}`, 'RunWorkflow');
    });
    expect(await startRunWorkflow(dup.starter, db, s.orgId, r.runId ?? '')).toBe(true);
    expect((await runsOf(s))[0]?.workflowId).toBe(`run-${r.runId}`);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agents, connections, createDb, projects, rules, withOrg, type Db, type Tx } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { eq } from 'drizzle-orm';
import { orgChecklist } from '../../src';

let pgServer: TestPg;
let db: Db;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
}, 180_000);
afterAll(async () => {
  await db.close();
  await pgServer.stop();
});

const KEYS = ['connect_code_host', 'create_project', 'add_agent', 'add_rule'];
let tick = 0;

async function addConnection(
  tx: Tx,
  orgId: string,
  o: { code: boolean; board: boolean; status?: string },
): Promise<string> {
  const [c] = await tx
    .insert(connections)
    .values({
      orgId,
      provider: 'fake',
      externalId: `fake-${randomUUID()}`,
      accountName: 'acme',
      capabilities: { code: o.code, board: o.board },
      status: o.status ?? 'active',
    })
    .returning({ id: connections.id });
  return c!.id;
}

/** createdAt grows with each call so "newest" is deterministic. */
async function addProject(tx: Tx, orgId: string, connId: string): Promise<string> {
  tick += 1;
  const [p] = await tx
    .insert(projects)
    .values({
      orgId,
      name: `p${tick}`,
      repoPath: `acme/${randomUUID()}`,
      codeConnectionId: connId,
      boardConnectionId: connId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)),
    })
    .returning({ id: projects.id });
  return p!.id;
}

async function addAgent(tx: Tx, orgId: string, projectId: string, credential: string | null): Promise<string> {
  const [a] = await tx
    .insert(agents)
    .values({ orgId, projectId, name: `a-${randomUUID()}`, model: 'm', credentialSecretName: credential })
    .returning({ id: agents.id });
  return a!.id;
}

async function addRule(tx: Tx, orgId: string, projectId: string, agentId: string): Promise<void> {
  await tx.insert(rules).values({ orgId, projectId, agentId, command: `c-${randomUUID()}`, prompt: 'do it' });
}

const done = (c: { steps: { key: string; done: boolean }[] }): boolean[] => c.steps.map((s) => s.done);

describe('orgChecklist', () => {
  it('an empty org has four steps, none done', async () => {
    const orgId = randomUUID();
    const c = await withOrg(db, orgId, (tx) => orgChecklist(tx, []));
    expect(c.steps.map((s) => s.key)).toEqual(KEYS);
    expect(done(c)).toEqual([false, false, false, false]);
    expect(c.complete).toBe(false);
    expect(c.projectId).toBeNull();
  });

  it('an active code connection marks connect_code_host; an inactive or board-only one does not', async () => {
    const orgId = randomUUID();
    const c = await withOrg(db, orgId, async (tx) => {
      await addConnection(tx, orgId, { code: true, board: false, status: 'suspended' });
      await addConnection(tx, orgId, { code: false, board: true });
      const before = await orgChecklist(tx, []);
      await addConnection(tx, orgId, { code: true, board: false });
      return { before, after: await orgChecklist(tx, []) };
    });
    expect(done(c.before)[0]).toBe(false);
    expect(done(c.after)[0]).toBe(true);
  });

  it('a project with no credential and no rule is the focus; add_agent and add_rule are not done', async () => {
    const orgId = randomUUID();
    const { p, c } = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p = await addProject(tx, orgId, conn);
      await addAgent(tx, orgId, p, null);
      return { p, c: await orgChecklist(tx, [p]) };
    });
    expect(done(c)).toEqual([true, true, false, false]);
    expect(c.projectId).toBe(p);
    expect(c.complete).toBe(false);
  });

  it('BR-14: a credential marks add_agent, a rule marks add_rule, both complete it', async () => {
    const orgId = randomUUID();
    const r = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p = await addProject(tx, orgId, conn);
      const a = await addAgent(tx, orgId, p, null);
      await tx.update(agents).set({ credentialSecretName: 'secret-a' }).where(eq(agents.id, a));
      const withCred = await orgChecklist(tx, [p]);
      await addRule(tx, orgId, p, a);
      const both = await orgChecklist(tx, [p]);
      return { withCred, both };
    });
    expect(done(r.withCred)).toEqual([true, true, true, false]);
    expect(r.withCred.complete).toBe(false);
    expect(done(r.both)).toEqual([true, true, true, true]);
    expect(r.both.complete).toBe(true);
  });

  it('a rule alone marks add_rule only', async () => {
    const orgId = randomUUID();
    const c = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p = await addProject(tx, orgId, conn);
      const a = await addAgent(tx, orgId, p, null);
      await addRule(tx, orgId, p, a);
      return orgChecklist(tx, [p]);
    });
    expect(done(c)).toEqual([true, true, false, true]);
  });

  it('BR-16: steps split across two projects do not complete the checklist', async () => {
    const orgId = randomUUID();
    const c = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p1 = await addProject(tx, orgId, conn);
      const p2 = await addProject(tx, orgId, conn);
      await addAgent(tx, orgId, p1, 'secret-1');
      const a2 = await addAgent(tx, orgId, p2, null);
      await addRule(tx, orgId, p2, a2);
      return orgChecklist(tx, [p1, p2]);
    });
    expect(c.complete).toBe(false);
    expect(c.steps.filter((s) => s.key === 'add_agent' || s.key === 'add_rule').filter((s) => s.done)).toHaveLength(1);
  });

  it('a complete project completes the checklist even when another project is empty', async () => {
    const orgId = randomUUID();
    const { p1, c } = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p1 = await addProject(tx, orgId, conn);
      const a = await addAgent(tx, orgId, p1, 'secret-1');
      await addRule(tx, orgId, p1, a);
      const p2 = await addProject(tx, orgId, conn); // newer, empty
      return { p1, c: await orgChecklist(tx, [p1, p2]) };
    });
    expect(c.complete).toBe(true);
    expect(c.projectId).toBe(p1);
  });

  it('ties go to the newest project', async () => {
    const orgId = randomUUID();
    const { p2, c } = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p1 = await addProject(tx, orgId, conn);
      const p2 = await addProject(tx, orgId, conn);
      return { p2, c: await orgChecklist(tx, [p1, p2]) };
    });
    expect(c.projectId).toBe(p2);
  });

  it('without an id list every project of the org counts', async () => {
    const orgId = randomUUID();
    const { p1, c } = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const p1 = await addProject(tx, orgId, conn);
      await addProject(tx, orgId, conn); // newer, empty
      const a = await addAgent(tx, orgId, p1, 'secret-1');
      await addRule(tx, orgId, p1, a);
      return { p1, c: await orgChecklist(tx) };
    });
    expect(done(c)).toEqual([true, true, true, true]);
    expect(c.complete).toBe(true);
    expect(c.projectId).toBe(p1);
  });

  it('only visible projects count', async () => {
    const orgId = randomUUID();
    const c = await withOrg(db, orgId, async (tx) => {
      const conn = await addConnection(tx, orgId, { code: true, board: true });
      const hidden = await addProject(tx, orgId, conn);
      const a = await addAgent(tx, orgId, hidden, 'secret-1');
      await addRule(tx, orgId, hidden, a);
      const visible = await addProject(tx, orgId, conn);
      return orgChecklist(tx, [visible]);
    });
    expect(c.complete).toBe(false);
    expect(done(c)).toEqual([true, true, false, false]);
  });
});

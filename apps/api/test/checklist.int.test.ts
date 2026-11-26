import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agents, withOrg } from '@agentdesk/db';
import type { AgentDto, OrgChecklistDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let orgId: string;
let otherOrgId: string;
let owner: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  orgId = (await createOrg(t, 'Check Org', 'check-org')).id;
  otherOrgId = (await createOrg(t, 'Check Other', 'check-other')).id;
  owner = await inviteAndLogin(t, orgId, 'check-owner', 'owner', { type: 'org' });
});
afterAll(async () => {
  await t.close();
});

const checklist = (cookie: string, id = orgId) =>
  t.app.inject({ method: 'GET', url: `/api/orgs/${id}/checklist`, headers: { cookie } });
const read = async (cookie = owner, id = orgId): Promise<OrgChecklistDto> => {
  const res = await checklist(cookie, id);
  expect(res.statusCode).toBe(200);
  return expectContract('orgs.checklist', res) as OrgChecklistDto;
};
const done = (c: OrgChecklistDto) => c.steps.filter((s) => s.done).map((s) => s.key);

/** An org of its own with a signed-in owner and a connected code host, so a test never depends on another test's state. */
async function freshOrg(slug: string): Promise<{ id: string; owner: string; connectionId: string }> {
  const id = (await createOrg(t, slug, slug)).id;
  const ownerCookie = await inviteAndLogin(t, id, `${slug}-owner`, 'owner', { type: 'org' });
  return { id, owner: ownerCookie, connectionId: await installFake(t, ownerCookie) };
}

async function addAgent(ownerCookie: string, projectId: string): Promise<void> {
  const agent = (
    await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/agent`, headers: { cookie: ownerCookie } })
  ).json() as AgentDto;
  const cred = await t.app.inject({
    method: 'PUT',
    url: `/api/agents/${agent.id}/credential`,
    headers: { cookie: ownerCookie },
    payload: { type: 'api_key', value: 'sk-test-value' },
  });
  expect(cred.statusCode).toBe(200);
}

async function addRule(ownerCookie: string, projectId: string, command: string): Promise<void> {
  await t.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/skills/fix`,
    headers: { cookie: ownerCookie },
    payload: { body: 'x', message: 'm' },
  });
  const rule = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/rules`,
    headers: { cookie: ownerCookie },
    payload: { kind: 'skill', command, labelFilter: [], target: 'issue', skillName: 'fix', enabled: true },
  });
  expect(rule.statusCode).toBe(201);
}

describe('org checklist', () => {
  it('BR-38: a fresh org whose first owner joined has all four steps not done', async () => {
    const c = await read();
    expect(c.complete).toBe(false);
    expect(c.projectId).toBeNull();
    expect(c.steps.map((s) => s.key)).toEqual(['connect_code_host', 'create_project', 'add_agent', 'add_rule']);
    expect(done(c)).toEqual([]);
  });

  it('BR-13, BR-14: each step turns done as the owner does it, and the org completes with one full project', async () => {
    const connectionId = await installFake(t, owner);
    expect(done(await read())).toEqual(['connect_code_host']);

    const { projectId } = await makeProject(t, owner, connectionId);
    const afterProject = await read();
    expect(done(afterProject)).toEqual(['connect_code_host', 'create_project']);
    expect(afterProject.projectId).toBe(projectId);

    await t.app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/skills/fix`,
      headers: { cookie: owner },
      payload: { body: 'x', message: 'm' },
    });
    const agent = (
      await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/agent`, headers: { cookie: owner } })
    ).json() as AgentDto;
    await t.app.inject({
      method: 'PUT',
      url: `/api/agents/${agent.id}/credential`,
      headers: { cookie: owner },
      payload: { type: 'api_key', value: 'sk-test-value' },
    });
    expect(done(await read())).toEqual(['connect_code_host', 'create_project', 'add_agent']);

    await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/rules`,
      headers: { cookie: owner },
      payload: { kind: 'skill', command: 'one', labelFilter: [], target: 'issue', skillName: 'fix', enabled: true },
    });
    const full = await read();
    expect(full.complete).toBe(true);
    expect(done(full)).toHaveLength(4);
  });

  it('add_agent: the placeholder is not done; a default with a credential is; a default OpenCode agent with none is (BR-68)', async () => {
    const org = await freshOrg('check-agent-kinds');
    const { projectId } = await makeProject(t, org.owner, org.connectionId);
    const stepDone = async () => done(await read(org.owner, org.id)).includes('add_agent');
    expect(await stepDone()).toBe(false);
    await addAgent(org.owner, projectId);
    expect(await stepDone()).toBe(true);
    await withOrg(t.db, org.id, (tx) =>
      tx
        .update(agents)
        .set({ credentialSecretName: null, credentialType: null, credentialUpdatedAt: null, credentialSetBy: null })
        .where(eq(agents.projectId, projectId)),
    );
    expect(await stepDone()).toBe(false);
    await withOrg(t.db, org.id, (tx) =>
      tx.update(agents).set({ provider: 'opencode', model: '' }).where(eq(agents.projectId, projectId)),
    );
    expect(await stepDone()).toBe(true);
  });

  it('BR-16: a second project does not undo completion', async () => {
    const org = await freshOrg('check-second');
    const first = await makeProject(t, org.owner, org.connectionId);
    await addAgent(org.owner, first.projectId);
    await addRule(org.owner, first.projectId, 'one');
    expect((await read(org.owner, org.id)).complete).toBe(true);
    await makeProject(t, org.owner, org.connectionId);
    const c = await read(org.owner, org.id);
    expect(c.complete).toBe(true);
    expect(c.projectId).toBe(first.projectId);
  });

  it('BR-16: two projects each with an agent and a rule is complete', async () => {
    const org = await freshOrg('check-both');
    for (const command of ['one', 'two']) {
      const { projectId } = await makeProject(t, org.owner, org.connectionId);
      await addAgent(org.owner, projectId);
      await addRule(org.owner, projectId, command);
    }
    const c = await read(org.owner, org.id);
    expect(c.complete).toBe(true);
    expect(c.projectId).not.toBeNull();
  });

  it('BR-16: steps split across two projects are not complete', async () => {
    const org = await freshOrg('check-split');
    const withAgent = await makeProject(t, org.owner, org.connectionId);
    await addAgent(org.owner, withAgent.projectId);
    const withRule = await makeProject(t, org.owner, org.connectionId);
    await addRule(org.owner, withRule.projectId, 'split');
    const c = await read(org.owner, org.id);
    expect(c.complete).toBe(false);
    // The checklist follows one focus project (the newest on a tie), so only that project's own step is done.
    expect(c.projectId).toBe(withRule.projectId);
    expect(done(c)).toEqual(['connect_code_host', 'create_project', 'add_rule']);
  });

  it('BR-17: an org admin gets 200; a project admin, a member and a viewer get 403', async () => {
    const connectionId = await installFake(t, owner);
    const { projectId } = await makeProject(t, owner, connectionId);
    const admin = await inviteAndLogin(t, orgId, 'check-admin', 'admin', { type: 'org' });
    const projectAdmin = await inviteAndLogin(t, orgId, 'check-padmin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const member = await inviteAndLogin(t, orgId, 'check-member', 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, orgId, 'check-viewer', 'viewer', { type: 'org' });
    expect((await checklist(admin)).statusCode).toBe(200);
    expect((await checklist(projectAdmin)).statusCode).toBe(403);
    expect((await checklist(member)).statusCode).toBe(403);
    expect((await checklist(viewer)).statusCode).toBe(403);
  });

  it("another org's id in the path is 404", async () => {
    expect((await checklist(owner, otherOrgId)).statusCode).toBe(404);
  });
});

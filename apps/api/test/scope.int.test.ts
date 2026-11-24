import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runs, runUsageEntries, setupTests, withOrg } from '@agentdesk/db';
import {
  flattenRoutes,
  routeAccess,
  routes,
  type AccessDto,
  type AgentDto,
  type Page,
  type ProjectDto,
  type RoleDto,
  type RouteKey,
  type RuleDto,
  type RunDto,
  type RunListResponse,
} from '@agentdesk/contracts';
import { ProjectsService } from '../src/projects/projects.service';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { makeUsageEntry } from './helpers/usage';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

/**
 * Project scope of the caller (BR-27, BR-28, BR-42, BR-44). Cast: O org owner, A admin on P1, B member on P1 and P2,
 * V org viewer. Projects P1, P2, P3, with a finished run in P1 and in P2. The deletion test (BR-44) runs last: it removes P2.
 */
let t: TestApp;
let orgId: string;
let owner: string;
let adm: string;
let mem: string;
let vw: string;
let p1: string;
let p2: string;
let p3: string;
let connectionId: string;
let runP1: string;
let runP2: string;
let runP2Number: number;
let agentP2: string;
let ruleP2: string;
let setupTestP2: string;
let memUserId: string;
let memberRoleId: string;

async function seedRun(projectId: string, ref: string): Promise<{ id: string; number: number }> {
  return withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId,
        projectId,
        command: 'fix',
        skillName: 'fix',
        ticketRef: ref,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        // a finished run, so removing its project is not refused for live runs
        status: 'succeeded',
      })
      .returning({ id: runs.id, number: runs.number });
    if (!row) throw new Error('no run');
    await tx.insert(runUsageEntries).values({ ...makeUsageEntry(), orgId, runId: row.id });
    return row;
  });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const send = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

const listOf = async (cookie: string, query = ''): Promise<Page<ProjectDto>> =>
  expectContract('projects.list', await send('GET', `/api/projects${query}`, cookie)) as Page<ProjectDto>;

const ids = (page: Page<ProjectDto>): string[] => page.items.map((p) => p.id).sort();

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  orgId = (await createOrg(t, 'Scope', 'scope-int')).id;
  owner = await inviteAndLogin(t, orgId, 'sco-owner', 'owner', { type: 'org' });
  connectionId = await installFake(t, owner);
  p1 = (await makeProject(t, owner, connectionId)).projectId;
  p2 = (await makeProject(t, owner, connectionId)).projectId;
  p3 = (await makeProject(t, owner, connectionId)).projectId;
  adm = await inviteAndLogin(t, orgId, 'sco-adm', 'admin', { type: 'project', projectIds: [p1] });
  mem = await inviteAndLogin(t, orgId, 'sco-mem', 'member', { type: 'project', projectIds: [p1, p2] });
  vw = await inviteAndLogin(t, orgId, 'sco-vw', 'viewer', { type: 'org' });
  memUserId = await userIdOf(t, 'sco-mem');
  const rolesRes = await send('GET', `/api/orgs/${orgId}/roles`, owner);
  const memberRole = rolesRes.json<RoleDto[]>().find((r) => r.key === 'member');
  if (!memberRole) throw new Error('no member role');
  memberRoleId = memberRole.id;
  runP1 = (await seedRun(p1, 'sco-1')).id;
  const r2 = await seedRun(p2, 'sco-2');
  runP2 = r2.id;
  runP2Number = r2.number;
  // P2's agent, a rule and a setup test: the id-keyed routes need a row that really belongs to P2, so a 404 is scope.
  agentP2 = (expectContract('agents.get', await send('GET', `/api/projects/${p2}/agent`, owner)) as AgentDto).id;
  const ruleRes = await send('POST', `/api/projects/${p2}/rules`, owner, {
    kind: 'prompt',
    command: 'scope-rule',
    labelFilter: [],
    target: 'issue',
    enabled: true,
    prompt: 'Say hello.',
  });
  ruleP2 = (expectContract('rules.create', ruleRes) as RuleDto).id;
  setupTestP2 = await withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(setupTests)
      .values({ orgId, projectId: p2, status: 'ended', scriptSha256: 'sha-not-real', startedBy: 'sco-owner' })
      .returning({ id: setupTests.id });
    if (!row) throw new Error('no setup test');
    return row.id;
  });
});
afterAll(async () => {
  await t.close();
});

describe('BR-27: the project list shows only projects in scope', () => {
  it('lists P1 only, with total 1, for an admin on P1', async () => {
    const page = await listOf(adm);
    expect(ids(page)).toEqual([p1]);
    expect(page.total).toBe(1);
  });

  it('lists P1 and P2, with total 2, for a member on both', async () => {
    const page = await listOf(mem);
    expect(ids(page)).toEqual([p1, p2].sort());
    expect(page.total).toBe(2);
  });

  it('pages the scoped list: one item per page and total 2 on both pages', async () => {
    const first = await listOf(mem, '?pageSize=1&page=1');
    const second = await listOf(mem, '?pageSize=1&page=2');
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect([...ids(first), ...ids(second)].sort()).toEqual([p1, p2].sort());
  });

  it('lists every project, with total 3, for an org viewer (org scope covers all)', async () => {
    const page = await listOf(vw);
    expect(ids(page)).toEqual([p1, p2, p3].sort());
    expect(page.total).toBe(3);
  });

  it('lists every project for the org owner', async () => {
    expect((await listOf(owner)).total).toBe(3);
  });
});

describe('BR-28: a project outside the caller scope is 404', () => {
  const flat = flattenRoutes(routes);
  type Case = [string, Method, string, object | undefined];
  const cases = (): Case[] => [
    ['projects.get', 'GET', `/api/projects/${p2}`, undefined],
    ['projects.update', 'PATCH', `/api/projects/${p2}`, { name: 'Renamed' }],
    ['projects.connection', 'GET', `/api/projects/${p2}/connection`, undefined],
    ['projects.pollNow', 'POST', `/api/projects/${p2}/connection/poll`, undefined],
    ['projects.ignored', 'GET', `/api/projects/${p2}/ignored`, undefined],
    ['projects.events', 'GET', `/api/projects/${p2}/events`, undefined],
    ['agents.get', 'GET', `/api/projects/${p2}/agent`, undefined],
    ['agents.put', 'PUT', `/api/projects/${p2}/agent`, { model: 'sonnet', timeoutSeconds: 3600 }],
    [
      'agents.putCredential',
      'PUT',
      `/api/agents/${agentP2}/credential`,
      { type: 'api_key', value: 'test-key-not-real' },
    ],
    ['agents.models', 'GET', `/api/agents/${agentP2}/models`, undefined],
    ['skills.list', 'GET', `/api/projects/${p2}/skills`, undefined],
    ['skills.get', 'GET', `/api/projects/${p2}/skills/fix`, undefined],
    ['skills.put', 'PUT', `/api/projects/${p2}/skills/fix`, { body: 'x', message: 'edit' }],
    ['skills.remove', 'DELETE', `/api/projects/${p2}/skills/fix`, undefined],
    ['rules.list', 'GET', `/api/projects/${p2}/rules`, undefined],
    [
      'rules.create',
      'POST',
      `/api/projects/${p2}/rules`,
      { kind: 'prompt', command: 'other-rule', labelFilter: [], target: 'issue', enabled: true, prompt: 'Hi.' },
    ],
    ['rules.update', 'PATCH', `/api/rules/${ruleP2}`, { enabled: false }],
    ['rules.promptPreview', 'GET', `/api/projects/${p2}/rules/prompt-preview`, undefined],
    ['rules.remove', 'DELETE', `/api/rules/${ruleP2}`, undefined],
    ['setupScript.get', 'GET', `/api/projects/${p2}/setup-script`, undefined],
    ['setupScript.put', 'PUT', `/api/projects/${p2}/setup-script`, { body: 'echo hi', baseVersion: null }],
    ['setupScript.versions', 'GET', `/api/projects/${p2}/setup-script/versions`, undefined],
    ['setupScript.version', 'GET', `/api/projects/${p2}/setup-script/versions/1`, undefined],
    ['projectEnv.list', 'GET', `/api/projects/${p2}/env`, undefined],
    ['projectEnv.createVar', 'POST', `/api/projects/${p2}/env-vars`, { name: 'OTHER_VAR', value: 'x' }],
    ['projectEnv.updateVar', 'PUT', `/api/projects/${p2}/env-vars/OTHER_VAR`, { value: 'x' }],
    ['projectEnv.removeVar', 'DELETE', `/api/projects/${p2}/env-vars/OTHER_VAR`, undefined],
    [
      'projectEnv.createSecret',
      'POST',
      `/api/projects/${p2}/env-secrets`,
      { name: 'OTHER_SECRET', value: 'other-secret' },
    ],
    ['projectEnv.updateSecret', 'PUT', `/api/projects/${p2}/env-secrets/OTHER_SECRET`, { value: 'other-secret' }],
    ['projectEnv.removeSecret', 'DELETE', `/api/projects/${p2}/env-secrets/OTHER_SECRET`, undefined],
    ['setup.plugins', 'GET', `/api/projects/${p2}/plugins`, undefined],
    ['setupTests.create', 'POST', `/api/projects/${p2}/setup-tests`, { script: 'echo hi' }],
    ['setupTests.latest', 'GET', `/api/projects/${p2}/setup-tests/latest`, undefined],
    ['setupTests.end', 'POST', `/api/setup-tests/${setupTestP2}/end`, undefined],
    ['setupTests.events', 'GET', `/api/setup-tests/${setupTestP2}/events`, undefined],
    ['runs.list', 'GET', `/api/projects/${p2}/runs`, undefined],
    ['runs.stats', 'GET', `/api/projects/${p2}/runs/stats?since=2020-01-01T00:00:00.000Z`, undefined],
    ['tickets.prStates', 'GET', `/api/projects/${p2}/tickets/pr-states?ref=1`, undefined],
    ['runs.byNumber', 'GET', `/api/projects/${p2}/runs/${runP2Number}`, undefined],
    ['runs.get', 'GET', `/api/runs/${runP2}`, undefined],
    ['runs.log', 'GET', `/api/runs/${runP2}/log`, undefined],
    ['runs.cancel', 'POST', `/api/runs/${runP2}/cancel`, undefined],
    ['runs.finish', 'POST', `/api/runs/${runP2}/finish`, undefined],
    ['runs.resume', 'POST', `/api/runs/${runP2}/resume`, undefined],
    ['runs.stop', 'POST', `/api/runs/${runP2}/stop`, undefined],
    ['runs.closeSession', 'POST', `/api/runs/${runP2}/close-session`, undefined],
    ['runs.transcript', 'GET', `/api/runs/${runP2}/transcript`, undefined],
    ['runs.events', 'GET', `/api/runs/${runP2}/events`, undefined],
    ['projectMembers.list', 'GET', `/api/projects/${p2}/members`, undefined],
    ['projectMembers.add', 'POST', `/api/projects/${p2}/members`, { userId: memUserId, roleId: memberRoleId }],
    ['projectMembers.setRole', 'PUT', `/api/projects/${p2}/members/${memUserId}/role`, { roleId: memberRoleId }],
    ['projectMembers.remove', 'DELETE', `/api/projects/${p2}/members/${memUserId}`, undefined],
    ['projects.audit', 'GET', `/api/projects/${p2}/audit`, undefined],
  ];
  // Exclusions: WebSocket upgrades cannot be driven through inject; their out-of-scope close codes are tested in terminal.int.test.ts.
  const excluded: Record<string, string> = {
    'projects.remove': 'project:delete is org-level, so no project-scoped caller holds it: 403 for them, see below',
    'runs.terminal': 'WebSocket upgrade: close code covered in terminal.int.test.ts',
    'setupTests.terminal': 'WebSocket upgrade: close code covered in terminal.int.test.ts',
  };

  it('covers every project-scoped route key, bar the listed exclusions', () => {
    const scoped = Object.entries(routeAccess)
      .filter(([, a]) => a.scope === 'project')
      .map(([key]) => key)
      .filter((key) => !(key in excluded))
      .sort();
    expect(
      cases()
        .map(([key]) => key)
        .sort(),
    ).toEqual(scoped);
    for (const key of Object.keys(excluded)) expect(routeAccess[key as RouteKey].scope, key).toBe('project');
  });

  it('names only route keys that exist in the route table', () => {
    for (const [key] of cases()) expect(flat[key], key).toBeDefined();
  });

  it('gives an admin on P1 a 404 on every project-scoped route for P2', async () => {
    for (const [key, method, url, payload] of cases()) {
      const res = await send(method, url, adm, payload);
      expect(res.statusCode, `${key} ${url}`).toBe(404);
    }
  });

  it('refuses an admin on P1 the delete of P2 with a 403 and leaves P2 in place', async () => {
    expect((await send('DELETE', `/api/projects/${p2}`, adm)).statusCode).toBe(403);
    expect((await send('GET', `/api/projects/${p2}`, owner)).statusCode).toBe(200);
  });

  it('answers 200 for the same admin on the in-scope P1 project and run', async () => {
    const res = await send('GET', `/api/projects/${p1}`, adm);
    expect(res.statusCode).toBe(200);
    expect((await send('GET', `/api/runs/${runP1}`, adm)).statusCode).toBe(200);
  });
});

describe('run usage stays inside the caller scope', () => {
  it('gives an admin on P1 a 404 on the P2 run and no P2 usage in the P1 list', async () => {
    const res = await send('GET', `/api/runs/${runP2}`, adm);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('totalTokens');
    expect((await send('GET', `/api/projects/${p2}/runs`, adm)).statusCode).toBe(404);
    const list = expectContract('runs.list', await send('GET', `/api/projects/${p1}/runs`, adm)) as RunListResponse;
    expect(list.items.map((r) => r.id)).toEqual([runP1]);
    expect(list.items[0]?.usage?.totalTokens).toBeGreaterThan(0);
  });

  it('lets an org viewer read the usage of a run', async () => {
    const run = expectContract('runs.get', await send('GET', `/api/runs/${runP1}`, vw)) as RunDto;
    expect(run.usage?.models.length).toBeGreaterThan(0);
  });
});

describe('BR-27: the project list fails closed', () => {
  it('lists nothing, with total 0, for an access with no project:read grant', async () => {
    const service = t.app.get(ProjectsService, { strict: false });
    const org = { userId: await userIdOf(t, 'sco-vw'), orgId };
    const page = await service.list(org, { access: { userId: org.userId, grants: [] } }, { page: 1, pageSize: 20 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe('BR-42: a project-scoped caller is refused the connection routes', () => {
  it('gives an admin on P1 a 403 on the connection list and the repo list', async () => {
    expect((await send('GET', '/api/connections', adm)).statusCode).toBe(403);
    expect((await send('GET', `/api/connections/${connectionId}/repos`, adm)).statusCode).toBe(403);
  });
});

describe('BR-44: a deleted project leaves the caller scope', () => {
  it('drops P2 from the member list, keeps the P1 assignment and the P1 runs', async () => {
    expect((await listOf(mem)).total).toBe(2);
    const del = await send('DELETE', `/api/projects/${p2}`, owner);
    expect(del.statusCode).toBe(204);

    const page = await listOf(mem);
    expect(ids(page)).toEqual([p1]);
    expect(page.total).toBe(1);

    const access = expectContract('me.access', await send('GET', '/api/me/access', mem)) as AccessDto;
    expect(access.userId).toBe(await userIdOf(t, 'sco-mem'));
    expect(access.assignments).toHaveLength(1);
    expect(access.assignments[0]?.scope).toEqual({ type: 'project', projectId: p1 });
    expect(JSON.stringify(access)).not.toContain(p2);

    const runsRes = await send('GET', `/api/projects/${p1}/runs`, mem);
    expect(runsRes.statusCode).toBe(200);
    expect(JSON.stringify(runsRes.json())).toContain(runP1);
  });
});

import { randomBytes } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ACTIVE_RUN_STATUSES,
  AccessDto,
  AgentDto,
  AssignmentDto,
  ConnectionDto,
  InvitationDto,
  ProjectDto,
  RuleDto,
  RunDto,
  RunListResponse,
  RunLogResponse,
  RunTranscriptResponse,
  SetupTestDto,
  pageOf,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { API, ok, runOf, waitForStatus } from './helpers';
import { REPO_NEW, buildCast, disposeCast, openTerminal, watchStream, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, the cast's owner, org admin and viewer (spec "E2E requirements": BR-1 to BR-5).
 * Every case runs in a fresh org (`buildCast`), so a case that changes things leaves the next one alone.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

const body = async (res: APIResponse): Promise<string> => `${res.status()} ${await res.text()}`;

/** A 2xx answer (any of them), with the body in the failure message. */
async function expect2xx(res: APIResponse, what: string): Promise<void> {
  expect(res.ok(), `${what}: ${await body(res)}`).toBe(true);
}

async function expect403(res: APIResponse, what: string): Promise<void> {
  expect(res.status(), `${what}: ${await body(res)}`).toBe(403);
}

async function projectIds(who: Actor): Promise<string[]> {
  const list = pageOf(ProjectDto).parse(await ok(await who.api.get('/api/projects?pageSize=100'), 200, 'project list'));
  return list.items.map((p) => p.id);
}

async function rulesOf(who: Actor, projectId: string): Promise<RuleDto[]> {
  return pageOf(RuleDto).parse(
    await ok(await who.api.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rule list'),
  ).items;
}

async function runIds(who: Actor, projectId: string): Promise<string[]> {
  const list = RunListResponse.parse(
    await ok(await who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`), 200, 'run list'),
  );
  return list.items.map((r) => r.id);
}

async function assignmentsOf(who: Actor, orgId: string): Promise<AssignmentDto[]> {
  return pageOf(AssignmentDto).parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`), 200, 'assignment list'),
  ).items;
}

async function invitationsOf(who: Actor, orgId: string): Promise<InvitationDto[]> {
  return pageOf(InvitationDto).parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/invitations?pageSize=100`), 200, 'invitation list'),
  ).items;
}

const accessOf = async (who: Actor): Promise<AccessDto> =>
  AccessDto.parse(await ok(await who.api.get('/api/me/access'), 200, 'me access'));

const newProject = { repoPath: REPO_NEW, triggerMode: 'webhook' } as const;

test.describe('BR-1: owner can do every action', () => {
  test('TC-1.1: an owner creates and removes a project, and it appears and disappears in the list', async () => {
    const { o, connectionId } = cast;
    const created = await o.api.post('/api/projects', { data: { connectionId, ...newProject } });
    await expect2xx(created, 'projects.create');
    const p4 = ProjectDto.parse(await created.json()).id;
    expect(await projectIds(o)).toContain(p4);

    await expect2xx(await o.api.delete(`/api/projects/${p4}`), 'projects.remove');
    expect(await projectIds(o)).not.toContain(p4);
  });

  test('TC-1.2: an owner lists and syncs connections', async () => {
    const { o } = cast;
    const list = await o.api.get('/api/connections');
    await expect2xx(list, 'connections.list');
    expect(z.array(ConnectionDto).parse(await list.json()).length).toBeGreaterThan(0);
    await expect2xx(await o.api.post('/api/connections/fake/sync'), 'connections.sync');
  });

  test('TC-1.3: an owner sets a credential and creates, updates and removes a rule', async () => {
    const { o, p1 } = cast;
    const agent = AgentDto.parse(await ok(await o.api.get(`/api/projects/${p1}/agent`), 200, 'agent'));
    await expect2xx(
      await o.api.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
      }),
      'agents.putCredential',
    );

    const created = await o.api.post(`/api/projects/${p1}/rules`, {
      data: {
        command: 'rbac-extra',
        labelFilter: [],
        target: 'any',
        enabled: true,
        kind: 'prompt',
        prompt: 'Answer in one word.',
      },
    });
    await expect2xx(created, 'rules.create');
    const rule = RuleDto.parse(await created.json());
    expect((await rulesOf(o, p1)).map((r) => r.id)).toContain(rule.id);

    await expect2xx(
      await o.api.patch(`/api/rules/${rule.id}`, { data: { prompt: 'Answer in two words.' } }),
      'rules.update',
    );
    await expect2xx(await o.api.delete(`/api/rules/${rule.id}`), 'rules.remove');
    expect((await rulesOf(o, p1)).map((r) => r.id)).not.toContain(rule.id);
  });

  test('TC-1.4: an owner attaches to a run terminal and cancels the run', async () => {
    const { o, rc } = cast;
    const attach = await openTerminal(o, `/api/runs/${rc}/terminal`);
    expect(attach.code, 'the socket stays open (not closed 4403)').toBeNull();

    await expect2xx(await o.api.post(`/api/runs/${rc}/cancel`), 'runs.cancel');
    await waitForStatus(o.page, rc, 'cancelled', 30_000);
  });
});

test.describe('BR-2: org admin can do everything except owner', () => {
  test('TC-2.1: an org admin creates a project, syncs connections and cancels a run', async () => {
    const { d, connectionId, rc } = cast;
    await expect2xx(await d.api.post('/api/projects', { data: { connectionId, ...newProject } }), 'projects.create');
    await expect2xx(await d.api.post('/api/connections/fake/sync'), 'connections.sync');
    await expect2xx(await d.api.post(`/api/runs/${rc}/cancel`), 'runs.cancel');
  });

  test('TC-2.2: an org admin cannot grant owner', async () => {
    const { d, c, orgId, roleIds } = cast;
    await expect403(
      await d.api.post(`/api/orgs/${orgId}/assignments`, {
        data: { userId: c.userId, roleId: roleIds.owner, scope: { type: 'org' } },
      }),
      'assignments.create owner',
    );
    expect((await accessOf(c)).assignments.map((a) => a.roleKey)).not.toContain('owner');
  });

  test('TC-2.3: an org admin cannot revoke the owner assignment', async () => {
    const { d, o, orgId } = cast;
    const ownerAssignment = (await assignmentsOf(d, orgId)).find(
      (a) => a.userId === o.userId && a.role.key === 'owner',
    );
    expect(ownerAssignment, "O's owner assignment is listed").toBeTruthy();

    await expect403(
      await d.api.delete(`/api/orgs/${orgId}/assignments/${ownerAssignment?.id}`),
      'assignments.remove owner',
    );
    expect((await assignmentsOf(d, orgId)).map((a) => a.id)).toContain(ownerAssignment?.id);
  });

  test('TC-2.4: an org admin cannot invite an owner', async () => {
    const { d, orgId, roleIds } = cast;
    const email = `rbac-new-${randomBytes(4).toString('hex')}@dev.local`;
    await expect403(
      await d.api.post(`/api/orgs/${orgId}/invitations`, {
        data: { email, roleId: roleIds.owner, scope: { type: 'org' } },
      }),
      'invitations.create owner',
    );
    expect((await invitationsOf(d, orgId)).map((i) => i.email)).not.toContain(email);
  });
});

test.describe('BR-3: viewer reads every project and its streams', () => {
  test('TC-3.1: a viewer lists the projects and reads the runs of both', async () => {
    const { v, p1, p2, rb, rc, rp2 } = cast;
    const ids = await projectIds(v);
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);

    expect(await runIds(v, p1)).toEqual(expect.arrayContaining([rb, rc]));
    expect(await runIds(v, p2)).toContain(rp2);

    expect(RunDto.parse(await ok(await v.api.get(`/api/runs/${rb}`), 200, 'runs.get')).id).toBe(rb);
    RunLogResponse.parse(await ok(await v.api.get(`/api/runs/${rb}/log`), 200, 'runs.log'));
    RunTranscriptResponse.parse(await ok(await v.api.get(`/api/runs/${rb}/transcript`), 200, 'runs.transcript'));
  });

  test("TC-3.2: a viewer's open run stream receives the frame of a status change", async () => {
    const { v, o, rc } = cast;
    const stream = await watchStream(v, `/api/runs/${rc}/events`);
    try {
      expect(stream.status, 'runs.events connect').toBe(200);

      await expect2xx(await o.api.post(`/api/runs/${rc}/finish`), 'runs.finish');
      await expect
        .poll(async () => (await stream.text()).includes('"status":"succeeded"'), {
          timeout: 60_000,
          intervals: [200, 500, 1000],
        })
        .toBe(true);
    } finally {
      await stream.close();
    }
  });

  test('TC-3.3: a viewer connects to the event stream of a project', async () => {
    const { v, p2 } = cast;
    const stream = await watchStream(v, `/api/projects/${p2}/events`);
    await stream.close();
    expect(stream.status, 'projects.events connect').toBe(200);
  });
});

test.describe('BR-4: viewer writes are refused and change nothing', () => {
  test('TC-4.1: a viewer cannot cancel a run', async () => {
    const { v, rb } = cast;
    await expect403(await v.api.post(`/api/runs/${rb}/cancel`), 'runs.cancel');
    const run = await runOf(v.page, rb);
    expect(ACTIVE_RUN_STATUSES, `RB is ${run.status}`).toContain(run.status);
  });

  test('TC-4.2: a viewer cannot update a rule', async () => {
    const { v, o, p1 } = cast;
    const before = (await rulesOf(o, p1)).find((r) => r.command === 'rbac-run');
    expect(before, 'the P1 rule').toBeTruthy();

    await expect403(
      await v.api.patch(`/api/rules/${before?.id}`, { data: { prompt: 'A new body from a viewer.' } }),
      'rules.update',
    );
    expect((await rulesOf(v, p1)).find((r) => r.id === before?.id)).toEqual(before);
  });

  test('TC-4.3: a viewer cannot create a project', async () => {
    const { v, p1, p2, connectionId } = cast;
    await expect403(await v.api.post('/api/projects', { data: { connectionId, ...newProject } }), 'projects.create');
    expect([...(await projectIds(v))].sort()).toEqual([p1, p2].sort());
  });

  test('TC-4.4: a viewer cannot change the agent', async () => {
    const { v, p1 } = cast;
    const before = AgentDto.parse(await ok(await v.api.get(`/api/projects/${p1}/agent`), 200, 'agents.get'));

    await expect403(
      await v.api.put(`/api/projects/${p1}/agent`, {
        data: { model: before.model, timeoutSeconds: before.timeoutSeconds + 60 },
      }),
      'agents.put',
    );
    expect(AgentDto.parse(await ok(await v.api.get(`/api/projects/${p1}/agent`), 200, 'agents.get'))).toEqual(before);
  });
});

test.describe('BR-5: viewer terminal closes 4403', () => {
  test('TC-5.1: a viewer opening the terminal of an active run is closed 4403 with no bytes', async () => {
    const { v, rb } = cast;
    expect(await openTerminal(v, `/api/runs/${rb}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });

  test('TC-5.2: a viewer opening the terminal of a setup test is closed 4403 with no bytes', async () => {
    const { v, o, p1 } = cast;
    const started = await o.api.post(`/api/projects/${p1}/setup-tests`, { data: { script: 'echo rbac\n' } });
    await expect2xx(started, 'setupTests.create');
    const t = SetupTestDto.parse(await started.json());

    expect(await openTerminal(v, `/api/setup-tests/${t.id}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });
});

import { randomBytes } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ACTIVE_RUN_STATUSES,
  AccessDto,
  AgentDto,
  AssignmentDto,
  ConnectionDto,
  ProjectDto,
  RuleDto,
  RunListResponse,
  SetupScriptDto,
  SetupTestDto,
  SkillDto,
  pageOf,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { API, grant, ok, runOf, waitForStatus } from './helpers';
import { REPO_NEW, REPO_P1, REPO_P2, buildCast, disposeCast, openTerminal, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, a project admin, a member of two projects, mixed roles and a member left with
 * no assignment (spec "E2E requirements": BR-29, BR-30, BR-31, BR-32). A is the admin of P1 only, B the member of P1 and
 * P2, C the member of P1, V the org viewer; RC is C's run, RP2 the run in P2. Every case runs in a fresh org
 * (`buildCast`); what a case adds to the shared fake board (skills) or starts (setup tests, P3) it removes in a `finally`.
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

/** The answer is a 404 whose body names none of `leaks` (a value the request URL carries is not an echo). */
async function expect404(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(404);
  for (const leak of leaks) {
    if (res.url().includes(leak)) continue;
    expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
  }
}

/** The answer is a 403 whose body names none of `leaks`. */
async function expect403Naming(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(403);
  for (const leak of leaks) expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
}

/** Cleanup that never masks the failure of the test it runs after. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  await action().catch(() => null);
}

const idsOf = (items: { id: string }[]): string[] => items.map((i) => i.id).sort();

const ProjectPage = pageOf(ProjectDto);

async function projectsOf(who: Actor): Promise<z.infer<typeof ProjectPage>> {
  return ProjectPage.parse(await ok(await who.api.get('/api/projects?pageSize=100'), 200, 'project list'));
}

async function projectOf(who: Actor, projectId: string): Promise<ProjectDto> {
  return ProjectDto.parse(await ok(await who.api.get(`/api/projects/${projectId}`), 200, 'project'));
}

async function agentOf(who: Actor, projectId: string): Promise<AgentDto> {
  return AgentDto.parse(await ok(await who.api.get(`/api/projects/${projectId}/agent`), 200, 'agent'));
}

async function rulesOf(who: Actor, projectId: string): Promise<RuleDto[]> {
  return pageOf(RuleDto).parse(
    await ok(await who.api.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rule list'),
  ).items;
}

async function runsOf(who: Actor, projectId: string): Promise<RunListResponse> {
  return RunListResponse.parse(
    await ok(await who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`), 200, 'run list'),
  );
}

async function assignmentsOf(who: Actor, orgId: string): Promise<AssignmentDto[]> {
  return pageOf(AssignmentDto).parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`), 200, 'assignment list'),
  ).items;
}

async function accessOf(who: Actor): Promise<AccessDto> {
  return AccessDto.parse(await ok(await who.api.get('/api/me/access'), 200, 'me access'));
}

const isActive = (status: string): boolean => ACTIVE_RUN_STATUSES.some((s) => s === status);

/** The run is still active (not ended, not paused) after a refused control. */
async function expectStillActive(who: Actor, runId: string, what: string): Promise<void> {
  const run = await runOf(who.page, runId);
  expect(isActive(run.status), `${what}: the run is ${run.status}`).toBe(true);
  expect(run.pauseReason, `${what}: the run was not paused`).toBeNull();
}

const ruleBody = (command: string, prompt: string) => ({
  command,
  labelFilter: [],
  target: 'any',
  enabled: true,
  kind: 'prompt',
  prompt,
});

/** O creates a prompt rule on `projectId` (the Given "P2 has a rule R2"). */
async function createRule(who: Actor, projectId: string): Promise<RuleDto> {
  const res = await who.api.post(`/api/projects/${projectId}/rules`, {
    data: ruleBody(`rbac-r-${randomBytes(3).toString('hex')}`, 'Answer in one word.'),
  });
  await expect2xx(res, 'rules.create as owner');
  return RuleDto.parse(await res.json());
}

/** O creates project P3 on a repo no other cast project uses (the Given "O has also created project P3"). */
async function createP3(c: Cast): Promise<string> {
  const res = await c.o.api.post('/api/projects', {
    data: { connectionId: c.connectionId, repoPath: REPO_NEW, triggerMode: 'webhook' },
  });
  await expect2xx(res, 'projects.create P3 as owner');
  return ProjectDto.parse(await res.json()).id;
}

const skillBody = (name: string): string => `---\nname: ${name}\ndescription: Project admin check.\n---\n\n# ${name}\n`;

test.describe('BR-29: an admin on P1 only', () => {
  test('TC-29.1: A updates the settings and the agent of P1 and sets its credential, all accepted', async () => {
    const { a, o, p1 } = cast;
    const project = await projectOf(o, p1);
    const agent = await agentOf(o, p1);
    expect(agent.credential.set, 'the cast set a credential on P1').toBe(true);

    await expect2xx(
      await a.api.patch(`/api/projects/${p1}`, { data: { maxConcurrentRuns: project.maxConcurrentRuns + 1 } }),
      'projects.update',
    );
    expect((await projectOf(o, p1)).maxConcurrentRuns, 'the settings changed').toBe(project.maxConcurrentRuns + 1);

    await expect2xx(
      await a.api.put(`/api/projects/${p1}/agent`, {
        data: { model: agent.model, timeoutSeconds: agent.timeoutSeconds + 60 },
      }),
      'agents.put',
    );
    expect((await agentOf(o, p1)).timeoutSeconds, 'the agent changed').toBe(agent.timeoutSeconds + 60);

    await expect2xx(
      await a.api.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
      }),
      'agents.putCredential',
    );
    const after = await agentOf(o, p1);
    expect(after.credential.set).toBe(true);
    expect(after.credential.updatedAt, 'the credential was rewritten').not.toBe(agent.credential.updatedAt);
  });

  test('TC-29.2: A creates a rule, puts a skill and the setup script and starts a setup test on P1, all accepted', async () => {
    const { a, o, p1 } = cast;
    const skill = `rbac-s-${randomBytes(3).toString('hex')}`;
    let ruleId: string | undefined;
    let setupTestId: string | undefined;
    try {
      const rule = await a.api.post(`/api/projects/${p1}/rules`, {
        data: ruleBody(`rbac-a-${randomBytes(3).toString('hex')}`, 'Answer in two words.'),
      });
      await expect2xx(rule, 'rules.create');
      ruleId = RuleDto.parse(await rule.json()).id;
      expect(
        (await rulesOf(o, p1)).map((r) => r.id),
        'the rule is in the list',
      ).toContain(ruleId);

      await expect2xx(
        await a.api.put(`/api/projects/${p1}/skills/${skill}`, {
          data: { body: skillBody(skill), message: `add ${skill}` },
        }),
        'skills.put',
      );
      expect(
        SkillDto.parse(await ok(await o.api.get(`/api/projects/${p1}/skills/${skill}`), 200, 'skills.get')).name,
        'the skill is there',
      ).toBe(skill);

      const script = '#!/usr/bin/env bash\necho project-admin\n';
      const before = SetupScriptDto.nullable().parse(
        await ok(await a.api.get(`/api/projects/${p1}/setup-script`), 200, 'setupScript.get'),
      );
      await expect2xx(
        await a.api.put(`/api/projects/${p1}/setup-script`, {
          data: { body: script, baseVersion: before?.version ?? null },
        }),
        'setupScript.put',
      );
      expect(
        SetupScriptDto.nullable().parse(await ok(await o.api.get(`/api/projects/${p1}/setup-script`), 200, 'script'))
          ?.body,
        'the script is saved',
      ).toBe(script);

      const started = await a.api.post(`/api/projects/${p1}/setup-tests`, { data: { script } });
      await expect2xx(started, 'setupTests.create');
      setupTestId = SetupTestDto.parse(await started.json()).id;
    } finally {
      if (setupTestId) await quietly(() => o.api.post(`/api/setup-tests/${setupTestId}/end`));
      if (ruleId) await quietly(() => o.api.delete(`/api/rules/${ruleId}`));
      await quietly(() => o.api.delete(`/api/projects/${p1}/skills/${skill}?message=cleanup`));
    }
  });

  test('TC-29.3: A cancels RC, which C owns, and RC shows as cancelled', async () => {
    const { a, c, rc } = cast;
    expect((await runOf(a.page, rc)).ownerUserId, 'RC is owned by C').toBe(c.userId);

    await expect2xx(await a.api.post(`/api/runs/${rc}/cancel`), 'runs.cancel');
    await waitForStatus(a.page, rc, 'cancelled', 30_000);
  });

  test('TC-29.4: A opening the terminal of RC attaches and is not closed 4403', async () => {
    const { a, rc } = cast;
    const attach = await openTerminal(a, `/api/runs/${rc}/terminal`);
    expect(attach.code, 'the socket stays open (not closed 4403)').toBeNull();
  });

  test('TC-29.5: A creating a project gets 403 and no project is created', async () => {
    const { a, o, p1, p2, connectionId } = cast;
    await expect403(
      await a.api.post('/api/projects', { data: { connectionId, repoPath: REPO_NEW, triggerMode: 'webhook' } }),
      'projects.create',
    );
    expect(idsOf((await projectsOf(o)).items), 'the org still holds P1 and P2 only').toEqual([p1, p2].sort());
  });

  test('TC-29.6: A removing P1 gets 403 and P1 is still in the list of A', async () => {
    const { a, p1 } = cast;
    await expect403(await a.api.delete(`/api/projects/${p1}`), 'projects.remove');
    expect(idsOf((await projectsOf(a)).items)).toEqual([p1]);
    expect((await projectOf(a, p1)).id).toBe(p1);
  });

  test('TC-29.7: A listing connections gets 403, naming no connection', async () => {
    const { a, o, connectionId } = cast;
    const connections = z
      .array(ConnectionDto)
      .parse(await ok(await o.api.get('/api/connections'), 200, 'connections.list as owner'));
    const connection = connections.find((x) => x.id === connectionId);
    expect(connection, 'the fake connection is listed for the owner').toBeTruthy();

    await expect403Naming(await a.api.get('/api/connections'), 'connections.list', [
      connectionId,
      connection?.accountName ?? '',
    ]);
  });
});

test.describe('BR-30: a member on P1 and P2', () => {
  test('TC-30.1: B reads RC in P1 and the runs of P2, both 200', async () => {
    const { b, c, p1, p2, rc, rp2 } = cast;
    const p3 = await createP3(cast);
    try {
      const run = await runOf(b.page, rc);
      expect(run.id).toBe(rc);
      expect(run.ownerUserId, 'RC is C, not B').toBe(c.userId);
      expect(run.projectId).toBe(p1);

      expect(idsOf((await runsOf(b, p2)).items), "P2's runs").toContain(rp2);
    } finally {
      await quietly(() => cast.o.api.delete(`/api/projects/${p3}`));
    }
  });

  test('TC-30.2: B cancelling RC gets 403 and RC is still active', async () => {
    const { b, rc } = cast;
    await expect403(await b.api.post(`/api/runs/${rc}/cancel`), 'runs.cancel');
    await expectStillActive(b, rc, 'after runs.cancel');
  });

  test('TC-30.3: B lists P1 and P2 only and getting P3 gives 404', async () => {
    const { b, p1, p2 } = cast;
    const p3 = await createP3(cast);
    try {
      const res = await b.api.get('/api/projects?pageSize=100');
      const text = await res.text();
      expect(res.status(), `projects.list: ${text}`).toBe(200);
      const page = ProjectPage.parse(JSON.parse(text));
      expect(idsOf(page.items)).toEqual([p1, p2].sort());
      expect(page.total).toBe(2);
      for (const leak of [p3, REPO_NEW, 'demo-3']) expect(text, `the list names ${leak}`).not.toContain(leak);

      await expect404(await b.api.get(`/api/projects/${p3}`), 'projects.get P3', [REPO_NEW, 'demo-3']);
    } finally {
      await quietly(() => cast.o.api.delete(`/api/projects/${p3}`));
    }
  });
});

test.describe('BR-31: an org viewer who is also admin on P1', () => {
  /** The Given: O also grants V `admin` on P1 (a project-scope assignment beside V's org-wide `viewer`). */
  async function grantVAdminOnP1(c: Cast): Promise<void> {
    await expect2xx(
      await c.o.api.post(`/api/orgs/${c.orgId}/assignments`, {
        data: { userId: c.v.userId, roleId: c.roleIds.admin, scope: { type: 'project', projectId: c.p1 } },
      }),
      'assignments.create admin on P1 as owner',
    );
    const held = (await accessOf(c.v)).assignments.map((x) => `${x.roleKey}:${x.scope.type}`).sort();
    expect(held, 'V holds viewer on the org and admin on P1').toEqual(['admin:project', 'viewer:org']);
  }

  test('TC-31.1: V creates a rule on P1, accepted', async () => {
    const { v, o, p1 } = cast;
    await grantVAdminOnP1(cast);
    let ruleId: string | undefined;
    try {
      const res = await v.api.post(`/api/projects/${p1}/rules`, {
        data: ruleBody(`rbac-v-${randomBytes(3).toString('hex')}`, 'Answer in one word.'),
      });
      await expect2xx(res, 'rules.create');
      ruleId = RuleDto.parse(await res.json()).id;
      expect((await rulesOf(o, p1)).map((r) => r.id)).toContain(ruleId);
    } finally {
      if (ruleId) await quietly(() => o.api.delete(`/api/rules/${ruleId}`));
    }
  });

  test('TC-31.2: V updating rule R2 in P2 gets 403 and R2 reads back unchanged', async () => {
    const { v, o, p2 } = cast;
    await grantVAdminOnP1(cast);
    const r2 = await createRule(o, p2);
    try {
      await expect403(
        await v.api.patch(`/api/rules/${r2.id}`, { data: { prompt: 'A new body from a viewer.' } }),
        'rules.update R2',
      );
      expect((await rulesOf(o, p2)).find((r) => r.id === r2.id)).toEqual(r2);
    } finally {
      await quietly(() => o.api.delete(`/api/rules/${r2.id}`));
    }
  });

  test('TC-31.3: V listing the runs of P2 and reading RP2 gets 200 for both', async () => {
    const { v, p2, rp2 } = cast;
    await grantVAdminOnP1(cast);
    expect(idsOf((await runsOf(v, p2)).items)).toContain(rp2);
    expect((await runOf(v.page, rp2)).id).toBe(rp2);
  });
});

test.describe('BR-32: a member with no assignment is locked out until granted', () => {
  /** The Given: O revokes C's assignment on P1; C stays a member of X holding nothing (only `me/access` still answers). */
  async function revokeCOnP1(c: Cast): Promise<void> {
    const mine = (await assignmentsOf(c.o, c.orgId)).filter((x) => x.userId === c.c.userId);
    expect(
      mine.map((x) => x.scope),
      'C holds one assignment, on P1',
    ).toEqual([{ type: 'project', projectId: c.p1 }]);
    const revoked = await c.o.api.delete(`/api/orgs/${c.orgId}/assignments/${mine[0]?.id}`);
    expect(revoked.status(), `assignments.remove: ${await body(revoked)}`).toBe(204);
    expect((await accessOf(c.c)).assignments, 'C now holds nothing in X').toEqual([]);
  }

  test('TC-32.1: C listing projects after the revoke gets 403, not an empty list', async () => {
    const { c, p1, p2 } = cast;
    await revokeCOnP1(cast);
    await expect403Naming(await c.api.get('/api/projects?pageSize=100'), 'projects.list', [p1, p2, REPO_P1]);
  });

  test('TC-32.2: C listing the runs and the rules of P1 after the revoke gets 403, not 404', async () => {
    const { c, p1, rb, rc } = cast;
    await revokeCOnP1(cast);
    await expect403Naming(await c.api.get(`/api/projects/${p1}/runs?filter=all&pageSize=100`), 'runs.list', [
      rb,
      rc,
      'rbac-run',
    ]);
    await expect403Naming(await c.api.get(`/api/projects/${p1}/rules?pageSize=100`), 'rules.list', ['rbac-run']);
  });

  test('TC-32.3: C opening the terminal of RC after the revoke is closed 4403 with no bytes', async () => {
    const { c, rc } = cast;
    await revokeCOnP1(cast);
    expect(await openTerminal(c, `/api/runs/${rc}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });

  test('TC-32.4: after the platform admin grants C member on P2, C lists P2 only, R2 is unchanged and P1 is 404', async () => {
    const { c, o, pa, orgId, p1, p2 } = cast;
    await revokeCOnP1(cast);
    const r2 = await createRule(o, p2);
    try {
      await grant(pa, orgId, c.userId, 'member', { type: 'project', projectId: p2 });

      const list = await projectsOf(c);
      expect(idsOf(list.items), 'only P2, not P1').toEqual([p2]);
      expect(list.total).toBe(1);

      expect(
        (await rulesOf(c, p2)).find((r) => r.id === r2.id),
        'R2 is present and unchanged',
      ).toEqual(r2);

      await expect404(await c.api.get(`/api/projects/${p1}`), 'projects.get P1', [REPO_P1, 'rbac-run']);
      expect(list.items[0]?.repoPath, 'the list shows P2').toBe(REPO_P2);
    } finally {
      await quietly(() => o.api.delete(`/api/rules/${r2.id}`));
    }
  });
});

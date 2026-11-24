import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ACTIVE_RUN_STATUSES,
  AccessDto,
  AgentDto,
  AssignmentDto,
  ConnectionDto,
  ProjectDto,
  ProjectMemberDto,
  RuleDto,
  RunListResponse,
  SetupScriptDto,
  SetupTestDto,
  SkillDto,
  pageOf,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { API, grant, ok, runOf, waitForStatus } from './helpers';
import {
  REPO_NEW,
  REPO_P1,
  REPO_P2,
  buildCast,
  disposeCast,
  disposeSecondOrg,
  openTerminal,
  roleIdsOf,
  secondOrg,
  type Actor,
  type Cast,
} from './rbac-cast';
import { auditUrl, freshOrgMember, membersUrl, projectAuditApi, projectMembersApi } from './project-admin';

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

      // A member has no Desk read (issue 216): C gets 403 on the rules, and O still sees R2 unchanged.
      await expect403Naming(await c.api.get(`/api/projects/${p2}/rules?pageSize=100`), 'rules.list P2', [r2.id]);
      expect(
        (await rulesOf(o, p2)).find((r) => r.id === r2.id),
        'R2 is present and unchanged',
      ).toEqual(r2);

      await expect404(await c.api.get(`/api/projects/${p1}`), 'projects.get P1', [REPO_P1, 'rbac-run']);
      expect(list.items[0]?.repoPath, 'the list shows P2').toBe(REPO_P2);
    } finally {
      await quietly(() => o.api.delete(`/api/rules/${r2.id}`));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Project admin space (spec 2026-11-23-rbac-project-admin-space-design.md, E2E requirements: BR-2, BR-3, BR-11, BR-23,
// BR-24, BR-26). Every extra person a case makes is closed in a `finally`.
// ---------------------------------------------------------------------------------------------------------------------

const forbidden = (page: Actor['page']) => page.getByRole('heading', { name: "You don't have access" });
const notFound = (page: Actor['page']) => page.getByRole('heading', { name: 'Page not found' });

async function projectMembersOf(who: Pick<Actor, 'api'>, projectId: string): Promise<ProjectMemberDto[]> {
  return pageOf(ProjectMemberDto).parse(
    await ok(await projectMembersApi(who, projectId).list(), 200, 'project members'),
  ).items;
}

const roleKeysOf = (m: ProjectMemberDto | undefined): string[] => (m?.projectRoles ?? []).map((r) => r.role.key).sort();

test.describe('BR-2: member and viewer get Forbidden on Members and Audit log', () => {
  for (const [tc, who] of [
    ['TC-2.5', 'b'],
    ['TC-2.6', 'v'],
  ] as const) {
    test(`${tc}: ${who === 'b' ? 'B (member on P1)' : 'V (org viewer)'} typing P1's Members and Audit log URL sees Forbidden, no names, no entries`, async () => {
      const person = cast[who];
      const names = [cast.a.handle, cast.b.handle, cast.c.handle, cast.o.handle];
      for (const url of [membersUrl(cast, cast.p1), auditUrl(cast, cast.p1)]) {
        await person.page.goto(url);
        await expect(forbidden(person.page)).toBeVisible();
        await expect(person.page.getByText('Ask an owner of this organization to give you access.')).toBeVisible();
        await expect(person.page.getByRole('table')).toHaveCount(0);
        await expect(person.page.getByRole('heading', { level: 1, name: /^(Members|Audit log)$/ })).toHaveCount(0);
        for (const name of names) await expect(person.page.locator('body')).not.toContainText(name);
      }
    });
  }
});

test.describe('BR-3: an admin of P1 only gets not found on P2', () => {
  test("TC-3.2: A typing P2's Settings URL sees not found and nothing of P2", async () => {
    const p2 = await projectOf(cast.o, cast.p2);
    await cast.a.page.goto(`/o/${cast.slug}/p/${cast.p2}/desk/rules`);
    await expect(notFound(cast.a.page)).toBeVisible();
    await expect(cast.a.page.locator('body')).not.toContainText(p2.repoPath);
    await expect(cast.a.page.locator('body')).not.toContainText(p2.name);
    await expect(cast.a.page.getByRole('heading', { name: 'Routing rules' })).toHaveCount(0);
  });

  test("TC-3.3: A typing P2's Members URL sees not found and none of P2's people", async () => {
    await cast.a.page.goto(membersUrl(cast, cast.p2));
    await expect(notFound(cast.a.page)).toBeVisible();
    await expect(cast.a.page.getByRole('table')).toHaveCount(0);
    await expect(cast.a.page.locator('body')).not.toContainText(cast.b.handle);
  });

  test("TC-3.4: A typing P2's Audit log URL sees not found, no P2 entries or names", async () => {
    // Given: an entry exists in P2's audit (O adds X to P2).
    const x = await freshOrgMember(cast, 'viewer', { type: 'org' });
    try {
      await expect2xx(await projectMembersApi(cast.o, cast.p2).add(x.userId, cast.roleIds.viewer), 'O adds X to P2');
      await cast.a.page.goto(auditUrl(cast, cast.p2));
      await expect(notFound(cast.a.page)).toBeVisible();
      await expect(cast.a.page.getByRole('table')).toHaveCount(0);
      await expect(cast.a.page.locator('body')).not.toContainText(x.handle);
      await expect(cast.a.page.locator('body')).not.toContainText(cast.b.handle);
    } finally {
      await quietly(() => x.ctx.close());
    }
  });
});

test.describe('BR-11: A looks at their own row', () => {
  test('TC-11.2: A deleting their own project membership gets 403; A still opens Members and still has Admin on P1', async () => {
    await expect403(await projectMembersApi(cast.a, cast.p1).remove(cast.a.userId), 'A removes themselves');
    await cast.a.page.goto(membersUrl(cast, cast.p1));
    await expect(cast.a.page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    const held = (await accessOf(cast.a)).assignments.map((x) => `${x.roleKey}:${x.scope.type}`);
    expect(held, 'A still holds admin on P1').toEqual(['admin:project']);
    const rows = await projectMembersOf(cast.o, cast.p1);
    expect(roleKeysOf(rows.find((m) => m.userId === cast.a.userId))).toEqual(['admin']);
  });
});

test.describe('BR-23: API refusals', () => {
  /** The three writes aimed at C on P1 as `who`, each refused 403, then C still has exactly `member` and X has no role. */
  async function expectWritesRefused(who: Actor): Promise<void> {
    const x = await freshOrgMember(cast, 'viewer', { type: 'org' });
    try {
      const api = projectMembersApi(who, cast.p1);
      await expect403(await api.add(x.userId, cast.roleIds.viewer), 'add');
      await expect403(await api.setRole(cast.c.userId, cast.roleIds.viewer), 'change role');
      await expect403(await api.remove(cast.c.userId), 'remove');
      const rows = await projectMembersOf(cast.o, cast.p1);
      expect(roleKeysOf(rows.find((m) => m.userId === cast.c.userId)), 'C keeps the same role').toEqual(['member']);
      // X is an org viewer, so the list shows X as inherited; what must not exist is a project role
      expect(roleKeysOf(rows.find((m) => m.userId === x.userId)), 'X was not added').toEqual([]);
    } finally {
      await quietly(() => x.ctx.close());
    }
  }

  test('TC-23.1: B (member P1) add, change role and remove each answer 403; C keeps the same role', async () => {
    await expectWritesRefused(cast.b);
  });

  test('TC-23.2: V (org viewer) add, change role and remove each answer 403; nothing changes', async () => {
    await expectWritesRefused(cast.v);
  });

  test('TC-23.3: B reading the members and the audit of P1 gets 403 for both', async () => {
    await expect403(await projectMembersApi(cast.b, cast.p1).list(), 'B lists members');
    await expect403(await projectAuditApi(cast.b, cast.p1), 'B reads audit');
  });

  test('TC-23.4: V reading the members and the audit of P1 gets 403 for both', async () => {
    await expect403(await projectMembersApi(cast.v, cast.p1).list(), 'V lists members');
    await expect403(await projectAuditApi(cast.v, cast.p1), 'V reads audit');
  });

  test("TC-23.5: A (admin of P1 only) sending GET, POST, PUT and DELETE for P2 gets 404 each; B's role on P2 is unchanged", async () => {
    const api = projectMembersApi(cast.a, cast.p2);
    const leaks = [cast.b.handle];
    await expect404(await api.list(), 'GET', leaks);
    await expect404(await api.add(cast.b.userId, cast.roleIds.viewer), 'POST', leaks);
    await expect404(await api.setRole(cast.b.userId, cast.roleIds.viewer), 'PUT role', leaks);
    await expect404(await api.remove(cast.b.userId), 'DELETE', leaks);
    const rows = await projectMembersOf(cast.o, cast.p2);
    expect(roleKeysOf(rows.find((m) => m.userId === cast.b.userId))).toEqual(['member']);
  });

  test("TC-23.6: A reading P2's audit gets 404", async () => {
    await expect404(await projectAuditApi(cast.a, cast.p2), 'GET P2 audit', [cast.b.handle]);
  });

  test('TC-23.7: A adding an org member with the Owner role gets 422 on /roleId and no row is added', async () => {
    const x = await freshOrgMember(cast, 'viewer', { type: 'org' });
    try {
      const res = await projectMembersApi(cast.a, cast.p1).add(x.userId, cast.roleIds.owner);
      const text = await res.text();
      expect(res.status(), `owner role: ${res.status()} ${text}`).toBe(422);
      expect(text, 'the error names /roleId').toContain('/roleId');
      const rows = await projectMembersOf(cast.o, cast.p1);
      // X is an org viewer, listed as inherited: no project role was added
      expect(roleKeysOf(rows.find((m) => m.userId === x.userId))).toEqual([]);
    } finally {
      await quietly(() => x.ctx.close());
    }
  });

  test('TC-23.8: A adding C, who already holds a role on P1, gets 409 and C keeps their role', async () => {
    const res = await projectMembersApi(cast.a, cast.p1).add(cast.c.userId, cast.roleIds.viewer);
    const text = await res.text();
    expect(res.status(), `add C again: ${res.status()} ${text}`).toBe(409);
    expect(text.toLowerCase()).toContain('already has a role on this project');
    const rows = await projectMembersOf(cast.o, cast.p1);
    expect(roleKeysOf(rows.find((m) => m.userId === cast.c.userId))).toEqual(['member']);
  });
});

test.describe('BR-24: cross-org', () => {
  test("TC-24.1: the owner of org B reading, adding to and auditing org A's P1 gets 404 naming nothing of org A", async ({
    browser,
  }) => {
    const second = await secondOrg(browser, cast.pa);
    try {
      const leaks = [cast.slug, cast.orgId, cast.o.handle, cast.a.handle, cast.b.handle, cast.c.handle];
      await expect404(await projectMembersApi(second.owner, cast.p1).list(), 'GET members', leaks);
      const secondRoles = await roleIdsOf(cast.pa, second.orgId);
      await expect404(
        await projectMembersApi(second.owner, cast.p1).add(second.owner.userId, secondRoles.viewer),
        'POST members',
        leaks,
      );
      await expect404(await projectAuditApi(second.owner, cast.p1), 'GET audit', leaks);
    } finally {
      await disposeSecondOrg(second);
    }
  });

  test('TC-24.2: org B owner listing members with excludeProject P1 and with an unknown project gets the same not found', async ({
    browser,
  }) => {
    const second = await secondOrg(browser, cast.pa);
    try {
      const list = (project: string) =>
        second.owner.api.get(`/api/orgs/${second.orgId}/members?excludeProject=${project}`);
      const other = await list(cast.p1);
      const unknown = await list(randomUUID());
      const otherText = await other.text();
      const unknownText = await unknown.text();
      expect(other.status(), `P1 of org A: ${otherText}`).toBe(404);
      expect(unknown.status(), `unknown id: ${unknownText}`).toBe(404);
      // The same answer: title, detail and status match (the request id and instance differ per request).
      const shape = (text: string): string => {
        const { title, detail, status } = z
          .object({ title: z.string(), detail: z.string(), status: z.number() })
          .parse(JSON.parse(text));
        return JSON.stringify({ title, detail, status });
      };
      expect(shape(otherText)).toBe(shape(unknownText));
    } finally {
      await disposeSecondOrg(second);
    }
  });

  test("TC-24.3: O opening P1 Members, org Members, P1 Audit and org Audit sees none of org B's people or entries", async ({
    browser,
  }) => {
    const second = await secondOrg(browser, cast.pa);
    try {
      const page = cast.o.page;
      const noneOfB = async (): Promise<void> => {
        await expect(page.locator('body')).not.toContainText(second.owner.handle);
      };
      await page.goto(membersUrl(cast, cast.p1));
      await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: cast.b.handle })).toBeVisible();
      await noneOfB();
      await page.goto(`/o/${cast.slug}/settings/members`);
      await expect(page.getByRole('row').filter({ hasText: cast.b.handle })).toBeVisible();
      await noneOfB();
      await page.goto(auditUrl(cast, cast.p1));
      await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
      await noneOfB();
      await page.goto(`/o/${cast.slug}/settings/audit`);
      await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
      await noneOfB();
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

test.describe('BR-26: an org viewer who is also admin on P1', () => {
  /** G: org viewer plus admin on P1, made in the case. */
  async function newG(): Promise<Actor> {
    const g = await freshOrgMember(cast, 'viewer', { type: 'org' });
    try {
      await grant(cast.pa, cast.orgId, g.userId, 'admin', { type: 'project', projectId: cast.p1 });
      return g;
    } catch (error) {
      await g.ctx.close().catch(() => null);
      throw error;
    }
  }

  test('TC-26.1: G opens P1 Settings, Members and Audit log; adding a person as Viewer succeeds and shows after a reload', async () => {
    const g = await newG();
    let x: Actor | undefined;
    try {
      x = await freshOrgMember(cast, 'viewer', { type: 'org' });
      const page = g.page;
      await page.goto(`/o/${cast.slug}/p/${cast.p1}/runs`);
      await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Settings' }).click();
      const side = page.getByRole('navigation', { name: 'Desk' });
      await side.getByRole('link', { name: 'Members' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
      await page.getByRole('button', { name: 'Add member' }).first().click();
      const dialog = page.getByRole('dialog', { name: /^Add member to/ });
      await dialog.getByRole('combobox', { name: 'Person' }).click();
      await page.getByRole('option').filter({ hasText: x.handle }).first().click();
      const added = x;
      await dialog
        .getByRole('radiogroup', { name: 'Role' })
        .getByRole('radio', { name: /^Viewer/ })
        .check({ force: true });
      await dialog.getByRole('button', { name: 'Add member' }).click();
      await expect(page.getByText(/added as Viewer/)).toBeVisible();
      await page.reload();
      const row = page.getByRole('row').filter({ hasText: added.handle });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Viewer');
      await side.getByRole('link', { name: 'Audit log' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
      expect(roleKeysOf((await projectMembersOf(cast.o, cast.p1)).find((m) => m.userId === added.userId))).toEqual([
        'viewer',
      ]);
    } finally {
      await quietly(async () => x?.ctx.close());
      await quietly(() => g.ctx.close());
    }
  });

  test("TC-26.2: G opens P2 read-only with no Settings tab; P2's Members URL shows Forbidden", async () => {
    const g = await newG();
    try {
      const page = g.page;
      const main = page.getByRole('navigation', { name: 'Project sections' });
      const runsUrl = `/o/${cast.slug}/p/${cast.p2}/runs`;
      const run = await runOf(page, cast.rp2);
      // Control: the owner O sees the write controls on P2's active run, so their absence for G is a real difference.
      await cast.o.page.goto(runsUrl);
      await expect(cast.o.page.getByRole('button', { name: 'Finish run' })).toBeVisible();
      await cast.o.page.goto(`${runsUrl}/${run.number}`);
      await expect(cast.o.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
      // G reads P2 (its run is listed and opens) but has no write control and no Settings tab.
      await page.goto(runsUrl);
      await expect(page.locator(`a[href="${runsUrl}/${run.number}"]`).first()).toBeVisible();
      await expect(main.getByRole('link', { name: 'Settings' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Finish run' })).toHaveCount(0);
      await page.goto(`${runsUrl}/${run.number}`);
      await expect(page.getByText('Triggered by')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
      await page.goto(membersUrl(cast, cast.p2));
      await expect(forbidden(page)).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    } finally {
      await quietly(() => g.ctx.close());
    }
  });
});

/** The 7 project env routes on `projectId`: list, then create, update and remove for variables, then for secrets. */
function envCalls(
  who: Actor,
  projectId: string,
  plain: string,
  secret: string,
): { what: string; call: () => Promise<APIResponse> }[] {
  const base = `/api/projects/${projectId}`;
  return [
    { what: 'list', call: () => who.api.get(`${base}/env?kind=plain`) },
    {
      what: 'create var',
      call: () => who.api.post(`${base}/env-vars`, { data: { name: plain, value: 'e2e-new-value' } }),
    },
    { what: 'update var', call: () => who.api.put(`${base}/env-vars/${plain}`, { data: { value: 'e2e-changed' } }) },
    { what: 'remove var', call: () => who.api.delete(`${base}/env-vars/${plain}`) },
    {
      what: 'create secret',
      call: () => who.api.post(`${base}/env-secrets`, { data: { name: secret, value: 'e2e-secret-new' } }),
    },
    {
      what: 'update secret',
      call: () => who.api.put(`${base}/env-secrets/${secret}`, { data: { value: 'e2e-secret-changed' } }),
    },
    { what: 'remove secret', call: () => who.api.delete(`${base}/env-secrets/${secret}`) },
  ];
}

type EnvItem = { name: string; kind: string; value: string | null };

async function envList(who: Actor, projectId: string, kind: 'plain' | 'secret'): Promise<EnvItem[]> {
  const res = await who.api.get(`/api/projects/${projectId}/env?kind=${kind}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: EnvItem[] }).items;
}

async function addVar(who: Actor, projectId: string, name: string, value: string): Promise<void> {
  const res = await who.api.post(`/api/projects/${projectId}/env-vars`, { data: { name, value } });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

const envPath = (slug: string, projectId: string): string => `/o/${slug}/p/${projectId}/desk/setup?tab=environment`;

test.describe('BR-4: the env of a project is scoped to the project and the org', () => {
  const rand = randomBytes(3).toString('hex');
  const p1Name = `E2E_P1_${rand}`;
  const p2Name = `E2E_P2_${rand}`;

  test.beforeEach(async () => {
    await addVar(cast.o, cast.p1, p1Name, 'e2e-p1-value');
    await addVar(cast.o, cast.p2, p2Name, 'e2e-p2-value');
  });

  test('TC-4.1: the admin of P1 only sees E2E_P1 in the Environment tab and adds E2E_NEW', async () => {
    const page = cast.a.page;
    const newName = `E2E_NEW_${rand}`;
    await page.goto(envPath(cast.slug, cast.p1));
    await expect(page.getByText(p1Name)).toBeVisible();
    await expect(page.getByText(p2Name)).toHaveCount(0);

    const vars = page.getByRole('region', { name: 'Environment variables' });
    await vars.getByRole('button', { name: 'Add variable' }).click();
    const form = vars.getByRole('group', { name: 'Add variable' });
    await form.getByRole('textbox', { name: 'Name' }).fill(newName);
    await form.getByRole('textbox', { name: 'Value' }).fill('e2e-new-value');
    await form.getByRole('button', { name: 'Add variable' }).click();
    await expect(vars.getByText(newName, { exact: true })).toBeVisible();
    await expect(vars.getByText(p1Name, { exact: true })).toBeVisible();
    expect((await envList(cast.o, cast.p1, 'plain')).map((e) => e.name)).toEqual(
      expect.arrayContaining([p1Name, newName]),
    );
  });

  test("TC-4.2: the admin of P1 only opening P2's Environment tab sees the not-found page, not Forbidden", async () => {
    const page = cast.a.page;
    await page.goto(envPath(cast.slug, cast.p2));
    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.getByText("You don't have access")).toHaveCount(0);
    await expect(page.getByText(p2Name)).toHaveCount(0);
  });

  test("TC-4.3: the admin of P1 only gets 404 on the 7 env routes of P2 and P2's list is unchanged", async () => {
    const before = await envList(cast.o, cast.p2, 'plain');
    expect(before.map((e) => e.name)).toContain(p2Name);
    for (const { what, call } of envCalls(cast.a, cast.p2, p2Name, `E2E_SECRET_${rand}`)) {
      await expect404(await call(), `${what} on P2`, [p2Name, 'e2e-p2-value']);
    }
    expect(await envList(cast.o, cast.p2, 'plain')).toEqual(before);
    expect(await envList(cast.o, cast.p2, 'secret')).toEqual([]);
  });

  test("TC-4.4: an owner of another org gets the not-found page and 404 on the 7 routes of org A's project", async ({
    browser,
  }) => {
    const second = await secondOrg(browser, cast.pa);
    try {
      const aName = `E2E_A_${rand}`;
      await addVar(cast.o, cast.p1, aName, 'e2e-a-value');
      const before = await envList(cast.o, cast.p1, 'plain');
      expect(before.map((e) => e.name)).toContain(aName);

      const page = second.owner.page;
      await page.goto(envPath(cast.slug, cast.p1));
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(page.getByText("You don't have access")).toHaveCount(0);
      await expect(page.getByText(aName)).toHaveCount(0);

      for (const { what, call } of envCalls(second.owner, cast.p1, aName, `E2E_SECRET_${rand}`)) {
        await expect404(await call(), `${what} on org A's project`, [aName, 'e2e-a-value']);
      }
      expect(await envList(cast.o, cast.p1, 'plain')).toEqual(before);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

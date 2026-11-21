import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ACTIVE_RUN_STATUSES,
  AgentDto,
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
import { API, CommentResult, ok, runOf, waitForStatus } from './helpers';
import { REPO_NEW, REPO_P1, buildCast, disposeCast, openTerminal, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, a member's own runs and what a member is refused (spec "E2E requirements":
 * BR-13, BR-14, BR-16, BR-17, BR-18, BR-33, BR-48, BR-49, BR-68). B is the member of P1 and P2; RB is B's run, RC is
 * C's. BR-66 (ownerless runs) is not an e2e rule. Every case runs in a fresh org (`buildCast`).
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function projectsOf(who: Actor): Promise<ProjectDto[]> {
  return pageOf(ProjectDto).parse(await ok(await who.api.get('/api/projects?pageSize=100'), 200, 'project list')).items;
}

async function rulesOf(who: Actor, projectId: string): Promise<RuleDto[]> {
  return pageOf(RuleDto).parse(
    await ok(await who.api.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rule list'),
  ).items;
}

async function agentOf(who: Actor, projectId: string): Promise<AgentDto> {
  return AgentDto.parse(await ok(await who.api.get(`/api/projects/${projectId}/agent`), 200, 'agent'));
}

async function projectOf(who: Actor, projectId: string): Promise<ProjectDto> {
  return ProjectDto.parse(await ok(await who.api.get(`/api/projects/${projectId}`), 200, 'project'));
}

async function connectionsOf(who: Actor): Promise<ConnectionDto[]> {
  return z.array(ConnectionDto).parse(await ok(await who.api.get('/api/connections'), 200, 'connection list'));
}

async function runsOf(who: Actor, projectId: string): Promise<RunListResponse['items']> {
  return RunListResponse.parse(
    await ok(await who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`), 200, 'run list'),
  ).items;
}

/** The run, read as `who`. */
const runNow = (who: Actor, runId: string) => runOf(who.page, runId);

const isActive = (status: string): boolean => ACTIVE_RUN_STATUSES.some((s) => s === status);

/** The run is still active (not ended, not paused) after a refused control. */
async function expectStillActive(who: Actor, runId: string, what: string): Promise<void> {
  const run = await runNow(who, runId);
  expect(isActive(run.status), `${what}: the run is ${run.status}`).toBe(true);
  expect(run.pauseReason, `${what}: the run was not paused`).toBeNull();
}

/** `who` stops the run and it settles as stopped: paused with the reason `stopped`. */
async function stopAndWait(who: Actor, runId: string): Promise<void> {
  await expect2xx(await who.api.post(`/api/runs/${runId}/stop`), 'runs.stop');
  await waitForStatus(who.page, runId, 'paused', 60_000);
  expect((await runNow(who, runId)).pauseReason).toBe('stopped');
}

const skillBody = (name: string): string => `---\nname: ${name}\ndescription: Ownership check.\n---\n\n# ${name}\n`;

/** O creates a prompt rule R on P1 (the Given "P1 has a rule R"). */
async function createRule(c: Cast): Promise<RuleDto> {
  const res = await c.o.api.post(`/api/projects/${c.p1}/rules`, {
    data: {
      command: `rbac-r-${randomBytes(3).toString('hex')}`,
      labelFilter: [],
      target: 'any',
      enabled: true,
      kind: 'prompt',
      prompt: 'Answer in one word.',
    },
  });
  await expect2xx(res, 'rules.create as owner');
  return RuleDto.parse(await res.json());
}

/** O puts a skill S on P1 (the Given "P1 has a skill S"); the fake board is shared, so the name is unique and the skill is removed after. */
async function createSkill(c: Cast): Promise<SkillDto> {
  const name = `rbac-s-${randomBytes(3).toString('hex')}`;
  await expect2xx(
    await c.o.api.put(`/api/projects/${c.p1}/skills/${name}`, {
      data: { body: skillBody(name), message: `add ${name}` },
    }),
    'skills.put as owner',
  );
  return SkillDto.parse(await ok(await c.o.api.get(`/api/projects/${c.p1}/skills/${name}`), 200, 'skills.get'));
}

test.describe('BR-13: a member attaches to a run they own', () => {
  test('TC-13.1: B opening the terminal of RB, which B owns, stays attached and is not closed 4403', async () => {
    const { b, rb } = cast;
    expect((await runNow(b, rb)).ownerUserId, 'RB is owned by B').toBe(b.userId);

    const attach = await openTerminal(b, `/api/runs/${rb}/terminal`);
    expect(attach.code, 'the socket stays open (not closed 4403)').toBeNull();
  });
});

test.describe('BR-14: a member controls a run they own', () => {
  test('TC-14.1: B cancelling RB is accepted and RB shows as cancelled', async () => {
    const { b, rb } = cast;
    await expect2xx(await b.api.post(`/api/runs/${rb}/cancel`), 'runs.cancel');
    await waitForStatus(b.page, rb, 'cancelled', 30_000);
  });

  test('TC-14.2: B stopping RB is accepted and RB shows as stopped', async () => {
    const { b, rb } = cast;
    await stopAndWait(b, rb);
  });

  test('TC-14.3: B finishing RB is accepted and RB shows as finished', async () => {
    const { b, rb } = cast;
    await expect2xx(await b.api.post(`/api/runs/${rb}/finish`), 'runs.finish');
    await waitForStatus(b.page, rb, 'succeeded', 60_000);
  });

  test('TC-14.4: B resuming RB, which B stopped, is accepted and RB is active again', async () => {
    const { b, rb } = cast;
    await stopAndWait(b, rb);

    await expect2xx(await b.api.post(`/api/runs/${rb}/resume`), 'runs.resume');
    await expect
      .poll(async () => isActive((await runNow(b, rb)).status), { timeout: 90_000, intervals: [200, 500, 1000] })
      .toBe(true);
  });
});

test.describe('BR-16: a member is refused the connection routes', () => {
  test('TC-16.1: B listing connections gets 403 and no connection is named in the refusal', async () => {
    const { b, o, connectionId } = cast;
    const res = await b.api.get('/api/connections');
    await expect403(res, 'connections.list');
    expect(await res.text(), 'the refusal names no connection').not.toContain(connectionId);
    expect((await connectionsOf(o)).map((c) => c.id)).toEqual([connectionId]);
  });

  test('TC-16.2: B installing a connection gets 403 and no connection is added', async () => {
    const { b, o, connectionId } = cast;
    await expect403(await b.api.post('/api/connections/fake/install'), 'connections.install');
    expect((await connectionsOf(o)).map((c) => c.id)).toEqual([connectionId]);
  });

  test('TC-16.3: B syncing connections gets 403 and no connection is added', async () => {
    const { b, o, connectionId } = cast;
    await expect403(await b.api.post('/api/connections/fake/sync'), 'connections.sync');
    expect((await connectionsOf(o)).map((c) => c.id)).toEqual([connectionId]);
  });
});

test.describe('BR-17: a member is refused the agent credential', () => {
  test('TC-17.1: B putting a credential on P1 gets 403, the agent reads back unchanged and the value is not echoed', async () => {
    const { b, o, p1 } = cast;
    const before = await agentOf(o, p1);
    const value = `sk-ant-e2e-secret-${randomBytes(8).toString('hex')}`;

    const res = await b.api.put(`/api/agents/${before.id}/credential`, { data: { type: 'api_key', value } });
    await expect403(res, 'agents.putCredential');
    expect(await res.text(), 'the refusal does not contain the value').not.toContain(value);
    expect(await agentOf(o, p1)).toEqual(before);
    expect(await agentOf(b, p1)).toEqual(before);
  });
});

test.describe('BR-18: a member is refused project create and delete', () => {
  test("TC-18.1: B creating a project gets 403 and B's project list is unchanged", async () => {
    const { b, connectionId } = cast;
    const before = await projectsOf(b);

    await expect403(
      await b.api.post('/api/projects', { data: { connectionId, repoPath: REPO_NEW, triggerMode: 'webhook' } }),
      'projects.create',
    );
    expect(await projectsOf(b)).toEqual(before);
  });

  test("TC-18.2: B removing P1 gets 403 and P1 is still in B's list", async () => {
    const { b, p1 } = cast;
    await expect403(await b.api.delete(`/api/projects/${p1}`), 'projects.remove');
    expect((await projectsOf(b)).map((p) => p.id)).toContain(p1);
  });
});

test.describe('BR-33: a member is refused every edit area', () => {
  test('TC-33.1: B updating the settings of P1 gets 403 and the project reads back unchanged', async () => {
    const { b, o, p1 } = cast;
    const before = await projectOf(o, p1);

    await expect403(await b.api.patch(`/api/projects/${p1}`, { data: { maxConcurrentRuns: 5 } }), 'projects.update');
    expect(await projectOf(o, p1)).toEqual(before);
  });

  test('TC-33.2: B changing the agent of P1 gets 403 and the agent reads back unchanged', async () => {
    const { b, o, p1 } = cast;
    const before = await agentOf(o, p1);

    await expect403(
      await b.api.put(`/api/projects/${p1}/agent`, {
        data: { model: before.model, timeoutSeconds: before.timeoutSeconds + 60 },
      }),
      'agents.put',
    );
    expect(await agentOf(o, p1)).toEqual(before);
  });

  test('TC-33.3: B creating a rule on P1 gets 403 and the rule list of P1 is unchanged', async () => {
    const { b, o, p1 } = cast;
    const before = await rulesOf(o, p1);

    await expect403(
      await b.api.post(`/api/projects/${p1}/rules`, {
        data: {
          command: 'rbac-member-rule',
          labelFilter: [],
          target: 'any',
          enabled: true,
          kind: 'prompt',
          prompt: 'A rule from a member.',
        },
      }),
      'rules.create',
    );
    expect(await rulesOf(o, p1)).toEqual(before);
  });

  test('TC-33.4: B updating a rule R gets 403 and R reads back unchanged', async () => {
    const { b, o, p1 } = cast;
    const r = await createRule(cast);

    await expect403(
      await b.api.patch(`/api/rules/${r.id}`, { data: { prompt: 'A new body from a member.' } }),
      'rules.update',
    );
    expect((await rulesOf(o, p1)).find((x) => x.id === r.id)).toEqual(r);
  });

  test('TC-33.5: B removing a rule R gets 403 and R is still in the rule list', async () => {
    const { b, o, p1 } = cast;
    const r = await createRule(cast);

    await expect403(await b.api.delete(`/api/rules/${r.id}`), 'rules.remove');
    expect((await rulesOf(o, p1)).find((x) => x.id === r.id)).toEqual(r);
  });

  test('TC-33.6: B putting and removing a skill S gets 403 for both and S reads back unchanged', async () => {
    const { b, o, p1 } = cast;
    const s = await createSkill(cast);
    const path = `/api/projects/${p1}/skills/${s.name}`;
    try {
      await expect403(
        await b.api.put(path, { data: { body: skillBody(`${s.name}-changed`), message: 'edit', sha: s.sha } }),
        'skills.put',
      );
      await expect403(await b.api.delete(`${path}?message=remove`), 'skills.remove');
      expect(SkillDto.parse(await ok(await o.api.get(path), 200, 'skills.get'))).toEqual(s);
    } finally {
      await o.api.delete(`${path}?message=cleanup`).catch(() => null);
    }
  });

  test('TC-33.7: B putting the setup script of P1 gets 403 and the script reads back unchanged', async () => {
    const { b, o, p1 } = cast;
    const read = async (): Promise<SetupScriptDto | null> =>
      SetupScriptDto.nullable().parse(
        await ok(await o.api.get(`/api/projects/${p1}/setup-script`), 200, 'setupScript.get'),
      );
    const before = await read();

    await expect403(
      await b.api.put(`/api/projects/${p1}/setup-script`, {
        data: { body: '#!/usr/bin/env bash\necho member\n', baseVersion: before?.version ?? null },
      }),
      'setupScript.put',
    );
    expect(await read()).toEqual(before);
  });

  test('TC-33.8: B starting a setup test on P1 gets 403 and no setup test is started', async () => {
    const { b, o, p1 } = cast;
    const latest = async (): Promise<SetupTestDto | null> =>
      SetupTestDto.nullable().parse(await ok(await o.api.get(`/api/projects/${p1}/setup-tests/latest`), 200, 'latest'));
    const before = await latest();

    await expect403(
      await b.api.post(`/api/projects/${p1}/setup-tests`, { data: { script: 'echo member\n' } }),
      'setupTests.create',
    );
    expect(await latest()).toEqual(before);
  });

  test('TC-33.9: B listing the rules of P1 gets 200 with R in the list', async () => {
    const { b, p1 } = cast;
    const r = await createRule(cast);

    const rules = await rulesOf(b, p1);
    expect(rules.find((x) => x.id === r.id)).toEqual(r);
  });
});

test.describe("BR-48: a member cannot attach to another member's run", () => {
  test('TC-48.1: B opening the terminal of RC, which C owns, is closed 4403', async () => {
    const { b, c, rc } = cast;
    expect((await runNow(c, rc)).ownerUserId, 'RC is owned by C').toBe(c.userId);

    expect(await openTerminal(b, `/api/runs/${rc}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });
});

test.describe("BR-49: a member cannot control another member's run", () => {
  test('TC-49.1: B cancelling RC gets 403 and RC is still active', async () => {
    const { b, rc } = cast;
    await expect403(await b.api.post(`/api/runs/${rc}/cancel`), 'runs.cancel');
    await expectStillActive(b, rc, 'after runs.cancel');
  });

  test('TC-49.2: B stopping RC gets 403 and RC is still active', async () => {
    const { b, rc } = cast;
    await expect403(await b.api.post(`/api/runs/${rc}/stop`), 'runs.stop');
    await expectStillActive(b, rc, 'after runs.stop');
  });

  test('TC-49.3: B finishing RC gets 403 and RC is still active', async () => {
    const { b, rc } = cast;
    await expect403(await b.api.post(`/api/runs/${rc}/finish`), 'runs.finish');
    await expectStillActive(b, rc, 'after runs.finish');
  });

  test('TC-49.4: B resuming RC, which C stopped, gets 403 and RC is still stopped', async () => {
    const { b, c, rc } = cast;
    await stopAndWait(c, rc);

    await expect403(await b.api.post(`/api/runs/${rc}/resume`), 'runs.resume');
    const run = await runNow(b, rc);
    expect(run.status).toBe('paused');
    expect(run.pauseReason).toBe('stopped');
  });
});

/**
 * The Given of BR-68: O switches P1 to polling (every 30 minutes; a tick can still land on a wall-clock :00/:30, so each case switches P1 back to webhook mode, which
 * deletes the schedule), then B's
 * linked identity comments `/rbac-run` on a new P1 ticket with `deliver: 'poll'`; the comment is queued, not polled.
 */
async function queuePolledComment(c: Cast): Promise<void> {
  await ok(
    await c.o.api.patch(`/api/projects/${c.p1}`, { data: { triggerMode: 'polling', pollIntervalSeconds: 1800 } }),
    200,
    'switch P1 to polling',
  );
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await c.b.api.post('/dev/fake/tickets', {
      data: { repoPath: REPO_P1, number: ticketNumber, kind: 'pr', title: `rbac poll ${c.b.handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await c.b.api.post('/dev/fake/comments', {
        data: {
          repoPath: REPO_P1,
          ticketNumber,
          body: '/rbac-run',
          deliver: 'poll',
          projectId: c.p1,
          author: c.b.handle,
        },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.outcome, 'the comment is queued for the poller').toBe('queued_for_poll');
}

/** Switches P1 back to webhook mode (deletes `poll-<P1>`); a failure here must not mask the case's own result. */
async function restoreWebhook(c: Cast): Promise<void> {
  await c.o.api.patch(`/api/projects/${c.p1}`, { data: { triggerMode: 'webhook' } }).catch(() => null);
}

test.describe('BR-68: poll now', () => {
  test('TC-68.1: B polling P1 now is accepted, the queued comment is picked up and a run owned by B appears', async () => {
    const { b, o, p1, rb, rc } = cast;
    let polled: string | undefined;
    try {
      await queuePolledComment(cast);
      expect((await runsOf(b, p1)).map((r) => r.id).sort(), 'nothing has been polled yet').toEqual([rb, rc].sort());
      await expect2xx(await b.api.post(`/api/projects/${p1}/connection/poll`), 'projects.pollNow');
      await expect
        .poll(async () => (await runsOf(b, p1)).find((r) => r.id !== rb && r.id !== rc)?.id, {
          timeout: 60_000,
          intervals: [500, 1000],
        })
        .toBeTruthy();
      const run = (await runsOf(b, p1)).find((r) => r.id !== rb && r.id !== rc);
      polled = run?.id;
      expect(run?.ownerUserId, 'the new run is owned by B').toBe(b.userId);
      expect(run?.triggerSource, 'the poller started it').toBe('polling');
    } finally {
      await restoreWebhook(cast);
      if (polled) await o.api.post(`/api/runs/${polled}/cancel`).catch(() => null);
    }
  });

  test('TC-68.2: V polling P1 now gets 403 and no new run appears in P1', async () => {
    const { v, b, o, p1, rb, rc } = cast;
    try {
      await queuePolledComment(cast);

      await expect403(await v.api.post(`/api/projects/${p1}/connection/poll`), 'projects.pollNow');
      // A poll that was wrongly accepted starts its run within seconds.
      await sleep(5_000);
      expect((await runsOf(b, p1)).map((r) => r.id).sort()).toEqual([rb, rc].sort());
    } finally {
      await restoreWebhook(cast);
      const extra = (await runsOf(o, p1).catch(() => [])).filter((r) => r.id !== rb && r.id !== rc);
      for (const r of extra) await o.api.post(`/api/runs/${r.id}/cancel`).catch(() => null);
    }
  });
});

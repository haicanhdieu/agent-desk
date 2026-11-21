import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import { AgentDto, ProjectDto, RuleDto, pageOf } from '@agentdesk/contracts';
import { z } from 'zod';
import { API, ok, waitForStatus } from './helpers';
import {
  buildCast,
  disposeCast,
  disposeSecondOrg,
  openTerminal,
  REPO_NEW,
  secondOrg,
  type Actor,
  type Cast,
} from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, refusals before lookup, missing targets, wrong-state controls and the 403 body
 * (spec "E2E requirements": BR-6, BR-7, BR-9, BR-12). Every case runs in a fresh org (`buildCast`).
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

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${await body(res)}`).toBe(status);
}

/** The problem body of a refusal: the "not allowed" wording and a requestId (the spec leaves title or detail open, Q4). */
async function expectNotAllowedBody(res: APIResponse, what: string): Promise<string> {
  await expectStatus(res, 403, what);
  const text = await res.text();
  expect(text, `${what}: problem body`).toMatch(/not allowed for your role here/i);
  const parsed = z.object({ requestId: z.string().min(1) }).safeParse(JSON.parse(text));
  expect(parsed.success, `${what}: the body carries a requestId: ${text}`).toBe(true);
  return text;
}

/** O finishes RC and waits until it has ended (the Given of the wrong-state cases). */
async function finishRc(c: Cast): Promise<void> {
  const res = await c.o.api.post(`/api/runs/${c.rc}/finish`);
  expect(res.ok(), `runs.finish: ${await body(res)}`).toBe(true);
  await waitForStatus(c.o.page, c.rc, 'succeeded', 60_000);
}

async function agentOf(who: Actor, projectId: string): Promise<AgentDto> {
  return AgentDto.parse(await ok(await who.api.get(`/api/projects/${projectId}/agent`), 200, 'agent'));
}

async function ruleOfP1(c: Cast): Promise<RuleDto> {
  const rules = pageOf(RuleDto).parse(
    await ok(await c.o.api.get(`/api/projects/${c.p1}/rules?pageSize=100`), 200, 'rule list'),
  ).items;
  const rule = rules[0];
  expect(rule, 'P1 has a rule').toBeTruthy();
  return RuleDto.parse(rule);
}

test.describe('BR-6: no permission anywhere gives 403 for any id or body', () => {
  test('TC-6.1: a viewer patching a random well-formed rule id gets 403, not 404', async () => {
    const { v } = cast;
    const res = await v.api.patch(`/api/rules/${randomUUID()}`, { data: { prompt: 'A new body.' } });
    await expectStatus(res, 403, 'rules.update random uuid');
  });

  test('TC-6.2: a viewer patching a rule id that is not a UUID gets 403, not 404 or 400', async () => {
    const { v } = cast;
    const res = await v.api.patch('/api/rules/not-a-uuid', { data: { prompt: 'A new body.' } });
    await expectStatus(res, 403, 'rules.update malformed id');
  });

  test('TC-6.3: a viewer patching a rule with a body that fails validation gets 403, not 400', async () => {
    const { v } = cast;
    const rule = await ruleOfP1(cast);
    const res = await v.api.patch(`/api/rules/${rule.id}`, { data: { enabled: 'not-a-boolean', unknownField: 1 } });
    await expectStatus(res, 403, 'rules.update invalid body');
  });

  test("TC-6.4: a member putting a credential on another org's agent gets 403, not 404", async ({ browser }) => {
    const { b, pa } = cast;
    const y = await secondOrg(browser, pa);
    try {
      const agent = await agentOf(y.owner, y.project);
      const res = await b.api.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
      });
      await expectStatus(res, 403, 'agents.putCredential on another org agent');
    } finally {
      await disposeSecondOrg(y);
    }
  });
});

test.describe('BR-7: a missing or other-org resource gives 404 to a permitted caller', () => {
  test("TC-7.1: an admin requesting another org's project gets 404", async ({ browser }) => {
    const { a, pa } = cast;
    const y = await secondOrg(browser, pa);
    try {
      await expectStatus(await a.api.get(`/api/projects/${y.project}`), 404, "projects.get another org's project");
    } finally {
      await disposeSecondOrg(y);
    }
  });

  test('TC-7.2: an admin patching a random well-formed rule id gets 404', async () => {
    const { a } = cast;
    const res = await a.api.patch(`/api/rules/${randomUUID()}`, { data: { prompt: 'A new body.' } });
    await expectStatus(res, 404, 'rules.update random uuid as admin of P1');
  });

  test("TC-7.3: an owner opening the terminal of another org's run is closed 4403", async ({ browser }) => {
    const { o, pa } = cast;
    const y = await secondOrg(browser, pa);
    try {
      expect(await openTerminal(o, `/api/runs/${y.run}/terminal`)).toEqual({ code: 4403, bytes: 0 });
    } finally {
      await disposeSecondOrg(y);
    }
  });

  test('TC-7.4: an owner opening the terminal of a random well-formed run id is closed 4403', async () => {
    const { o } = cast;
    expect(await openTerminal(o, `/api/runs/${randomUUID()}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });

  test('TC-7.5: an admin getting an existing in-scope project gets 200 with its data', async () => {
    const { a, p1 } = cast;
    const project = ProjectDto.parse(await ok(await a.api.get(`/api/projects/${p1}`), 200, 'projects.get P1'));
    expect(project.id).toBe(p1);
  });
});

test.describe('BR-9: wrong-state controls give 409, no permission gives 403', () => {
  test('TC-9.1: a viewer cancelling a finished run gets 403, not 409', async () => {
    const { v, rc } = cast;
    await finishRc(cast);
    await expectStatus(await v.api.post(`/api/runs/${rc}/cancel`), 403, 'runs.cancel finished run as viewer');
  });

  test('TC-9.2: an admin cancelling a finished run gets 409', async () => {
    const { a, rc } = cast;
    await finishRc(cast);
    await expectStatus(await a.api.post(`/api/runs/${rc}/cancel`), 409, 'runs.cancel finished run as admin');
  });

  test('TC-9.3: an admin stopping a finished run gets 409', async () => {
    const { a, rc } = cast;
    await finishRc(cast);
    await expectStatus(await a.api.post(`/api/runs/${rc}/stop`), 409, 'runs.stop finished run as admin');
  });

  test('TC-9.4: an admin resuming an active run gets 409', async () => {
    const { a, rc } = cast;
    await expectStatus(await a.api.post(`/api/runs/${rc}/resume`), 409, 'runs.resume active run as admin');
  });

  test('TC-9.5: a viewer resuming an active run gets 403, not 409', async () => {
    const { v, rc } = cast;
    await expectStatus(await v.api.post(`/api/runs/${rc}/resume`), 403, 'runs.resume active run as viewer');
  });

  test('TC-9.6: an admin finishing a finished run gets 409', async () => {
    const { a, rc } = cast;
    await finishRc(cast);
    await expectStatus(await a.api.post(`/api/runs/${rc}/finish`), 409, 'runs.finish finished run as admin');
  });
});

test.describe('BR-12: the 403 body says not allowed, with a requestId', () => {
  test('TC-12.1: the refusal of a viewer cancelling a run says not allowed and carries a requestId', async () => {
    const { v, rb } = cast;
    await expectNotAllowedBody(await v.api.post(`/api/runs/${rb}/cancel`), 'runs.cancel as viewer');
  });

  test("TC-12.2: the refusal for another org's agent credential names nothing of that org and holds no credential", async ({
    browser,
  }) => {
    const { v, pa } = cast;
    const y = await secondOrg(browser, pa);
    try {
      const agent = await agentOf(y.owner, y.project);
      const secret = `sk-ant-e2e-secret-${randomBytes(8).toString('hex')}`;
      await ok(
        await y.owner.api.put(`/api/agents/${agent.id}/credential`, { data: { type: 'api_key', value: secret } }),
        200,
        'set the credential of Y',
      );

      const text = await expectNotAllowedBody(
        await v.api.put(`/api/agents/${agent.id}/credential`, {
          data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
        }),
        'agents.putCredential on another org agent as viewer',
      );
      // Y's org is created as name `RBAC Y <tag>` and slug `rbac-y-<tag>`, its project on REPO_NEW; the fixed
      // prefixes catch any echo of the name or slug whatever the tag.
      for (const detail of [y.orgId, y.project, agent.id, y.run, secret, 'RBAC Y', 'rbac-y-', REPO_NEW]) {
        expect(text, 'the refusal names nothing of org Y').not.toContain(detail);
      }
    } finally {
      await disposeSecondOrg(y);
    }
  });

  test('TC-12.3: the refusal of a member listing connections says not allowed and carries a requestId', async () => {
    const { b } = cast;
    await expectNotAllowedBody(await b.api.get('/api/connections'), 'connections.list as member');
  });
});

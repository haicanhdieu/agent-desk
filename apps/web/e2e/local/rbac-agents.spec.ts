import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { AgentDto, ProblemSchema, RuleDto, pageOf } from '@agentdesk/contracts';
import { API, createAgent, newTokenValue, ok } from './helpers';
import { buildCast, disposeCast, secondOrg, disposeSecondOrg, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for who may see and change agents (spec "E2E requirements": BR-42, BR-46, BR-47). Every case runs
 * in a fresh org (`buildCast`): O owner, D org admin, A admin of P1 only, C member of P1, V org viewer. Each denial is
 * proved at the API route with the person's own session, then the owner reads the agents back to see nothing changed.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal. */
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

const rand = (): string => randomBytes(3).toString('hex');

async function listOf(request: APIRequestContext, projectId: string): Promise<AgentDto[]> {
  return pageOf(AgentDto).parse(
    await ok(await request.get(`/api/projects/${projectId}/agents?pageSize=100`), 200, 'agents'),
  ).items;
}

async function pointers(res: APIResponse): Promise<string[]> {
  const problem = ProblemSchema.parse(JSON.parse(await res.text()));
  return (problem.errors ?? []).map((e) => e.pointer);
}

/** Every agent route a person without the permission may try, on one existing agent of `projectId`. */
async function denyEverything(who: Actor, projectId: string, agentId: string, label: string): Promise<void> {
  const secret = newTokenValue();
  const newName = `denied-${rand()}`;
  const answers: [string, APIResponse][] = [
    ['list', await who.api.get(`/api/projects/${projectId}/agents`)],
    [
      'create',
      await who.api.post(`/api/projects/${projectId}/agents`, { data: { provider: 'claude', name: newName } }),
    ],
    ['edit', await who.api.patch(`/api/agents/${agentId}`, { data: { name: `renamed-${rand()}` } })],
    ['set default', await who.api.post(`/api/agents/${agentId}/default`)],
    ['delete', await who.api.delete(`/api/agents/${agentId}`)],
    ['test', await who.api.post(`/api/agents/${agentId}/test`)],
    ['models', await who.api.get(`/api/agents/${agentId}/models`)],
    [
      'credential',
      await who.api.put(`/api/agents/${agentId}/credential`, { data: { type: 'api_key', value: secret } }),
    ],
  ];
  for (const [what, res] of answers) {
    expect(res.status(), `${label}: ${what} answers 403 (${await res.text()})`).toBe(403);
  }
}

/** The agents of `projectId` as the owner sees them, to compare before and after a denied attempt. */
async function snapshot(cast: Cast, projectId: string): Promise<AgentDto[]> {
  return (await listOf(cast.o.api, projectId)).sort((x, y) => x.id.localeCompare(y.id));
}

for (const [who, id] of [
  ['member', 'TC-46.3'],
  ['viewer', 'TC-46.4'],
] as const) {
  test(`${id}: a ${who} gets 403 on every agent route and no agent is created, changed, deleted or given a credential`, async () => {
    const actor = who === 'member' ? cast.c : cast.v;
    const [existing] = await listOf(cast.o.api, cast.p1);
    expect(existing, 'P1 has an agent').toBeTruthy();
    const target = AgentDto.parse(existing);
    const before = await snapshot(cast, cast.p1);

    await denyEverything(actor, cast.p1, target.id, who);

    // Read the agents as an admin: nothing was created, changed, deleted or given a credential.
    const after = await snapshot(cast, cast.p1);
    expect(after).toEqual(before);
    expect(after.some((a) => a.name.startsWith('denied-'))).toBe(false);
  });
}

/**
 * Every agent route, as one person, on a project and an agent they cannot see: all must answer 404 (never 403). The
 * bodies are valid, so a 404 comes from the scope check and not from validation.
 */
async function hiddenEverything(who: Actor, projectId: string, agentId: string): Promise<[string, APIResponse][]> {
  const secret = newTokenValue();
  return [
    ['list', await who.api.get(`/api/projects/${projectId}/agents`)],
    [
      'create',
      await who.api.post(`/api/projects/${projectId}/agents`, {
        data: { provider: 'claude', name: `hidden-${rand()}` },
      }),
    ],
    ['get', await who.api.get(`/api/projects/${projectId}/agent`)],
    [
      'compat put',
      await who.api.put(`/api/projects/${projectId}/agent`, { data: { model: 'sonnet', timeoutSeconds: 3600 } }),
    ],
    ['get by id (models)', await who.api.get(`/api/agents/${agentId}/models`)],
    ['edit', await who.api.patch(`/api/agents/${agentId}`, { data: { name: `renamed-${rand()}` } })],
    ['set default', await who.api.post(`/api/agents/${agentId}/default`)],
    ['test', await who.api.post(`/api/agents/${agentId}/test`)],
    [
      'credential',
      await who.api.put(`/api/agents/${agentId}/credential`, { data: { type: 'api_key', value: secret } }),
    ],
    ['delete', await who.api.delete(`/api/agents/${agentId}`)],
  ];
}

test('TC-47.1: an admin on P1 only gets 404 on P2 agents and P1 lists no P2 agent', async () => {
  const { a, o, p1, p2 } = cast;
  const p2Only = await createAgent(o.api, 'owner', p2, { provider: 'claude', name: `P2 only ${rand()}` });
  const before = await snapshot(cast, p2);

  for (const [what, res] of await hiddenEverything(a, p2, p2Only.id)) {
    expect(res.status(), `${what} on P2 answers 404 (${await res.text()})`).toBe(404);
  }

  const mine = await listOf(a.api, p1);
  expect(mine.map((x) => x.id)).not.toContain(p2Only.id);
  expect(mine.length).toBeGreaterThan(0);
  expect(await snapshot(cast, p2), 'P2 agents are unchanged').toEqual(before);
});

test("TC-47.2: another org's agent id answers 404, not 403, with no org or secret text", async ({ browser }) => {
  const { d, pa } = cast;
  const second = await secondOrg(browser, pa);
  try {
    const before = await snapshot({ ...cast, o: second.owner }, second.project);
    const other = AgentDto.parse(before[0]);
    for (const [what, res] of await hiddenEverything(d, second.project, other.id)) {
      const text = await res.text();
      expect(res.status(), `${what} answers 404 (${text})`).toBe(404);
      expect(text).not.toContain(second.orgId);
      expect(text).not.toContain(second.slug);
      expect(text).not.toContain('sk-ant');
    }
    expect(
      await snapshot({ ...cast, o: second.owner }, second.project),
      "the other org's agents are unchanged",
    ).toEqual(before);
  } finally {
    await disposeSecondOrg(second);
  }
});

/** The allowed side of the role matrix: this person creates, renames, makes default and deletes an agent on `projectId`. */
async function manageThrowaway(who: Actor, projectId: string): Promise<void> {
  const keep = AgentDto.parse((await listOf(who.api, projectId)).find((x) => x.isDefault));
  const made = AgentDto.parse(
    await ok(
      await who.api.post(`/api/projects/${projectId}/agents`, {
        data: { provider: 'claude', name: `throwaway-${rand()}` },
      }),
      201,
      'create',
    ),
  );
  try {
    const name = `renamed-${rand()}`;
    const renamed = AgentDto.parse(
      await ok(await who.api.patch(`/api/agents/${made.id}`, { data: { name } }), 200, 'rename'),
    );
    expect(renamed.name).toBe(name);
    const made2 = AgentDto.parse(await ok(await who.api.post(`/api/agents/${made.id}/default`), 200, 'default'));
    expect(made2.isDefault).toBe(true);
    // Back to the original default: the default agent cannot be deleted.
    await ok(await who.api.post(`/api/agents/${keep.id}/default`), 200, 'default back');
  } finally {
    const res = await who.api.delete(`/api/agents/${made.id}`);
    expect(res.status(), `delete answers 2xx (${await res.text()})`).toBeLessThan(300);
  }
  expect((await listOf(who.api, projectId)).map((x) => x.id)).not.toContain(made.id);
}

test('BR-47 control: an admin on P1 creates, renames, sets default and deletes an agent on P1', async () => {
  await manageThrowaway(cast.a, cast.p1);
});

test('BR-47 control: an org admin creates, renames, sets default and deletes an agent on P2', async () => {
  await manageThrowaway(cast.d, cast.p2);
});

test('TC-42.2: a rule of P1 cannot name an agent of P2: 422 on /agentId and no rule is created or changed', async () => {
  const { d, o, p1, p2 } = cast;
  const p2Only = await createAgent(o.api, 'owner', p2, { provider: 'claude', name: `P2 only ${rand()}` });
  const rulesOf = async (): Promise<RuleDto[]> =>
    pageOf(RuleDto).parse(await ok(await d.api.get(`/api/projects/${p1}/rules?pageSize=100`), 200, 'rules')).items;
  const before = await rulesOf();
  const existing = RuleDto.parse(before.find((r) => r.command === 'rbac-run'));

  const created = await d.api.post(`/api/projects/${p1}/rules`, {
    data: {
      command: `cross-${rand()}`,
      labelFilter: [],
      target: 'any',
      enabled: true,
      kind: 'prompt',
      prompt: 'Reply with one short sentence.',
      agentId: p2Only.id,
    },
  });
  expect(created.status(), await created.text()).toBe(422);
  expect(await pointers(created)).toContain('/agentId');

  const patched = await d.api.patch(`/api/rules/${existing.id}`, { data: { agentId: p2Only.id } });
  expect(patched.status(), await patched.text()).toBe(422);
  expect(await pointers(patched)).toContain('/agentId');

  expect(await rulesOf(), 'no rule was created or changed').toEqual(before);
});

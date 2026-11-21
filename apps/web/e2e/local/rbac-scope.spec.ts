import { expect, test, type APIResponse } from '@playwright/test';
import {
  AccessDto,
  AgentDto,
  ConnectionDto,
  ProjectDto,
  RuleDto,
  RunListResponse,
  pageOf,
  type RunDto,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { API, ok, runOf, waitForStatus } from './helpers';
import { REPO_P2, buildCast, disposeCast, openTerminal, streamStatus, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, project scope in lists and lookups (spec "E2E requirements": BR-27, BR-28,
 * BR-42, BR-44). A is the admin of P1 only, B the member of P1 and P2, V the org viewer; RP2 is the run in P2. Every
 * case runs in a fresh org (`buildCast`).
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

const ProjectPage = pageOf(ProjectDto);

async function projectPage(who: Actor, query = ''): Promise<{ raw: string; page: z.infer<typeof ProjectPage> }> {
  const res = await who.api.get(`/api/projects${query}`);
  const raw = await res.text();
  expect(res.status(), `projects.list${query}: ${raw}`).toBe(200);
  return { raw, page: ProjectPage.parse(JSON.parse(raw)) };
}

/** What a refusal must not carry: a value the caller never sent (a request URL that holds it echoes nothing new). */
function expectNoneOf(text: string, leaks: string[], what: string, url = ''): void {
  for (const leak of leaks) {
    if (leak !== '' && url.includes(leak)) continue;
    expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
  }
}

/** The answer is a 404 whose body names nothing of the out-of-scope project, by id, name, repo path or content. */
async function expectNotFound(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(404);
  expectNoneOf(text, leaks, what, res.url());
}

/** The answer is a 403 whose body names nothing of the org's connections. */
async function expectForbidden(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(403);
  expectNoneOf(text, leaks, what, res.url());
}

/**
 * Everything of P2 and RP2 that an out-of-scope caller must not learn: ids, the repo path (which is also its name),
 * and the title of RP2's ticket (the fake board names it after O, who started RP2).
 */
async function p2Leaks(c: Cast): Promise<{ leaks: string[]; run: RunDto }> {
  const run = await runOf(c.o.page, c.rp2);
  return { leaks: [c.p2, c.rp2, REPO_P2, 'demo-2', run.ticket.title, run.ticket.ref], run };
}

async function agentOf(who: Actor, projectId: string): Promise<AgentDto> {
  return AgentDto.parse(await ok(await who.api.get(`/api/projects/${projectId}/agent`), 200, 'agents.get'));
}

async function runsOf(who: Actor, projectId: string): Promise<RunListResponse> {
  return RunListResponse.parse(
    await ok(await who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`), 200, 'runs.list'),
  );
}

async function accessOf(who: Actor): Promise<AccessDto> {
  return AccessDto.parse(await ok(await who.api.get('/api/me/access'), 200, 'me access'));
}

const idsOf = (items: { id: string }[]): string[] => items.map((i) => i.id).sort();

test.describe('BR-27: the project list shows only projects in scope', () => {
  test('TC-27.1: an admin of P1 only lists P1 and total is 1', async () => {
    const { a, p1, p2 } = cast;
    const { raw, page } = await projectPage(a, '?pageSize=100');
    expect(idsOf(page.items)).toEqual([p1]);
    expect(page.total).toBe(1);
    expectNoneOf(raw, [p2, REPO_P2, 'demo-2'], 'projects.list as admin of P1');
  });

  test('TC-27.2: a member of P1 and P2 lists both and total is 2', async () => {
    const { b, p1, p2 } = cast;
    const { page } = await projectPage(b, '?pageSize=100');
    expect(idsOf(page.items)).toEqual([p1, p2].sort());
    expect(page.total).toBe(2);
  });

  test('TC-27.3: a member of two projects pages one project at a time and total stays 2 on both pages', async () => {
    const { b, p1, p2 } = cast;
    const first = (await projectPage(b, '?page=1&pageSize=1')).page;
    const second = (await projectPage(b, '?page=2&pageSize=1')).page;

    expect(first.items, 'the first page holds one project').toHaveLength(1);
    expect(second.items, 'the second page holds one project').toHaveLength(1);
    expect(first.total, 'total on the first page').toBe(2);
    expect(second.total, 'total on the second page').toBe(2);
    expect(idsOf([...first.items, ...second.items]), 'the two pages are P1 and P2, each once').toEqual([p1, p2].sort());
  });

  test('TC-27.4: an org viewer lists every project and total is 2', async () => {
    const { v, p1, p2 } = cast;
    const { page } = await projectPage(v, '?pageSize=100');
    expect(idsOf(page.items)).toEqual([p1, p2].sort());
    expect(page.total).toBe(2);
  });
});

test.describe('BR-28: an out-of-scope project is 404, its terminal closes 4403', () => {
  test('TC-28.1: an admin of P1 getting P2 and listing the runs of P2 gets 404, naming nothing of P2', async () => {
    const { a, p2 } = cast;
    const { leaks } = await p2Leaks(cast);
    await expectNotFound(await a.api.get(`/api/projects/${p2}`), 'projects.get P2', leaks);
    await expectNotFound(await a.api.get(`/api/projects/${p2}/runs?filter=all&pageSize=100`), 'runs.list P2', leaks);
  });

  test('TC-28.2: an admin of P1 reading RP2 by number, log and transcript gets 404, naming nothing of RP2', async () => {
    const { a, p2, rp2 } = cast;
    const { leaks, run } = await p2Leaks(cast);
    await expectNotFound(await a.api.get(`/api/projects/${p2}/runs/${run.number}`), 'runs.byNumber RP2', leaks);
    await expectNotFound(await a.api.get(`/api/runs/${rp2}/log`), 'runs.log RP2', leaks);
    await expectNotFound(await a.api.get(`/api/runs/${rp2}/transcript`), 'runs.transcript RP2', leaks);
  });

  test('TC-28.3: an admin of P1 listing the rules and skills of P2 gets 404, naming nothing of P2', async () => {
    const { a, o, p2 } = cast;
    const rules = pageOf(RuleDto).parse(
      await ok(await o.api.get(`/api/projects/${p2}/rules?pageSize=100`), 200, 'rules.list as owner'),
    ).items;
    expect(rules.length, 'P2 has a rule for the 404 body to leak').toBeGreaterThan(0);
    const { leaks } = await p2Leaks(cast);
    const ruleLeaks = rules.flatMap((r) => [r.command, ...(r.prompt ? [r.prompt] : [])]);

    await expectNotFound(await a.api.get(`/api/projects/${p2}/rules`), 'rules.list P2', [...leaks, ...ruleLeaks]);
    await expectNotFound(await a.api.get(`/api/projects/${p2}/skills`), 'skills.list P2', [...leaks, ...ruleLeaks]);
  });

  test('TC-28.4: an admin of P1 reading the setup script, latest setup test and agent of P2 gets 404, naming nothing of P2', async () => {
    const { a, o, p2 } = cast;
    const agent = await agentOf(o, p2);
    const { leaks } = await p2Leaks(cast);
    const all = [...leaks, agent.id];

    await expectNotFound(await a.api.get(`/api/projects/${p2}/setup-script`), 'setupScript.get P2', all);
    await expectNotFound(await a.api.get(`/api/projects/${p2}/setup-tests/latest`), 'setupTests.latest P2', all);
    await expectNotFound(await a.api.get(`/api/projects/${p2}/agent`), 'agents.get P2', all);
  });

  test('TC-28.5: an admin of P1 connecting to the project and run event streams of P2 gets 404 and no stream opens', async () => {
    const { a, p2, rp2 } = cast;
    const { leaks } = await p2Leaks(cast);

    for (const path of [`/api/projects/${p2}/events`, `/api/runs/${rp2}/events`]) {
      // The browser connect (the stream client's own way in) shows the status; a second plain GET reads the refusal body.
      // Were the stream open, the plain GET would hold until its timeout and fail, and the browser stream is closed again.
      expect(await streamStatus(a, path), `${path} from the browser`).toBe(404);
      const res = await a.api.get(path, { headers: { accept: 'text/event-stream' }, timeout: 10_000 });
      expect(res.headers()['content-type'] ?? '', `${path} opened no event stream: ${await body(res)}`).not.toContain(
        'text/event-stream',
      );
      await expectNotFound(res, `GET ${path}`, leaks);
    }
  });

  test('TC-28.6: an admin of P1 opening the terminal of RP2 is closed 4403 with no bytes', async () => {
    const { a, rp2 } = cast;
    expect(await openTerminal(a, `/api/runs/${rp2}/terminal`)).toEqual({ code: 4403, bytes: 0 });
  });

  test('TC-28.7: an admin of P1 changing the agent of P2 gets 404 and the agent reads back unchanged', async () => {
    const { a, o, p2 } = cast;
    const before = await agentOf(o, p2);
    const { leaks } = await p2Leaks(cast);

    await expectNotFound(
      await a.api.put(`/api/projects/${p2}/agent`, {
        data: { model: before.model, timeoutSeconds: before.timeoutSeconds + 60 },
      }),
      'agents.put P2',
      [...leaks, before.id],
    );
    expect(await agentOf(o, p2)).toEqual(before);
  });
});

test.describe('BR-42: a user with only project-scoped assignments is refused on connections', () => {
  /** The connection O sees, so a refusal body can be checked for it. */
  async function connectionLeaks(c: Cast): Promise<string[]> {
    const connections = z
      .array(ConnectionDto)
      .parse(await ok(await c.o.api.get('/api/connections'), 200, 'connections.list as owner'));
    const connection = connections.find((x) => x.id === c.connectionId);
    expect(connection, 'the fake connection is listed for the owner').toBeTruthy();
    return [c.connectionId, connection?.accountName ?? '', 'dev/demo'];
  }

  test('TC-42.1: an admin of P1 only listing connections gets 403, naming no connection', async () => {
    const { a } = cast;
    await expectForbidden(await a.api.get('/api/connections'), 'connections.list', await connectionLeaks(cast));
  });

  test('TC-42.2: an admin of P1 only listing the repos of the connection gets 403, naming no repo', async () => {
    const { a, o, connectionId } = cast;
    const repos = z
      .array(z.object({ repoPath: z.string() }))
      .parse(await ok(await o.api.get(`/api/connections/${connectionId}/repos`), 200, 'connections.repos as owner'));
    expect(repos.length, 'the connection has repos for the 403 body to leak').toBeGreaterThan(0);

    await expectForbidden(await a.api.get(`/api/connections/${connectionId}/repos`), 'connections.repos', [
      ...(await connectionLeaks(cast)),
      ...repos.map((r) => r.repoPath),
    ]);
  });
});

test.describe('BR-44: a deleted project leaves the scope', () => {
  /**
   * O removes P2. The product refuses to delete a project while a run is live (409, unchanged), so O first cancels RP2,
   * the only run in P2, and waits until it has ended: the Given of these cases is the cast with RP2 ended.
   */
  async function removeP2(c: Cast): Promise<void> {
    const cancel = await c.o.api.post(`/api/runs/${c.rp2}/cancel`);
    expect(cancel.ok(), `runs.cancel RP2: ${await body(cancel)}`).toBe(true);
    await waitForStatus(c.o.page, c.rp2, 'cancelled', 30_000);
    const removed = await c.o.api.delete(`/api/projects/${c.p2}`);
    expect(removed.ok(), `projects.remove P2: ${await body(removed)}`).toBe(true);
  }

  test('TC-44.1: after O removes P2, the project list of B shows P1 only and total is 1', async () => {
    const { b, p1, p2 } = cast;
    expect(idsOf((await projectPage(b, '?pageSize=100')).page.items), 'B sees both before').toEqual([p1, p2].sort());

    await removeP2(cast);

    const { raw, page } = await projectPage(b, '?pageSize=100');
    expect(idsOf(page.items)).toEqual([p1]);
    expect(page.total).toBe(1);
    expectNoneOf(raw, [p2, REPO_P2, 'demo-2'], 'projects.list as B after the removal');
  });

  test('TC-44.2: after O removes P2, the access of B still lists the assignment on P1 and none that names P2', async () => {
    const { b, p1, p2 } = cast;
    const projectScopes = (access: AccessDto): string[] =>
      access.assignments.flatMap((x) => (x.scope.type === 'project' ? [x.scope.projectId] : [])).sort();
    const before = await accessOf(b);
    expect(projectScopes(before), 'B holds assignments on P1 and P2 before').toEqual([p1, p2].sort());

    await removeP2(cast);

    const after = await accessOf(b);
    expect(projectScopes(after), 'B keeps the assignment on P1 only').toEqual([p1]);
    expect(after.assignments.map((x) => x.roleKey)).toEqual(['member']);
    expect(JSON.stringify(after), 'no entry of the access names P2').not.toContain(p2);
  });

  test('TC-44.3: after O removes P2, B listing the runs of P1 gets 200 with every P1 run still there', async () => {
    const { b, p1, rb, rc } = cast;
    const before = await runsOf(b, p1);
    expect(idsOf(before.items), 'P1 holds RB and RC before').toEqual([rb, rc].sort());

    await removeP2(cast);

    const after = await runsOf(b, p1);
    expect(idsOf(after.items)).toEqual(idsOf(before.items));
    expect(after.total).toBe(before.total);
  });
});

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AgentDto, InstallResponse, PlatformRoleDto, ProjectDto, RuleDto } from '@agentdesk/contracts';
import { z } from 'zod';
import {
  CommentResult,
  asPlatformAdmin,
  createOrg,
  inviteAndSignIn,
  ok,
  waitForStatus,
  type InviteScope,
  type RoleKey,
} from './helpers';

// The RBAC cast shared by the rbac-*.spec.ts local specs (spec "E2E requirements", Cast): a fresh org with an owner, two
// projects, five more people and three active runs, all built over the API, the platform routes and the fake board.

export const REPO_P1 = 'dev/demo';
export const REPO_P2 = 'dev/demo-2';
/** A repo no cast project uses: the one a case creates a new project on. */
export const REPO_NEW = 'dev/demo-3';

/** A signed-in person: their own browser context (cookie jar), a page on the web origin, and the context's API client. */
export interface Actor {
  handle: string;
  userId: string;
  ctx: BrowserContext;
  page: Page;
  api: APIRequestContext;
}

export interface Cast {
  orgId: string;
  slug: string;
  /** The platform admin's API client (straight to the api). */
  pa: APIRequestContext;
  o: Actor;
  d: Actor;
  a: Actor;
  b: Actor;
  c: Actor;
  v: Actor;
  p1: string;
  p2: string;
  /** Active runs: RB (P1, owned by B), RC (P1, owned by C), RP2 (P2, owned by O). */
  rb: string;
  rc: string;
  rp2: string;
  roleIds: Record<RoleKey, string>;
  /** The org's fake connection, for the cases that create projects. */
  connectionId: string;
}

const uniq = (): string => randomBytes(3).toString('hex');

async function roleIdsOf(pa: APIRequestContext, orgId: string): Promise<Record<RoleKey, string>> {
  const roles = z
    .array(PlatformRoleDto)
    .parse(await ok(await pa.get(`/api/platform/orgs/${orgId}/roles`), 200, 'platform roles'));
  const id = (key: RoleKey): string => {
    const role = roles.find((r) => r.key === key);
    expect(role, `org ${orgId} has no role ${key}`).toBeTruthy();
    return role?.id ?? '';
  };
  return { owner: id('owner'), admin: id('admin'), member: id('member'), viewer: id('viewer') };
}

/** Invites `handle@dev.local` through the platform route and signs a fresh browser context in as them. */
async function signIn(
  browser: Browser,
  pa: APIRequestContext,
  orgId: string,
  handle: string,
  roleKey: RoleKey,
  scope: InviteScope,
): Promise<Actor> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const { userId } = await inviteAndSignIn(page, pa, orgId, handle, roleKey, scope);
    // Park the page on a light same-origin JSON document: terminal and stream helpers run `fetch` and `WebSocket` from it.
    await page.goto('/api/me/access');
    return { handle, userId, ctx, page, api: ctx.request };
  } catch (error) {
    await ctx.close().catch(() => null);
    throw error;
  }
}

/** The org's fake connection (the install callback records it), made as `who`. */
export async function installFake(who: Pick<Actor, 'api'>): Promise<string> {
  const install = InstallResponse.parse(
    await ok(await who.api.post('/api/connections/fake/install'), 201, 'install fake connection'),
  );
  const url = new URL(install.url);
  const callback = await who.api.get(`${url.pathname}${url.search}`, { maxRedirects: 0 });
  expect(callback.status(), 'fake install callback').toBe(302);
  const connection = new URL(callback.headers()['location'] ?? '', 'http://localhost').searchParams.get('connection');
  expect(connection, 'fake install callback location').toBeTruthy();
  return connection ?? '';
}

/** A project on `repoPath` with the agent credential, the prompt rule `/rbac-run` and three concurrent runs, made as `who` (an owner). */
async function setUpProject(who: Actor, connectionId: string, repoPath: string): Promise<string> {
  const project = ProjectDto.parse(
    await ok(
      await who.api.post('/api/projects', { data: { connectionId, repoPath, triggerMode: 'webhook' } }),
      201,
      `create project ${repoPath}`,
    ),
  );
  await ok(
    await who.api.patch(`/api/projects/${project.id}`, { data: { maxConcurrentRuns: 3 } }),
    200,
    'set max concurrent runs',
  );
  const agent = AgentDto.parse(await ok(await who.api.get(`/api/projects/${project.id}/agent`), 200, 'agent'));
  await ok(
    await who.api.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
    }),
    200,
    'set credential',
  );
  RuleDto.parse(
    await ok(
      await who.api.post(`/api/projects/${project.id}/rules`, {
        data: {
          command: 'rbac-run',
          labelFilter: [],
          target: 'any',
          enabled: true,
          kind: 'prompt',
          prompt: 'Reply with one short sentence.',
        },
      }),
      201,
      'create rule',
    ),
  );
  return project.id;
}

/**
 * Posts `/rbac-run` as `who` on a new pull request on the fake board (the comment's author is their handle, the linked
 * identity), then waits until the run it started is active (idle after its first turn). Returns the run id.
 */
async function startRun(
  who: Actor,
  projectId: string,
  repoPath: string,
  onStarted: (runId: string) => void = () => undefined,
): Promise<string> {
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await who.api.post('/dev/fake/tickets', {
      data: { repoPath, number: ticketNumber, kind: 'pr', title: `rbac ${who.handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await who.api.post('/dev/fake/comments', {
        data: { repoPath, ticketNumber, body: '/rbac-run', deliver: 'webhook', projectId, author: who.handle },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  const runId = comment.runId ?? '';
  onStarted(runId);
  await waitForStatus(who.page, runId, 'idle', 90_000);
  return runId;
}

/**
 * The spec's Cast in a fresh org: PA creates it, O is invited owner; P1 (dev/demo) and P2 (dev/demo-2) set up over the
 * API with a credential and the prompt rule /rbac-run, maxConcurrentRuns 3; A admin P1, B member P1+P2, C member P1,
 * V viewer org, D admin org, all invited and signed in; RB, RC (P1) and RP2 (P2) started by B's, C's and O's trigger
 * comments and awaited active with waitForStatus.
 */
export async function buildCast(browser: Browser): Promise<Cast> {
  const pa = await asPlatformAdmin();
  // What is built so far: a failure part-way disposes it (the original error is rethrown, cleanup errors are swallowed).
  const actors: Actor[] = [];
  const runs: string[] = [];
  try {
    const tag = uniq();
    const slug = `rbac-${tag}`;
    const org = await createOrg(pa, `RBAC ${tag}`, slug);
    const roleIds = await roleIdsOf(pa, org.id);
    const handle = (who: string): string => `rbac-${who}-${tag}`;
    const join = async (who: string, roleKey: RoleKey, scope: InviteScope): Promise<Actor> => {
      const actor = await signIn(browser, pa, org.id, handle(who), roleKey, scope);
      actors.push(actor);
      return actor;
    };
    const start = (who: Actor, projectId: string, repoPath: string): Promise<string> =>
      startRun(who, projectId, repoPath, (id) => runs.push(id));

    const o = await join('o', 'owner', { type: 'org' });
    const connectionId = await installFake(o);
    const p1 = await setUpProject(o, connectionId, REPO_P1);
    const p2 = await setUpProject(o, connectionId, REPO_P2);

    const a = await join('a', 'admin', { type: 'project', projectIds: [p1] });
    const b = await join('b', 'member', { type: 'project', projectIds: [p1, p2] });
    const c = await join('c', 'member', { type: 'project', projectIds: [p1] });
    const v = await join('v', 'viewer', { type: 'org' });
    const d = await join('d', 'admin', { type: 'org' });

    const rb = await start(b, p1, REPO_P1);
    const rc = await start(c, p1, REPO_P1);
    const rp2 = await start(o, p2, REPO_P2);
    return { orgId: org.id, slug, pa, o, d, a, b, c, v, p1, p2, rb, rc, rp2, roleIds, connectionId };
  } catch (error) {
    await release(pa, actors, runs);
    throw error;
  }
}

/** Cancels `runs` as the first actor (the owner, so their pods free the project's slots), closes every context, disposes `pa`. */
async function release(pa: APIRequestContext, actors: Actor[], runs: string[]): Promise<void> {
  const [owner] = actors;
  if (owner) {
    for (const run of runs) await owner.api.post(`/api/runs/${run}/cancel`).catch(() => null);
  }
  for (const who of actors) await who.ctx.close().catch(() => null);
  await pa.dispose().catch(() => null);
}

/** Cancels the cast's runs (so their pods free the project's slots) and closes every context. */
export async function disposeCast(cast: Cast): Promise<void> {
  await release(cast.pa, [cast.o, cast.d, cast.a, cast.b, cast.c, cast.v], [cast.rb, cast.rc, cast.rp2]);
}

/**
 * Another org Y with its own owner, a project (dev/demo-3) set up like the cast's and an active run, for the cases that
 * reach across orgs. The caller's `pa` creates it.
 */
export async function secondOrg(
  browser: Browser,
  pa: APIRequestContext,
): Promise<{ orgId: string; owner: Actor; project: string; run: string }> {
  const tag = uniq();
  const org = await createOrg(pa, `RBAC Y ${tag}`, `rbac-y-${tag}`);
  const owner = await signIn(browser, pa, org.id, `rbac-y-${tag}`, 'owner', { type: 'org' });
  const connectionId = await installFake(owner);
  const project = await setUpProject(owner, connectionId, REPO_NEW);
  const run = await startRun(owner, project, REPO_NEW);
  return { orgId: org.id, owner, project, run };
}

/** Disposes what `secondOrg` made. */
export async function disposeSecondOrg(second: { owner: Actor; run: string }): Promise<void> {
  await second.owner.api.post(`/api/runs/${second.run}/cancel`).catch(() => null);
  await second.owner.ctx.close().catch(() => null);
}

/** How long a terminal that was not closed by the server is held open before it counts as attached. */
const TERMINAL_HOLD_MS = 3_000;

/**
 * Opens the terminal WebSocket at `path` from the actor's own browser (their cookie, the web origin) and reports the
 * close code (null when the socket is still open after a short hold, then it is closed) and how many bytes of terminal
 * output arrived before that.
 */
export async function openTerminal(who: Actor, path: string): Promise<{ code: number | null; bytes: number }> {
  return who.page.evaluate(
    ({ path: target, holdMs }) =>
      new Promise<{ code: number | null; bytes: number }>((resolve) => {
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${scheme}://${location.host}${target}`);
        ws.binaryType = 'arraybuffer';
        let bytes = 0;
        const timer = setTimeout(() => {
          ws.onclose = null;
          ws.close();
          resolve({ code: null, bytes });
        }, holdMs);
        ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
          bytes += typeof e.data === 'string' ? e.data.length : e.data.byteLength;
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          resolve({ code: e.code, bytes });
        };
      }),
    { path, holdMs: TERMINAL_HOLD_MS },
  );
}

export interface StreamWatch {
  status: number;
  /** Everything the stream has delivered so far. */
  text(): Promise<string>;
  close(): Promise<void>;
}

/** Opens the SSE stream at `path` from the actor's browser; resolves with the status once the response head is in. */
export async function watchStream(who: Actor, path: string): Promise<StreamWatch> {
  const key = `__stream_${randomUUID()}`;
  const status = await who.page.evaluate(
    async ({ path: target, key: slot }) => {
      const abort = new AbortController();
      const state = { text: '', abort };
      Reflect.set(window, slot, state);
      const res = await fetch(target, { headers: { accept: 'text/event-stream' }, signal: abort.signal });
      if (res.status === 200 && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        void (async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            state.text += decoder.decode(value, { stream: true });
          }
        })().catch(() => undefined);
      }
      return res.status;
    },
    { path, key },
  );
  return {
    status,
    text: () =>
      who.page.evaluate((slot) => {
        const state: unknown = Reflect.get(window, slot);
        return typeof state === 'object' && state !== null && 'text' in state ? String(state.text) : '';
      }, key),
    close: () =>
      who.page.evaluate((slot) => {
        const state: unknown = Reflect.get(window, slot);
        if (typeof state === 'object' && state !== null && 'abort' in state && state.abort instanceof AbortController) {
          state.abort.abort();
        }
      }, key),
  };
}

/** The HTTP status an SSE stream answers with (the stream is closed again at once). */
export async function streamStatus(who: Actor, path: string): Promise<number> {
  const watch = await watchStream(who, path);
  await watch.close();
  return watch.status;
}

export interface TerminalWatch {
  /** Resolves once the server has sent terminal output (the attach is bound, so its re-check timer runs). */
  attached(timeoutMs: number): Promise<void>;
  /** Resolves with the close code once the server closes the socket, failing the test after `timeoutMs`. */
  closeCode(timeoutMs: number): Promise<number>;
  /** Closes the socket from the browser's side (no-op when it is already closed). */
  close(): Promise<void>;
}

/**
 * Opens the terminal WebSocket at `path` from the actor's browser and keeps it open, for the cases that change access
 * while a terminal is attached; unlike `openTerminal` it does not close the socket after a hold.
 */
export async function watchTerminal(who: Actor, path: string): Promise<TerminalWatch> {
  const key = `__terminal_${randomUUID()}`;
  await who.page.evaluate(
    ({ path: target, key: slot }) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}${target}`);
      ws.binaryType = 'arraybuffer';
      const state = { bytes: 0, code: -1, ws };
      Reflect.set(window, slot, state);
      ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        state.bytes += typeof e.data === 'string' ? e.data.length : e.data.byteLength;
      };
      ws.onclose = (e) => {
        state.code = e.code;
      };
    },
    { path, key },
  );
  const read = (): Promise<{ bytes: number; code: number }> =>
    who.page.evaluate((slot) => {
      const state: unknown = Reflect.get(window, slot);
      if (typeof state === 'object' && state !== null && 'bytes' in state && 'code' in state) {
        return { bytes: Number(state.bytes), code: Number(state.code) };
      }
      return { bytes: 0, code: -1 };
    }, key);
  return {
    attached: async (timeoutMs) => {
      await expect
        .poll(async () => (await read()).bytes > 0, { message: 'terminal output arrives', timeout: timeoutMs })
        .toBe(true);
    },
    closeCode: async (timeoutMs) => {
      await expect
        .poll(async () => (await read()).code, { message: 'the server closes the socket', timeout: timeoutMs })
        .not.toBe(-1);
      return (await read()).code;
    },
    close: () =>
      who.page.evaluate((slot) => {
        const state: unknown = Reflect.get(window, slot);
        if (typeof state === 'object' && state !== null && 'ws' in state && state.ws instanceof WebSocket) {
          state.ws.close();
        }
      }, key),
  };
}

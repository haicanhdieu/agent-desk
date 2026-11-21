import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import pg from 'pg';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connections, inboundEvents, projects, runs, withOrg } from '@agentdesk/db';
import { eq } from 'drizzle-orm';
import type { PrState, PrStatesResponse } from '@agentdesk/contracts';
import { FakeStore, type AdapterProject, type AdapterRegistry, type BoardAdapter, type Clock } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

type Mode = 'real' | 'undecided' | 'throw' | 'hang' | 'lateReject' | 'unregistered';

let mode: Mode = 'real';
let calls: Array<{ project: AdapterProject; refs: string[] }> = [];
const SECRET_PROVIDER_TEXT = 'provider-text-xyz';

/** Wraps the fake board: records each prStates call and misbehaves according to `mode`. */
function spyBoard(real: AdapterRegistry): AdapterRegistry {
  return {
    ...real,
    board: (provider) => {
      if (mode === 'unregistered') throw new Error(`no adapter ${SECRET_PROVIDER_TEXT}`);
      const board = real.board(provider);
      return Object.assign(Object.create(board) as BoardAdapter, {
        prStates: (project: AdapterProject, refs: string[]) => {
          calls.push({ project, refs: [...refs] });
          if (mode === 'throw') {
            const err = new Error(SECRET_PROVIDER_TEXT);
            err.name = 'HttpError';
            return Promise.reject(err);
          }
          if (mode === 'undecided')
            return Promise.resolve({ states: new Map<string, PrState>(), unresolved: new Set<string>() });
          if (mode === 'hang') return new Promise<never>(() => undefined);
          if (mode === 'lateReject')
            return new Promise<never>((_, reject) => setTimeout(() => reject(new Error(SECRET_PROVIDER_TEXT)), 100));
          return board.prStates(project, refs);
        },
      });
    },
  };
}

let nowMs = Date.parse('2026-03-01T00:00:00.000Z');
const testClock: Clock = { now: () => new Date(nowMs) };

let t: TestApp;
let alice: string;
let bob: string;
let orgId: string;
let stateDir: string;
let store: FakeStore;
let logged: string[] = [];

beforeAll(async () => {
  stateDir = freshStateDir();
  store = new FakeStore(stateDir, testClock);
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logged.push(chunk.toString());
      cb();
    },
  });
  t = await createTestApp({
    env: { FAKE_STATE_DIR: stateDir },
    wrapAdapters: (r) => spyBoard(wideFakeRepos(r)),
    prStateLookup: { clock: testClock, timeoutMs: 50 },
    logger: pino({ level: 'debug' }, stream),
  });
  orgId = (await createOrg(t, 'Alice', 'alice')).id;
  const bobOrg = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, orgId, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrg, 'bob', 'owner', { type: 'org' });
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  mode = 'real';
  calls = [];
  logged = [];
});

async function newProject(): Promise<{ projectId: string; repoPath: string }> {
  return makeProject(t, alice, await installFake(t, alice));
}

async function addPr(repoPath: string, number: number, prState?: PrState): Promise<void> {
  await store.addTicket({
    repoPath,
    number,
    kind: 'pr',
    title: `PR ${number}`,
    labels: [],
    ...(prState ? { prState } : {}),
  });
}

async function runFor(projectId: string, ref: string, kind: 'pr' | 'issue'): Promise<void> {
  await withOrg(t.db, orgId, (tx) =>
    tx.insert(runs).values({
      orgId,
      projectId,
      command: 'fix',
      skillName: 'fix',
      ticketRef: ref,
      ticketKind: kind,
      checkoutRef: 'refs/heads/main',
      triggerSource: 'webhook',
    }),
  );
}

async function ignoredFor(projectId: string, ref: string, outcome = 'ignored_unauthorized'): Promise<void> {
  await withOrg(t.db, orgId, (tx) =>
    tx.insert(inboundEvents).values({
      provider: 'fake',
      channel: 'webhook',
      orgId,
      projectId,
      deliveryId: `d-${randomUUID()}`,
      outcome,
      ticketRef: ref,
      author: 'mallory',
      command: 'fix',
      detail: 'not allowed',
    }),
  );
}

const prStates = (projectId: string, query: string, cookie: string | null = alice) =>
  t.app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/tickets/pr-states${query}`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
const statesOf = (res: Awaited<ReturnType<typeof prStates>>): Array<[string, string]> =>
  (expectContract('tickets.prStates', res) as PrStatesResponse).items.map((i) => [i.ref, i.prState]);

describe('tickets.prStates', () => {
  it('signed out is 401', async () => {
    const { projectId } = await newProject();
    expect((await prStates(projectId, '?ref=1', null)).statusCode).toBe(401);
  });

  it("another org's project is 404 and the adapter is never called", async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 11, 'open');
    await runFor(projectId, '11', 'pr');
    expect((await prStates(projectId, '?ref=11', bob)).statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("returns the states of the project's PR refs and leaves out the rest", async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 11, 'open');
    await addPr(repoPath, 12, 'draft');
    await addPr(repoPath, 13, 'merged');
    await addPr(repoPath, 14, 'closed');
    await addPr(repoPath, 15);
    for (const ref of ['11', '12', '13', '14', '15']) await runFor(projectId, ref, 'pr');
    await runFor(projectId, '16', 'issue');
    const res = await prStates(projectId, '?ref=11&ref=12&ref=13&ref=14&ref=15&ref=16&ref=17');
    expect(statesOf(res)).toEqual([
      ['11', 'open'],
      ['12', 'draft'],
      ['13', 'merged'],
      ['14', 'closed'],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.refs).toEqual(['11', '12', '13', '14', '15']);
  });

  it("an ignored event's ref with no run is looked up", async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 21, 'merged');
    await ignoredFor(projectId, '21');
    expect(statesOf(await prStates(projectId, '?ref=21'))).toEqual([['21', 'merged']]);
  });

  it("a non-ignored event's ref is not looked up", async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 22, 'open');
    await addPr(repoPath, 23, 'open');
    await ignoredFor(projectId, '22', 'run_created');
    await ignoredFor(projectId, '23', 'received');
    expect(statesOf(await prStates(projectId, '?ref=22&ref=23'))).toEqual([]);
    expect(calls).toEqual([]);
  });

  describe('ignored-event read', () => {
    /** Runs `fn` while the app role cannot read inbound_events, so any read of it fails the request. */
    async function withoutEventReads(fn: () => Promise<void>): Promise<void> {
      const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
      await owner.query('revoke select on inbound_events from agentdesk_app');
      try {
        await fn();
      } finally {
        await owner.query('grant select on inbound_events to agentdesk_app');
        await owner.end();
      }
    }

    it('does not read inbound_events when every ref has a PR run', async () => {
      const { projectId, repoPath } = await newProject();
      await addPr(repoPath, 121, 'open');
      await addPr(repoPath, 122, 'merged');
      await runFor(projectId, '121', 'pr');
      await runFor(projectId, '122', 'pr');
      await withoutEventReads(async () => {
        const res = await prStates(projectId, '?ref=121&ref=122');
        expect(res.statusCode).toBe(200);
        expect(statesOf(res)).toEqual([
          ['121', 'open'],
          ['122', 'merged'],
        ]);
      });
    });

    it('still looks up a ref known only from an ignored event next to a ref known from a run', async () => {
      const { projectId, repoPath } = await newProject();
      await addPr(repoPath, 123, 'open');
      await addPr(repoPath, 124, 'closed');
      await runFor(projectId, '123', 'pr');
      await ignoredFor(projectId, '124');
      expect(statesOf(await prStates(projectId, '?ref=123&ref=124'))).toEqual([
        ['123', 'open'],
        ['124', 'closed'],
      ]);
    });
  });

  it("another project's PR refs never reach the adapter", async () => {
    const a = await newProject();
    const b = await newProject();
    await addPr(b.repoPath, 31, 'open');
    await runFor(b.projectId, '31', 'pr');
    expect(statesOf(await prStates(a.projectId, '?ref=31'))).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the adapter gets the project's own repoPath and board connection", async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 41, 'open');
    await runFor(projectId, '41', 'pr');
    await prStates(projectId, '?ref=41');
    const externalId = await withOrg(t.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ externalId: connections.externalId })
        .from(projects)
        .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
        .where(eq(projects.id, projectId));
      return row?.externalId;
    });
    expect(calls[0]?.project.repoPath).toBe(repoPath);
    expect(calls[0]?.project.connectionExternalId).toBe(externalId);
  });

  it.each([
    ['0', '?ref=0'],
    ['-1', '?ref=-1'],
    ['1.5', '?ref=1.5'],
    ['abc', '?ref=abc'],
    ['012', '?ref=012'],
    ['11 digits', '?ref=12345678901'],
    ['no ref', ''],
    ['101 refs', `?${Array.from({ length: 101 }, (_, i) => `ref=${i + 1}`).join('&')}`],
  ])('bad refs are 400 problem+json with a pointer: %s', async (_name, query) => {
    const { projectId } = await newProject();
    const res = await prStates(projectId, query);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(JSON.stringify(res.json())).toContain('ref');
    expect(calls).toEqual([]);
  });

  it('one key and repeated keys both work; duplicates are asked once', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 51, 'open');
    await addPr(repoPath, 52, 'draft');
    await runFor(projectId, '51', 'pr');
    await runFor(projectId, '52', 'pr');
    expect(statesOf(await prStates(projectId, '?ref=51'))).toEqual([['51', 'open']]);
    calls = [];
    nowMs += 120_000;
    expect(statesOf(await prStates(projectId, '?ref=52&ref=51&ref=52'))).toEqual([
      ['52', 'draft'],
      ['51', 'open'],
    ]);
    expect(calls[0]?.refs).toEqual(['52', '51']);
  });

  it.each<[string, Mode]>([
    ['a throwing adapter', 'throw'],
    ['an unregistered provider', 'unregistered'],
  ])('%s gives 200 with those refs left out and one warn with the error name only', async (_n, m) => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 61, 'open');
    await runFor(projectId, '61', 'pr');
    mode = m;
    const res = await prStates(projectId, '?ref=61');
    expect(statesOf(res)).toEqual([]);
    expect(res.body).not.toContain(SECRET_PROVIDER_TEXT);
    const warns = logged.filter((l) => l.includes('pr states unavailable'));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(projectId);
    expect(warns[0]).toContain(m === 'throw' ? 'HttpError' : 'Error');
    expect(logged.join('')).not.toContain(SECRET_PROVIDER_TEXT);
  });

  it('a hanging adapter is cut off at the timeout', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 71, 'open');
    await runFor(projectId, '71', 'pr');
    mode = 'hang';
    const res = await prStates(projectId, '?ref=71');
    expect(res.statusCode).toBe(200);
    expect((expectContract('tickets.prStates', res) as PrStatesResponse).items).toEqual([]);
  });

  it('failures are not cached: the next request asks again', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 81, 'open');
    await runFor(projectId, '81', 'pr');
    mode = 'throw';
    expect(statesOf(await prStates(projectId, '?ref=81'))).toEqual([]);
    mode = 'real';
    expect(statesOf(await prStates(projectId, '?ref=81'))).toEqual([['81', 'open']]);
    expect(calls).toHaveLength(2);
  });

  it('a ref the provider could not resolve is not asked again until the TTL passes', async () => {
    const { projectId } = await newProject();
    await ignoredFor(projectId, '9901');
    expect(statesOf(await prStates(projectId, '?ref=9901'))).toEqual([]);
    expect(calls).toHaveLength(1);
    nowMs += 59_999;
    expect(statesOf(await prStates(projectId, '?ref=9901'))).toEqual([]);
    expect(calls).toHaveLength(1);
    nowMs += 2;
    expect(statesOf(await prStates(projectId, '?ref=9901'))).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('a ref the provider left out without ruling on it is asked again, not cached as not found', async () => {
    const { projectId } = await newProject();
    await ignoredFor(projectId, '9902');
    mode = 'undecided';
    expect(statesOf(await prStates(projectId, '?ref=9902'))).toEqual([]);
    expect(statesOf(await prStates(projectId, '?ref=9902'))).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('a cache hit skips the adapter until the TTL passes', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 91, 'open');
    await runFor(projectId, '91', 'pr');
    await prStates(projectId, '?ref=91');
    nowMs += 59_999;
    expect(statesOf(await prStates(projectId, '?ref=91'))).toEqual([['91', 'open']]);
    expect(calls).toHaveLength(1);
    nowMs += 2;
    await prStates(projectId, '?ref=91');
    expect(calls).toHaveLength(2);
  });

  it('a request with cached and new refs sends only the new refs to the adapter and answers both', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 101, 'open');
    await addPr(repoPath, 102, 'merged');
    await runFor(projectId, '101', 'pr');
    await runFor(projectId, '102', 'pr');
    await prStates(projectId, '?ref=101');
    calls = [];
    expect(statesOf(await prStates(projectId, '?ref=101&ref=102'))).toEqual([
      ['101', 'open'],
      ['102', 'merged'],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.refs).toEqual(['102']);
  });

  it('a lookup that rejects after the timeout causes no unhandled rejection', async () => {
    const { projectId, repoPath } = await newProject();
    await addPr(repoPath, 111, 'open');
    await runFor(projectId, '111', 'pr');
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      mode = 'lateReject';
      expect(statesOf(await prStates(projectId, '?ref=111'))).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(unhandled).toEqual([]);
      mode = 'real';
      expect(statesOf(await prStates(projectId, '?ref=111'))).toEqual([['111', 'open']]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

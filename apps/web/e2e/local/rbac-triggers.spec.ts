import { randomBytes, randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import {
  AccessDto,
  AssignmentDto,
  IgnoredEventDto,
  RuleDto,
  RunListResponse,
  pageOf,
  type RunDto,
} from '@agentdesk/contracts';
import { API, CommentResult, ok, runOf, waitForStatus } from './helpers';
import { REPO_P1, REPO_P2, buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, trigger comments and the owners of the runs they start (spec "E2E requirements":
 * BR-50, BR-51, BR-52, BR-53, BR-71, BR-72). A run starts for a trigger comment only when its commenter is linked to a
 * user who holds run:create on the project, and shows that user as its owner; a bot comment takes the owner of the single
 * run that wrote it. BR-71's ownerless-origin part is not e2e (spec: no product path makes an ownerless run). Every case
 * runs in a fresh org (`buildCast`); comments come in through the fake provider with an explicit author handle.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;
/** Runs a case started (besides the cast's own): cancelled after it, whatever its result. */
let started: string[] = [];
/** Rules a case added to P1 (besides the cast's own): removed after it. */
let addedRules: string[] = [];

test.beforeEach(async ({ browser }) => {
  built = undefined;
  started = [];
  addedRules = [];
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) {
    for (const run of started) await done.o.api.post(`/api/runs/${run}/cancel`).catch(() => null);
    for (const rule of addedRules) await done.o.api.delete(`/api/rules/${rule}`).catch(() => null);
    await disposeCast(done);
  }
});

/** The text of the trigger command: the prompt rule `/rbac-run` every cast project has. */
const TRIGGER = '/rbac-run';
/**
 * The command a run's agent writes on its own ticket. It is a second rule of P1: RB (started by `/rbac-run`) is still
 * active on that ticket, and the router never starts a second run of the same rule on a ticket that has an active one.
 */
const FOLLOW_UP = '/rbac-follow';
/** The login the fake board gives the desk's own comments (the default `BOT_NAME`). */
const BOT = 'agentdesk[bot]';

const NOT_PERMITTED = 'ignored_owner_not_permitted';
const UNLINKED = 'ignored_owner_unlinked';

async function runsOf(who: Actor, projectId: string): Promise<RunListResponse['items']> {
  return RunListResponse.parse(
    await ok(await who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`), 200, 'run list'),
  ).items;
}

const idsOf = (runs: { id: string }[]): string[] => runs.map((r) => r.id).sort();

async function ignoredOf(who: Actor, projectId: string): Promise<IgnoredEventDto[]> {
  return pageOf(IgnoredEventDto).parse(
    await ok(await who.api.get(`/api/projects/${projectId}/ignored?pageSize=100`), 200, 'ignored list'),
  ).items;
}

/** A ticket on the fake board (a pull request unless `kind` says issue), made as `who`; returns its number. `linked`: the issues a PR closes. */
async function newTicket(
  who: Actor,
  repoPath: string,
  opts: { kind?: 'issue' | 'pr'; linked?: number[] } = {},
): Promise<number> {
  const number = randomInt(100_000, 1_000_000_000);
  await ok(
    await who.api.post('/dev/fake/tickets', {
      data: {
        repoPath,
        number,
        kind: opts.kind ?? 'pr',
        title: `rbac trigger ${randomBytes(3).toString('hex')}`,
        ...(opts.linked ? { linked: opts.linked } : {}),
      },
    }),
    201,
    'fake ticket',
  );
  return number;
}

/** Posts the trigger command on the ticket through the fake provider as `author`; the session is only the way in. */
async function commentAs(
  session: Actor,
  author: string,
  projectId: string,
  repoPath: string,
  ticketNumber: number,
  deliver: 'webhook' | 'poll',
  command: string = TRIGGER,
): Promise<z.infer<typeof CommentResult>> {
  return CommentResult.parse(
    await ok(
      await session.api.post('/dev/fake/comments', {
        data: { repoPath, ticketNumber, body: command, deliver, projectId, author },
      }),
      201,
      'fake comment',
    ),
  );
}

/** O adds the prompt rule `/rbac-follow` to P1 (the follow-up command an agent writes). */
async function addFollowUpRule(c: Cast): Promise<void> {
  const rule = RuleDto.parse(
    await ok(
      await c.o.api.post(`/api/projects/${c.p1}/rules`, {
        data: {
          command: FOLLOW_UP.slice(1),
          labelFilter: [],
          target: 'any',
          enabled: true,
          kind: 'prompt',
          prompt: 'Reply with one short sentence.',
        },
      }),
      201,
      'create follow-up rule',
    ),
  );
  addedRules.push(rule.id);
}

/** The runs of the project that were started for the ticket. */
async function runsOnTicket(who: Actor, projectId: string, ticketNumber: number): Promise<RunListResponse['items']> {
  return (await runsOf(who, projectId)).filter((r) => r.ticket.number === ticketNumber);
}

/** The run that appears for the ticket in the project (as `who` sees the list); remembered for cancelling. */
async function awaitRunOn(who: Actor, projectId: string, ticketNumber: number): Promise<RunDto> {
  await expect
    .poll(async () => (await runsOnTicket(who, projectId, ticketNumber)).length, {
      timeout: 60_000,
      intervals: [500, 1000],
    })
    .toBe(1);
  const run = (await runsOnTicket(who, projectId, ticketNumber))[0];
  expect(run, 'the run for the ticket').toBeTruthy();
  started.push(run?.id ?? '');
  return runOf(who.page, run?.id ?? '');
}

/**
 * Waits for the intake to have processed the comment (its entry in the project's ignored list, read as `who`), then
 * asserts the outcome and the commenter, and that the ignored entry is the only one for that ticket.
 */
async function expectIgnored(
  who: Actor,
  projectId: string,
  ticketNumber: number,
  author: string,
  outcome: typeof NOT_PERMITTED | typeof UNLINKED,
): Promise<void> {
  const forTicket = async (): Promise<IgnoredEventDto[]> =>
    (await ignoredOf(who, projectId)).filter((e) => e.ticketRef === String(ticketNumber));
  await expect.poll(async () => (await forTicket()).length, { timeout: 60_000, intervals: [500, 1000] }).toBe(1);
  const [entry] = await forTicket();
  expect(entry?.outcome, 'the ignored list shows the outcome').toBe(outcome);
  expect(entry?.author, 'the ignored entry names the commenter').toBe(author);
}

/** The runs of the project are exactly `ids`: no run started for the ticket (or anywhere else in the project). */
async function expectRuns(who: Actor, projectId: string, ids: string[], ticketNumber: number): Promise<void> {
  const runs = await runsOf(who, projectId);
  expect(
    runs.filter((r) => r.ticket.number === ticketNumber),
    'no run for the ticket',
  ).toEqual([]);
  expect(idsOf(runs), 'the project has only the runs it had').toEqual([...ids].sort());
}

/** O switches P1 to polling (30 minutes: a tick can still land on a wall-clock :00/:30, so every case switches back). */
async function switchP1ToPolling(c: Cast): Promise<void> {
  await ok(
    await c.o.api.patch(`/api/projects/${c.p1}`, { data: { triggerMode: 'polling', pollIntervalSeconds: 1800 } }),
    200,
    'switch P1 to polling',
  );
}

/** Switches P1 back to webhook mode (deletes `poll-<P1>`); a failure here must not mask the case's own result. */
async function restoreWebhook(c: Cast): Promise<void> {
  await c.o.api.patch(`/api/projects/${c.p1}`, { data: { triggerMode: 'webhook' } }).catch(() => null);
}

/** Asks for a poll now as O (the route behind the poll Schedule's trigger); the queued comments are read by the poller. */
async function pollP1Now(c: Cast): Promise<void> {
  const res = await c.o.api.post(`/api/projects/${c.p1}/connection/poll`);
  expect(res.status(), `projects.pollNow: ${await res.text()}`).toBe(202);
}

/** Queues the author's trigger comment on a new P1 ticket for the poller (not delivered by webhook); returns the ticket. */
async function queueOnNewP1Ticket(c: Cast, author: string): Promise<number> {
  const ticket = await newTicket(c.o, REPO_P1);
  const comment = await commentAs(c.o, author, c.p1, REPO_P1, ticket, 'poll');
  expect(comment.outcome, 'the comment is queued for the poller').toBe('queued_for_poll');
  return ticket;
}

/** The user's assignments in the org, read by O (an owner sees every assignment). */
async function assignmentsOf(c: Cast, userId: string): Promise<AssignmentDto[]> {
  const all = pageOf(AssignmentDto).parse(
    await ok(await c.o.api.get(`/api/orgs/${c.orgId}/assignments?pageSize=100`), 200, 'assignment list'),
  ).items;
  return all.filter((x) => x.userId === userId);
}

async function revokeAssignment(c: Cast, assignmentId: string | undefined): Promise<void> {
  const revoked = await c.o.api.delete(`/api/orgs/${c.orgId}/assignments/${assignmentId}`);
  expect(revoked.status(), `assignments.remove: ${await revoked.text()}`).toBe(204);
}

/** C's only assignment (P1) revoked by O: C stays a member of the org holding nothing. */
async function revokeCOnP1(c: Cast): Promise<void> {
  const ofC = await assignmentsOf(c, c.c.userId);
  expect(
    ofC.map((x) => x.scope),
    'C holds one assignment, on P1',
  ).toEqual([{ type: 'project', projectId: c.p1 }]);
  await revokeAssignment(c, ofC[0]?.id);
}

/** B's assignment on P1 revoked by O (B keeps P2). */
async function revokeBOnP1(c: Cast): Promise<void> {
  const ofB = await assignmentsOf(c, c.b.userId);
  expect(
    ofB.map((x) => (x.scope.type === 'project' ? x.scope.projectId : 'org')).sort(),
    'B holds one assignment on each of P1 and P2',
  ).toEqual([c.p1, c.p2].sort());
  await revokeAssignment(c, ofB.find((x) => x.scope.type === 'project' && x.scope.projectId === c.p1)?.id);
}

test.describe('BR-50: a linked commenter with run:create starts a run they own', () => {
  test('TC-50.1: B commenting the trigger on a P1 ticket by webhook starts a run that shows B as its owner', async () => {
    const { b, o, p1 } = cast;
    const ticket = await newTicket(b, REPO_P1);
    const comment = await commentAs(b, b.handle, p1, REPO_P1, ticket, 'webhook');
    if (comment.runId) started.push(comment.runId);
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();

    const run = await awaitRunOn(b, p1, ticket);
    expect(run.id).toBe(comment.runId);
    expect(run.ownerUserId, 'the run shows B as its owner').toBe(b.userId);
    expect((await runOf(o.page, run.id)).ownerUserId, 'O reads the same owner').toBe(b.userId);
  });

  test('TC-50.2: B commenting the trigger on a P1 ticket, picked up by the poll, starts a run that shows B as its owner', async () => {
    const { b, p1 } = cast;
    try {
      await switchP1ToPolling(cast);
      const ticket = await queueOnNewP1Ticket(cast, b.handle);
      await pollP1Now(cast);
      const run = await awaitRunOn(b, p1, ticket);
      expect(run.triggerSource, 'the poller started it').toBe('polling');
      expect(run.ownerUserId, 'the run shows B as its owner').toBe(b.userId);
    } finally {
      await restoreWebhook(cast);
    }
  });
});

test.describe('BR-51: a linked commenter without run:create starts nothing', () => {
  test('TC-51.1: V commenting the trigger on a P1 ticket starts no run and the ignored list shows no permission', async () => {
    const { v, o, p1, rb, rc } = cast;
    const ticket = await newTicket(o, REPO_P1);
    const comment = await commentAs(o, v.handle, p1, REPO_P1, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, ticket, v.handle, NOT_PERMITTED);
    await expectRuns(o, p1, [rb, rc], ticket);
  });

  test('TC-51.2: A commenting the trigger on a P2 ticket (no scope on P2) starts no run and the ignored list shows no permission', async () => {
    const { a, o, p2, rp2 } = cast;
    const ticket = await newTicket(o, REPO_P2);
    const comment = await commentAs(o, a.handle, p2, REPO_P2, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p2, ticket, a.handle, NOT_PERMITTED);
    await expectRuns(o, p2, [rp2], ticket);
  });

  test('TC-51.3: C commenting the trigger on a P1 ticket after the revoke of their P1 assignment starts no run and the ignored list shows no permission', async () => {
    const { c, o, p1, rb, rc } = cast;
    await revokeCOnP1(cast);

    const ticket = await newTicket(o, REPO_P1);
    const comment = await commentAs(o, c.handle, p1, REPO_P1, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, ticket, c.handle, NOT_PERMITTED);
    await expectRuns(o, p1, [rb, rc], ticket);
  });

  test('TC-51.4: V commenting the trigger on a P1 ticket, picked up by the poll, starts no run and the ignored list shows no permission', async () => {
    const { v, o, p1, rb, rc } = cast;
    try {
      await switchP1ToPolling(cast);
      const ticket = await queueOnNewP1Ticket(cast, v.handle);
      await pollP1Now(cast);
      await expectIgnored(o, p1, ticket, v.handle, NOT_PERMITTED);
      await expectRuns(o, p1, [rb, rc], ticket);
    } finally {
      await restoreWebhook(cast);
    }
  });
});

test.describe('BR-52: an unlinked commenter starts nothing', () => {
  const stranger = (): string => `e2e-${randomBytes(4).toString('hex')}`;

  test('TC-52.1: an author no Agent Desk user signed in with commenting the trigger on a P1 ticket starts no run and the ignored list shows not linked', async () => {
    const { o, p1, rb, rc } = cast;
    const author = stranger();
    const ticket = await newTicket(o, REPO_P1);
    const comment = await commentAs(o, author, p1, REPO_P1, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, ticket, author, UNLINKED);
    await expectRuns(o, p1, [rb, rc], ticket);
  });

  test('TC-52.2: the same author queued for the poll starts no run and the ignored list shows not linked', async () => {
    const { o, p1, rb, rc } = cast;
    const author = stranger();
    try {
      await switchP1ToPolling(cast);
      const ticket = await queueOnNewP1Ticket(cast, author);
      await pollP1Now(cast);
      await expectIgnored(o, p1, ticket, author, UNLINKED);
      await expectRuns(o, p1, [rb, rc], ticket);
    } finally {
      await restoreWebhook(cast);
    }
  });
});

test.describe('BR-53: a bot-written trigger inherits the owner of the run that wrote it', () => {
  /** RB (B's run, active on its P1 ticket) writes the trigger on its own ticket: the bot comment, posted from O's session. */
  async function botTriggerFromRb(c: Cast): Promise<{ ticket: number; followUp: string | undefined; outcome: string }> {
    await addFollowUpRule(c);
    const ticket = (await runOf(c.o.page, c.rb)).ticket.number;
    const comment = await commentAs(c.o, BOT, c.p1, REPO_P1, ticket, 'webhook', FOLLOW_UP);
    if (comment.runId) started.push(comment.runId);
    return { ticket, followUp: comment.runId, outcome: comment.outcome };
  }

  test('TC-53.1: the bot trigger on the ticket RB is active on starts a follow-up run in P1 that shows B as its owner', async () => {
    const { b, p1, rb, rc } = cast;
    const { followUp, outcome } = await botTriggerFromRb(cast);
    expect(followUp, `comment outcome ${outcome}`).toBeTruthy();
    await expect
      .poll(async () => idsOf(await runsOf(b, p1)).includes(followUp ?? ''), {
        timeout: 60_000,
        intervals: [500, 1000],
      })
      .toBe(true);
    const run = (await runsOf(b, p1)).find((r) => r.id === followUp);
    expect([rb, rc], 'the follow-up is a new run').not.toContain(run?.id);
    expect(run?.ownerUserId, 'the follow-up shows B (the owner of RB) as its owner').toBe(b.userId);
    expect((await runOf(b.page, followUp ?? '')).ownerUserId).toBe(b.userId);
  });

  test('TC-53.2: B cancelling the follow-up run is accepted', async () => {
    const { b } = cast;
    const { followUp, outcome } = await botTriggerFromRb(cast);
    expect(followUp, `comment outcome ${outcome}`).toBeTruthy();
    const res = await b.api.post(`/api/runs/${followUp}/cancel`);
    expect(res.ok(), `runs.cancel: ${res.status()} ${await res.text()}`).toBe(true);
  });
});

test.describe('BR-71: a bot-written trigger without a single same-project origin starts nothing', () => {
  test('TC-71.1: the bot trigger on a P1 ticket no P1 run is active on starts no run and the ignored list shows not linked', async () => {
    const { o, p1, rb, rc } = cast;
    const ticket = await newTicket(o, REPO_P1);
    const comment = await commentAs(o, BOT, p1, REPO_P1, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, ticket, BOT, UNLINKED);
    await expectRuns(o, p1, [rb, rc], ticket);
  });

  test('TC-71.2: the bot trigger on a P2 ticket while the only active run is RB (in P1) starts no run in P2 and the ignored list shows not linked', async () => {
    const { o, p1, p2, rb, rc, rp2 } = cast;
    // The Given: no active P2 run (RP2 is finished first), RB is the only active run on its P1 ticket.
    const finish = await o.api.post(`/api/runs/${rp2}/finish`);
    expect(finish.ok(), `runs.finish: ${finish.status()} ${await finish.text()}`).toBe(true);
    await waitForStatus(o.page, rp2, 'succeeded', 60_000);

    const ticket = await newTicket(o, REPO_P2);
    const comment = await commentAs(o, BOT, p2, REPO_P2, ticket, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p2, ticket, BOT, UNLINKED);
    await expectRuns(o, p2, [rp2], ticket);
    expect(idsOf(await runsOf(o, p1)), 'P1 got no run either').toEqual([rb, rc].sort());
  });
});

test.describe('BO-1, BO-4: a bot-written trigger on a PR takes the owner from the PR linked issue run', () => {
  /** The comments the desk posted on the ticket (the fake board's posted list for the repo). */
  async function postedOn(who: Actor, repoPath: string, ticket: number): Promise<string[]> {
    const res = await ok(await who.api.get(`/dev/fake/posted?repoPath=${encodeURIComponent(repoPath)}`), 200, 'posted');
    return z
      .array(z.object({ ticketRef: z.string(), body: z.string() }))
      .parse(res)
      .filter((c) => c.ticketRef === String(ticket))
      .map((c) => c.body);
  }

  test('TC-BO-1.1: the bot trigger on a PR linked to the issue B started, while RB and RC are active, starts a run that shows B as its owner', async () => {
    const { o, b, p1, rb, rc } = cast;
    const issue = await newTicket(o, REPO_P1, { kind: 'issue' });
    await commentAs(o, b.handle, p1, REPO_P1, issue, 'webhook');
    const issueRun = await awaitRunOn(b, p1, issue);
    await waitForStatus(b.page, issueRun.id, 'idle', 90_000); // active, so its started_at is set
    expect(issueRun.ownerUserId, 'B owns the issue run').toBe(b.userId);
    expect(idsOf(await runsOf(b, p1)), 'two other runs are active in P1 besides it').toEqual(
      [rb, rc, issueRun.id].sort(),
    );

    const pr = await newTicket(o, REPO_P1, { linked: [issue] });
    const comment = await commentAs(o, BOT, p1, REPO_P1, pr, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
    if (comment.runId) started.push(comment.runId);
    await expect
      .poll(async () => idsOf(await runsOf(b, p1)).includes(comment.runId ?? ''), {
        timeout: 60_000,
        intervals: [500, 1000],
      })
      .toBe(true);
    expect((await runOf(b.page, comment.runId ?? '')).ownerUserId, 'the PR run shows B as its owner').toBe(b.userId);
  });

  test('TC-BO-2.1: the bot trigger on a PR with no link and two active runs starts no run, the ignored list shows not linked, and the PR shows the notice once', async () => {
    const { o, p1, rb, rc } = cast;
    const pr = await newTicket(o, REPO_P1);
    const comment = await commentAs(o, BOT, p1, REPO_P1, pr, 'webhook');
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, pr, BOT, UNLINKED);
    await expectRuns(o, p1, [rb, rc], pr);
    await expect
      .poll(async () => (await postedOn(o, REPO_P1, pr)).length, { timeout: 60_000, intervals: [500, 1000] })
      .toBe(1);
    const [notice] = await postedOn(o, REPO_P1, pr);
    expect(notice, 'the notice says no owner could be detected').toContain('could not work out which person');
    expect(notice?.startsWith('/'), 'the notice is not a command').toBe(false);
  });
});

test.describe('BR-72: a bot-written trigger whose origin owner lost run:create starts nothing', () => {
  test('TC-72.1: the bot trigger on RB ticket after the revoke of B on P1 starts no run and the ignored list shows no permission', async () => {
    const { o, b, p1, p2, rb, rc } = cast;
    await revokeBOnP1(cast);
    const held = AccessDto.parse(await ok(await b.api.get('/api/me/access'), 200, 'me access'));
    expect(
      held.assignments.map((x) => (x.scope.type === 'project' ? x.scope.projectId : 'org')),
      'B keeps P2 only',
    ).toEqual([p2]);

    await addFollowUpRule(cast);
    const ticket = (await runOf(o.page, rb)).ticket.number;
    const before = await runsOnTicket(o, p1, ticket);
    const comment = await commentAs(o, BOT, p1, REPO_P1, ticket, 'webhook', FOLLOW_UP);
    expect(comment.runId, `comment outcome ${comment.outcome}`).toBeUndefined();
    await expectIgnored(o, p1, ticket, BOT, NOT_PERMITTED);
    expect(idsOf(await runsOnTicket(o, p1, ticket)), 'no run was added on the ticket').toEqual(idsOf(before));
    expect(idsOf(await runsOf(o, p1)), 'P1 has only the runs it had').toEqual([rb, rc].sort());
  });
});

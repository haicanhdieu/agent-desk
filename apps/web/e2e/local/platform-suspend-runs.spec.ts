import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ORG_SUSPENDED_PROBLEM_TYPE, RunListResponse } from '@agentdesk/contracts';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import {
  API,
  CommentResult,
  FAKE_STATE_DIR,
  REPO,
  addFakeTicket,
  asPlatformAdmin,
  commentOn,
  lifecycleTexts,
  ok,
  platformOrgIdBySlug,
  podLogLines,
  postedComments,
  reactivateOrg,
  runOf,
  signInAndCreateProject,
  suspendOrg,
  touchPodFile,
  waitForStatus,
} from './helpers';

/*
 * Local end-to-end for the runs and webhooks of a suspended organization (spec 2026-11-23-platform-admin-dashboard-design.md
 * "E2E requirements": TC-39.1 to TC-39.3, TC-40.1, TC-40.2, TC-41.1, TC-41.2, TC-42.2). Every case makes a fresh org with its
 * owner and project on the fake ticket source, and registers every org it suspends so `afterEach` reactivates it (errors
 * swallowed) before it cancels the runs it started. No shared org is ever suspended.
 *
 * "No run started" is read from the project's run list of the ticket (after reactivation, because a suspended org's own
 * routes are refused) and from the recorded intake outcome `ignored_org_suspended` in `inbound_events`, read through the
 * stack's psql (as run-model.spec.ts does; needs docker-compose on the PATH). The signed deliveries go to the public
 * `POST /webhooks/fake` route the way a provider would send them, with the fake board's HMAC (FAKE_WEBHOOK_SECRET,
 * default `dev`). The fake board's tickets and comments are staged while the org is active: the dev routes are session
 * routes and are refused for a suspended org like any other.
 */

test.describe.configure({ timeout: 300_000 });

let pa: APIRequestContext;
const toReactivate: string[] = [];
const toCancel: { page: Page; runId: string }[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const id of toReactivate.splice(0)) await reactivateOrg(pa, id, 'e2e cleanup').catch(() => null);
  for (const { page, runId } of toCancel.splice(0)) {
    await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
  }
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomUUID().slice(0, 8);

/** Suspends `orgId` and registers it for the `afterEach` reactivation. */
async function suspend(orgId: string, reason: string): Promise<void> {
  toReactivate.push(orgId);
  await suspendOrg(pa, orgId, reason);
}

/** The refusal of a suspended org: 403, problem type `org-suspended`, and nothing of the reason or the org's data. */
async function expectSuspendedRefusal(res: APIResponse, forbidden: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), text).toBe(403);
  const body = JSON.parse(text) as { type?: string; title?: string; detail?: string };
  expect(body.type, text).toMatch(new RegExp(`(^|[:/])${ORG_SUSPENDED_PROBLEM_TYPE}$`));
  expect(body.title, text).toBe('Forbidden');
  expect(body.detail, text).toBe('This organization is suspended.');
  for (const secret of forbidden) expect(text, `the refusal carries ${secret}`).not.toContain(secret);
}

interface World {
  handle: string;
  orgId: string;
  projectId: string;
  /** The owner's page (signed in). */
  owner: Page;
  reason: string;
}

/** A fresh org with its owner and one project over the API and the fake board (not yet suspended). */
async function newWorld(page: Page): Promise<World> {
  const { handle, projectId } = await signInAndCreateProject(page);
  const orgId = await platformOrgIdBySlug(pa, handle);
  return { handle, orgId, projectId, owner: page, reason: `Billing hold ${tagOf()}` };
}

/** The runs of the project on one fake ticket (`GET /api/projects/:id/runs?ticket=`), read as the owner of an active org. */
async function runsOnTicket(w: World, ticketNumber: number) {
  const res = await w.owner.request.get(`/api/projects/${w.projectId}/runs?ticket=${ticketNumber}`);
  return RunListResponse.parse(await ok(res, 200, 'runs of the ticket')).items;
}

// ---- signed webhooks and the recorded intake outcome ----

const WEBHOOK_SECRET = process.env['FAKE_WEBHOOK_SECRET'] ?? 'dev';

interface Staged {
  ticketNumber: number;
  commentId: string;
}

/** Puts a comment on the fake board (poll mode: stored, not delivered) so a signed delivery can name it; the org must be active. */
async function stageComment(w: World, ticketNumber: number, body = '/code-review'): Promise<string> {
  const res = await w.owner.request.post('/dev/fake/comments', {
    data: { repoPath: REPO, ticketNumber, body, deliver: 'poll', projectId: w.projectId, author: w.handle },
  });
  const comment = CommentResult.parse(await ok(res, 201, 'stage fake comment'));
  expect(comment.outcome).toBe('queued_for_poll');
  return comment.commentId;
}

/** A new pull request on the fake board with a staged `/code-review` comment (the org must be active). */
async function stageTicket(w: World): Promise<Staged> {
  const ticketNumber = await addFakeTicket(w.owner, 'pr');
  return { ticketNumber, commentId: await stageComment(w, ticketNumber) };
}

/** Sends the comment as a webhook delivery to `POST /webhooks/fake`; `signWith` is the HMAC secret (a wrong one gives a bad signature). */
async function deliver(
  request: APIRequestContext,
  w: World,
  staged: Staged,
  deliveryId: string,
  signWith = WEBHOOK_SECRET,
): Promise<APIResponse> {
  const payload = Buffer.from(
    JSON.stringify({
      deliveryId,
      commentId: staged.commentId,
      repoPath: REPO,
      ticketRef: String(staged.ticketNumber),
      ticketKind: 'pr',
      body: '/code-review',
      author: w.handle,
      authorAssociation: 'OWNER',
      createdAt: new Date().toISOString(),
      externalId: `fake-${w.orgId}`,
    }),
  );
  return request.post(`${API}/webhooks/fake`, {
    data: payload,
    headers: {
      'content-type': 'application/json',
      'x-fake-signature': createHmac('sha256', signWith).update(payload).digest('hex'),
    },
  });
}

const newDeliveryId = (): string => `e2e-${randomUUID()}`;

const COMPOSE_FILE =
  process.env['AGENTDESK_COMPOSE_FILE'] ?? fileURLToPath(new URL('../../../../docker-compose.yml', import.meta.url));

/**
 * The recorded `outcome` of every `inbound_events` row of a delivery id, through the stack's Postgres (as `devbox run
 * db-psql` does). The id is checked against the shape this spec makes and reaches the SQL only as the psql variable :'id'.
 */
async function recordedOutcomes(deliveryId: string): Promise<string[]> {
  expect(deliveryId).toMatch(/^e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  return inboundOutcomes('delivery_id', deliveryId);
}

/** The recorded `outcome` of every `inbound_events` row of a comment id, over every channel (webhook and poll). */
async function recordedOutcomesOfComment(commentId: string): Promise<string[]> {
  expect(commentId).toMatch(/^[\w.-]+$/);
  return inboundOutcomes('comment_id', commentId);
}

async function inboundOutcomes(column: 'delivery_id' | 'comment_id', value: string): Promise<string[]> {
  const child = spawn(
    'docker-compose',
    [
      '-f',
      COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'agentdesk',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end(
    `\\set id ${value}\nSELECT outcome FROM inbound_events WHERE ${column} = :'id' ORDER BY received_at;\n`,
  );
  const code = await exited;
  expect(code, `psql exit code: ${stderr}`).toBe(0);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

// ---- BR-39: a verified webhook for a suspended org starts nothing ----

test.describe('BR-39: a webhook for a suspended org', () => {
  test('TC-39.1: a signed comment webhook for a suspended org answers the plain "ignored" and starts no run', async ({
    page,
    request,
  }) => {
    const w = await newWorld(page);
    const staged = await stageTicket(w);
    await suspend(w.orgId, w.reason);

    const deliveryId = newDeliveryId();
    const res = await deliver(request, w, staged, deliveryId);
    const text = await res.text();
    expect(res.status(), text).toBe(200);
    // The body of an event with no command: no hint of the suspension.
    expect(JSON.parse(text), text).toEqual({ outcome: 'ignored' });
    expect(text.toLowerCase()).not.toContain('suspend');
    // The recorded intake outcome says why nothing started.
    await expect.poll(() => recordedOutcomes(deliveryId)).toEqual(['ignored_org_suspended']);

    // No run appears in the project (read once the org's own routes are open again). Nothing can replay the staged
    // comment later: the project is in webhook mode (no poll Schedule) and a first poll starts at "now". The intake
    // rows of the comment, over every channel, still hold only the suspended-org outcome.
    await reactivateOrg(pa, w.orgId, 'e2e check');
    expect(await runsOnTicket(w, staged.ticketNumber)).toEqual([]);
    expect(await recordedOutcomesOfComment(staged.commentId)).toEqual(['ignored_org_suspended']);
  });

  test('TC-39.2: the same signed webhook for an active org starts a run (control case)', async ({ page, request }) => {
    const w = await newWorld(page);
    const staged = await stageTicket(w);

    const deliveryId = newDeliveryId();
    const res = await deliver(request, w, staged, deliveryId);
    const text = await res.text();
    expect(res.status(), text).toBe(202);
    expect(JSON.parse(text), text).toEqual({ outcome: 'run_created' });
    expect(await recordedOutcomes(deliveryId)).toEqual(['run_created']);

    await expect.poll(async () => (await runsOnTicket(w, staged.ticketNumber)).length).toBe(1);
    const [run] = await runsOnTicket(w, staged.ticketNumber);
    expect(run, 'the run of the ticket').toBeTruthy();
    if (run) toCancel.push({ page, runId: run.id });
    if (run) await waitForStatus(page, run.id, 'idle');
  });

  test('TC-39.3: a webhook for a suspended org with a wrong signature is refused as any bad signature, with no hint of suspension', async ({
    page,
    request,
  }) => {
    const w = await newWorld(page);
    const staged = await stageTicket(w);
    await suspend(w.orgId, w.reason);

    const deliveryId = newDeliveryId();
    const res = await deliver(request, w, staged, deliveryId, `wrong-${tagOf()}`);
    const text = await res.text();
    expect(res.status(), text).toBe(401);
    expect((JSON.parse(text) as { detail?: string }).detail, text).toBe('Invalid signature');
    expect(text.toLowerCase()).not.toContain('suspend');
    expect(text).not.toContain(w.reason);
    // The signature check stays first: the delivery was not recorded at all.
    expect(await recordedOutcomes(deliveryId)).toEqual([]);

    await reactivateOrg(pa, w.orgId, 'e2e check');
    expect(await runsOnTicket(w, staged.ticketNumber)).toEqual([]);
  });
});

// ---- BR-40: no one starts, resumes or reopens a run in a suspended org ----

test.describe('BR-40: runs cannot be started, resumed or reopened in a suspended org', () => {
  test('TC-40.1: the owner of a suspended org cannot start a run: 403 org-suspended, and the project shows no new run', async ({
    page,
  }) => {
    const w = await newWorld(page);
    const ticketNumber = await addFakeTicket(page, 'pr');
    await suspend(w.orgId, w.reason);

    // The route that starts a run on the local stack: a trigger comment on the fake ticket source.
    const res = await w.owner.request.post('/dev/fake/comments', {
      data: {
        repoPath: REPO,
        ticketNumber,
        body: '/code-review',
        deliver: 'webhook',
        projectId: w.projectId,
        author: w.handle,
      },
    });
    await expectSuspendedRefusal(res, [w.reason, w.projectId, REPO]);

    await reactivateOrg(pa, w.orgId, 'e2e check');
    expect(await runsOnTicket(w, ticketNumber)).toEqual([]);
  });

  test('TC-40.2: the owner of a suspended org cannot resume a paused run or reopen a finished run: both 403 org-suspended, both runs unchanged', async ({
    page,
  }) => {
    const w = await newWorld(page);

    // A finished run whose session is kept (so it could be reopened): `--fake-done`, then Finish.
    const ticketA = await addFakeTicket(page, 'pr');
    const finished = (await commentOn(page, w.projectId, ticketA, '/code-review --fake-done', w.handle)).runId ?? '';
    expect(finished, 'the finished run starts').not.toBe('');
    toCancel.push({ page, runId: finished });
    await waitForStatus(page, finished, 'done');
    await ok(await page.request.post(`/api/runs/${finished}/finish`), 202, 'finish');
    await waitForStatus(page, finished, 'succeeded', 90_000);

    // A paused run: an idle run stopped.
    const ticketB = await addFakeTicket(page, 'pr');
    const paused = (await commentOn(page, w.projectId, ticketB, '/code-review', w.handle)).runId ?? '';
    expect(paused, 'the paused run starts').not.toBe('');
    toCancel.push({ page, runId: paused });
    await waitForStatus(page, paused, 'idle');
    await ok(await page.request.post(`/api/runs/${paused}/stop`), 202, 'stop');
    await waitForStatus(page, paused, 'paused', 90_000);

    await suspend(w.orgId, w.reason);
    // Step 1: resume the paused run. Step 2: reopen the finished run (the same route; a finished run's resume is a reopen).
    await expectSuspendedRefusal(await page.request.post(`/api/runs/${paused}/resume`), [w.reason, paused]);
    await expectSuspendedRefusal(await page.request.post(`/api/runs/${finished}/resume`), [w.reason, finished]);

    await reactivateOrg(pa, w.orgId, 'e2e check');
    expect((await runOf(page, paused)).status).toBe('paused');
    const after = await runOf(page, finished);
    expect(after.status).toBe('succeeded');
    expect(after.reopenedAt).toBeNull();
  });
});

// ---- BR-41: a run that is already live is left alone ----

test.describe('BR-41: a live run of a suspended org is not interrupted', () => {
  test('TC-41.1: a run started before the suspension reaches its normal end state (idle) and its ticket keeps its updates', async ({
    page,
  }) => {
    const w = await newWorld(page);
    const ticketNumber = await addFakeTicket(page, 'pr');
    // The pod is up but holds before the session starts, so the run is live (starting or running) when the org is suspended.
    const runId =
      (await commentOn(page, w.projectId, ticketNumber, '/code-review --fake-hold-start', w.handle)).runId ?? '';
    expect(runId, 'the run starts').not.toBe('');
    toCancel.push({ page, runId });
    await expect.poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}/started`), { timeout: 60_000 }).toBe(true);
    await expect
      .poll(async () => (await runOf(page, runId)).status, { timeout: 30_000 })
      .toMatch(/^(starting|running)$/);

    await suspend(w.orgId, w.reason);
    // Step 2: the fake pod runs its first turn to the end WHILE the org is suspended: wait (still suspended) for the
    // pod's end-of-turn line in its log, the only end marker readable without the org's own (refused) routes.
    await touchPodFile(runId, 'release-start');
    await expect
      .poll(async () => (await podLogLines(runId)).some((l) => l.includes('agentdesk: state needs_input declared ')), {
        timeout: 60_000,
      })
      .toBe(true);
    await reactivateOrg(pa, w.orgId, 'e2e check');
    await waitForStatus(page, runId, 'idle', 90_000);

    // The ticket has its start update on the fake board, once, as in an active org. Limitation: the fake board gets no
    // update after the first turn (only a pause or a Finish posts one, and both are person-driven or minutes away), so
    // no ticket update that can only be posted after the release exists to assert; the run's own end state is the proof.
    const started = (await postedComments(page)).filter(
      (c) => c.ticketNumber === ticketNumber && /^Agent Desk started run #\d+ /.test(c.body),
    );
    expect(started).toHaveLength(1);
  });

  test('TC-41.2: a pod killed while the org is suspended is resumed automatically once the org is reactivated', async ({
    page,
  }) => {
    const w = await newWorld(page);
    const ticketNumber = await addFakeTicket(page, 'pr');
    const runId = (await commentOn(page, w.projectId, ticketNumber, '/code-review', w.handle)).runId ?? '';
    expect(runId, 'the run starts').not.toBe('');
    toCancel.push({ page, runId });
    await waitForStatus(page, runId, 'idle');

    await suspend(w.orgId, w.reason);
    await touchPodFile(runId, 'hardkill');
    // Wait until the pod really died (it writes its exit file) before the org comes back.
    await expect.poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}/exit`), { timeout: 60_000 }).toBe(true);

    // Step 1: reactivate. Step 2: watch the run.
    await reactivateOrg(pa, w.orgId, 'e2e check');
    await expect
      .poll(
        async () =>
          (await lifecycleTexts(page, runId)).filter((t) =>
            /^The last session was killed \(Error, exit 137\)\. Resuming automatically, try \d+ of \d+\.$/.test(t),
          ).length,
        { timeout: 120_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await waitForStatus(page, runId, 'idle', 120_000);
  });
});

// ---- BR-42: reactivation does not replay what was missed ----

test.describe('BR-42: reactivation', () => {
  test('TC-42.2: a comment missed while suspended starts no run after reactivation, and a new comment does', async ({
    page,
    request,
  }) => {
    const w = await newWorld(page);
    const missed = await stageTicket(w);
    await suspend(w.orgId, w.reason);

    // Given: the comment delivered while suspended is ignored.
    const missedDelivery = newDeliveryId();
    const first = await deliver(request, w, missed, missedDelivery);
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toEqual({ outcome: 'ignored' });
    await expect.poll(() => recordedOutcomes(missedDelivery)).toEqual(['ignored_org_suspended']);

    // Step 1: reactivate. Step 2: the missed comment started no run (no poll Schedule exists to replay it, see TC-39.1;
    // its intake rows, over every channel, hold only the suspended-org outcome).
    await reactivateOrg(pa, w.orgId, 'e2e check');
    expect(await runsOnTicket(w, missed.ticketNumber)).toEqual([]);
    expect(await recordedOutcomesOfComment(missed.commentId)).toEqual(['ignored_org_suspended']);

    // Step 3: a new comment on the same ticket starts a run on the fake pod.
    const fresh: Staged = { ticketNumber: missed.ticketNumber, commentId: await stageComment(w, missed.ticketNumber) };
    const freshDelivery = newDeliveryId();
    const res = await deliver(request, w, fresh, freshDelivery);
    const text = await res.text();
    expect(res.status(), text).toBe(202);
    expect(JSON.parse(text), text).toEqual({ outcome: 'run_created' });
    // The run belongs to the new comment: its intake row is the one that created it, the missed comment's row did not.
    expect(await recordedOutcomesOfComment(fresh.commentId)).toEqual(['run_created']);
    expect(await recordedOutcomesOfComment(missed.commentId)).toEqual(['ignored_org_suspended']);
    await expect.poll(async () => (await runsOnTicket(w, missed.ticketNumber)).length).toBe(1);
    const [run] = await runsOnTicket(w, missed.ticketNumber);
    expect(run, 'the run of the new comment').toBeTruthy();
    if (run) {
      toCancel.push({ page, runId: run.id });
      await waitForStatus(page, run.id, 'idle');
    }
  });
});

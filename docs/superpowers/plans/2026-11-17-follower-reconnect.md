# Follower Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lost connection to the Kubernetes API never fails a run or deletes its workspace: the log follower reconnects for up to 30 minutes, then the run parks with its volume kept.

**Architecture:** A `Reconnector` in `follow-core.ts` wraps every cluster call the follower makes: jittered backoff, heartbeats, `contact_lost` / `contact_restored` lifecycle events, and an episode clock kept in heartbeat details. When the window runs out, the follower returns the existing lost-pod result (`podLost`, plus a new `contactLost`), which the workflow already parks. The workflow, behind the patch `follower-reconnect`, gives the follower and every cluster-touching activity (`deleteJob`, `endSession`, `ensureJobGone`) an unlimited retry policy, with cluster 4xx errors made non-retryable.

**Tech Stack:** TypeScript (strict), Temporal TS SDK 1.25, `@kubernetes/client-node`, undici, Vitest, Playwright (local e2e against `KUBE_MODE=fake`).

**Spec:** `docs/superpowers/specs/2026-11-17-follower-reconnect-design.md`

## Global Constraints

- Reconnect window: 30 min default, set by worker env `RUN_RECONNECT_WINDOW_SECONDS` (default `1800`, minimum `1`, parsed in `packages/core/src/config.ts` like `RUN_ENDING_DEADLINE_SECONDS`). Not per agent.
- Backoff: starts at 1 s, doubles, capped at 30 s, with jitter. Heartbeat while waiting; the heartbeat timeout is 60 s.
- Transient errors: undici/network errors (`TypeError('fetch failed')`, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `UND_ERR_*`, `BodyTimeoutError`), aborts not caused by our cancel, `ApiException` with HTTP 5xx or 429.
- Permanent errors: `ApiException` with any other 4xx, thrown as non-retryable `ApplicationFailure` type `ClusterPermanentError`. Everything else keeps today's handling (`safeError`, retryable).
- Event payloads: `{ kind: 'contact_lost', text }` and `{ kind: 'contact_restored', text }`, type `lifecycle`. The text is fixed wording plus the classified cause code; it never contains ticket text, secrets or raw error messages.
- Workflow patch id `follower-reconnect`, read once right after `attachLeases`. Histories recorded without it replay unchanged.
- `ACTIVITY_RETRY` stays the global default; only the follower and `deleteJob` / `endSession` / `ensureJobGone` in the run workflow use the unlimited `CLUSTER_RETRY`.
- Do not add a "skip `deleteRunVolume` when the pod did not exit" rule to `finalize`.
- Rules from AGENTS.md: write tests first, no network in tests, no `any`, no unexplained casts, never lower coverage thresholds, `review:sensitive` label.

## Review Focus

1. **The log stream breaks after it opened** (the body errors mid-stream, not on connect). `RealKubeGateway.streamLogs` ends quietly in that case, and the next call (`waitForExit` → `getRunPod`) is the one that fails. Expect reconnect, not failure. Pinned in Task 3 (`stream ends, then getRunPod fails transiently, then the stream reopens`).
2. **Several runs reconnecting at once** must not hammer the API in lockstep. Expect jittered waits. Pinned in Task 2 (`backoff waits are jittered and capped at 30 s`).
3. **A worker restart mid-outage.** Expect no second `contact_lost` and the same window clock. Pinned in Task 2 (heartbeat restore test).
4. **The Postgres write of a contact event fails** during the outage. Expect the follower to keep going and retry the write on the next tick. Pinned in Task 2 (`a failing event write does not end the follower`).
5. **A cancel during a backoff wait.** Expect a prompt `CancelledFailure`, not waiting out the 30 s cap. Pinned in Task 2 (`cancel during backoff`).

---

### Task 1: Error classifier and reconnect window setting (core)

**Files:**
- Create: `packages/core/src/kube/transient.ts`
- Modify: `packages/core/src/kube/index.ts` (export), `packages/core/src/config.ts` (new key near `RUN_ENDING_DEADLINE_SECONDS`, line ~97)
- Test: `packages/core/test/kube-transient.test.ts`, `packages/core/test/config.test.ts`

**Interfaces:**
- Produces:
  - `export const CLUSTER_PERMANENT_ERROR = 'ClusterPermanentError';`
  - `export type KubeErrorClass = { kind: 'transient'; cause: string } | { kind: 'permanent'; status: number } | { kind: 'other' };`
  - `export function classifyKubeError(err: unknown): KubeErrorClass`. `cause` is a short code: `err.cause.code` (e.g. `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`), else `http_<status>`, else the error name (e.g. `BodyTimeoutError`), else `fetch_failed`.
  - `export const RECONNECT_WINDOW_SECONDS = 1800;` and config key `RUN_RECONNECT_WINDOW_SECONDS: number`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('classifyKubeError', () => {
  it.each([
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'UND_ERR_CONNECT_TIMEOUT'],
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }), 'ECONNRESET'],
    [new TypeError('fetch failed'), 'fetch_failed'],
    [new ApiException(502, 'bad gateway', undefined, {}), 'http_502'],
    [new ApiException(429, 'slow down', undefined, {}), 'http_429'],
    [Object.assign(new Error('body timeout'), { name: 'BodyTimeoutError' }), 'BodyTimeoutError'],
  ])('transient: %s', (err, cause) => expect(classifyKubeError(err)).toEqual({ kind: 'transient', cause }));
  it.each([401, 403, 404, 422])('permanent: HTTP %i', (s) =>
    expect(classifyKubeError(new ApiException(s, 'x', undefined, {}))).toEqual({ kind: 'permanent', status: s }));
  it('anything else is other', () => {
    expect(classifyKubeError(new Error('boom')).kind).toBe('other');
    expect(classifyKubeError(new CancelledFailure('c')).kind).toBe('other');
    expect(classifyKubeError('str').kind).toBe('other');
  });
});
// config.test.ts
it('RUN_RECONNECT_WINDOW_SECONDS: default 1800, blank is the default, below 1 is refused', () => { /* same shape as the RUN_ENDING_DEADLINE_SECONDS test */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core exec vitest run test/kube-transient.test.ts test/config.test.ts`
Expected: FAIL (module not found / key undefined).

- [ ] **Step 3: Implement `classifyKubeError`, the constants and the config key**

`AbortError` / `DOMException` with name `AbortError` counts as transient: the follower only reaches the classifier for aborts it did not cause, because it checks its own signal first.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`devbox run fix` until `fix: clean.`, then `git commit -m "feat(core): classify transient cluster errors; add RUN_RECONNECT_WINDOW_SECONDS (#89)"`.

---

### Task 2: Reconnector and follow loop (worker, shared by runs and setup tests)

**Files:**
- Modify: `apps/worker/src/activities/follow-core.ts` (`FollowEnv`, `HeartbeatDetails`, `FollowPass`, `FollowHooks`, `waitForPod`, `followPodLog`)
- Test: `apps/worker/test/follow-core.test.ts`

**Interfaces:**
- Consumes: `classifyKubeError`, `CLUSTER_PERMANENT_ERROR` (Task 1).
- Produces:
  - `FollowEnv.reconnectWindowMs: number` (required).
  - `export const RECONNECT_INITIAL_MS = 1_000; export const RECONNECT_MAX_MS = 30_000;`
  - `export interface ContactEvents { lost(cause: string, at: Date): Promise<void>; restored(downMs: number, at: Date): Promise<void>; }`
  - `export class ContactLostError extends Error { constructor(readonly lostSinceMs: number) }`, thrown once the window has run out.
  - `export interface Reconnector { readonly lostSinceMs: number | null; lost(cause: string): Promise<void>; restored(): Promise<void>; call<T>(fn: () => Promise<T>): Promise<T>; }`
  - `export function createReconnector(o: { clock: Clock; windowMs: number; signal: AbortSignal; beat: () => void; lostSinceMs: number | null; events?: ContactEvents; random?: () => number }): Reconnector`
    - `lost(cause)`: opens an episode if none is open (sets `lostSinceMs`, sends `events.lost` once), throws `ContactLostError` when `now - lostSinceMs >= windowMs`, otherwise sleeps the next backoff (honours `signal`, then throws `CancelledFailure`), heartbeating through `beat` at least every 10 s.
    - `restored()`: when an episode is open, sends `events.restored(now - lostSinceMs)`, clears it and resets the backoff.
    - `call(fn)`: loops `fn()`. On success it calls `restored()`. On error, `classifyKubeError` decides: transient → `lost(cause)` and retry; permanent → `ApplicationFailure.nonRetryable('<what>: cluster refused the request (HTTP <status>)', CLUSTER_PERMANENT_ERROR)`; other → rethrow.
    - A failing `events.lost` / `events.restored` is swallowed and retried on the next `lost()` / `restored()` call (keep a pending flag).
  - `HeartbeatDetails`: `{ lastLine: number; lostSinceMs?: number }`. `beat()` writes both.
  - `FollowPass.cluster<T>(fn: () => Promise<T>): Promise<T>`, the pass's reconnector `call`, for hooks that query the cluster.
  - `FollowHooks.contact?: ContactEvents`.
  - `FollowHooks.onContactLost(): Promise<{ done: R }>` (required). Called when `ContactLostError` reaches `followPodLog`; it either returns a result or throws.
  - `waitForPod(env, jobName, signal, opts?: { cluster?: Reconnector; seenStarted?: boolean })`. With `seenStarted`, `Unknown` and `Pending` no longer count against the Pending limit: they go to `cluster.lost('pod_unknown')`.

- [ ] **Step 1: Write the failing tests** (add a `describe('reconnect', ...)` using `MockActivityEnvironment` and `kubeWith`)

```ts
it('stream open and getRunPod fail with fetch failed and 502 three times each, then recover → normal result, no duplicate lines, one lost and one restored event, heartbeats while waiting');
it('failures past reconnectWindowMs → hooks.onContactLost is called and its result returned');
it('a 403 from getRunPod → ApplicationFailure type ClusterPermanentError, nonRetryable, no backoff');
it('heartbeat restore: heartbeatDetails { lastLine: 5, lostSinceMs: now - 10 min } → no second lost event; window ends 20 min later, not 30');
it('backoff waits are jittered and capped at 30 s'); // random = () => 1 gives 1,2,4,8,16,30,30 s; random = () => 0 gives the floor the jitter allows
it('a failing event write does not end the follower; it is retried and sent once');
it('cancel during backoff → CancelledFailure within one poll, not after the cap');
it('first secrets() read fails transiently → waits and retries; never follows without the list');
// waitForPod
it('Running, then Unknown past the Pending limit → no POD_PENDING_TIMEOUT when seenStarted');
```

Use a fake clock you advance from the injected `sleep`, or small window values (e.g. `reconnectWindowMs: 50`) with real time, matching the existing tests' style.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/worker exec vitest run test/follow-core.test.ts`
Expected: the new tests fail.

- [ ] **Step 3: Implement `createReconnector` and wire it into `followPodLog`**

- Create the reconnector after the heartbeat restore. Seed it with `resumed.data.lostSinceMs ?? null`, using `ac.signal` and `hooks.contact`.
- Wrap the first `hooks.secrets()` read in `cluster.call`. The periodic re-reads keep swallowing errors as today.
- Call `waitForPod(env, jobName, ac.signal, { cluster, seenStarted })`. `seenStarted` is true when `durable > 0` or a pass has already run, and its `getRunPod` goes through `cluster.call`.
- Wrap the `for await` over `streamLogs` in a try/catch. A transient error calls `cluster.lost(cause)` and then `continue`s the outer loop: re-attach, skipping lines up to `durable`. A permanent error is thrown as above, and anything else is rethrown. Call `cluster.restored()` on the first line received.
- Catch `ContactLostError` around the outer loop and return `(await hooks.onContactLost()).done`.
- `ContactLostError` and `CLUSTER_PERMANENT_ERROR` failures must pass through `safeError` unchanged.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS, along with the existing follow-core tests.

- [ ] **Step 5: Commit**

`devbox run fix`, then `git commit -m "feat(worker): reconnect loop in the pod log follower (#89)"`.

---

### Task 3: Run and setup-test followers use the reconnector

**Files:**
- Modify: `apps/worker/src/activities/run.activities.ts` (`FollowPodLogsResult`: add `contactLost?: true`; `RunActivityDeps.config` picks `RUN_RECONNECT_WINDOW_SECONDS`)
- Modify: `apps/worker/src/activities/run.activities.impl.ts` (`followPodLogs` ~line 845, `waitForExit` ~line 1012)
- Modify: `apps/worker/src/activities/setup-test.activities*.ts` (pass `reconnectWindowMs`; add `onContactLost`, which throws)
- Modify: `apps/worker/src/activities/index.ts` / worker module wiring, if the config is threaded there
- Test: `apps/worker/test/follow-core.test.ts` (the run follower section that uses `createRunActivities`), `apps/worker/test/run.activities.int.test.ts` (event rows)

**Interfaces:**
- Consumes: `FollowPass.cluster`, `FollowHooks.contact`, `FollowHooks.onContactLost`, `ContactEvents` (Task 2), `RUN_RECONNECT_WINDOW_SECONDS` (Task 1).
- Produces: `FollowPodLogsResult.contactLost?: true`. After the window, with the agent started, the result is `{ exitCode: -1, agentStarted: true, podLost: true, contactLost: true, lostText: 'lost contact with the cluster for 30 min', scrollbackTail? }`. The minutes in the text come from the window.

- [ ] **Step 1: Write the failing tests**

```ts
it('stream ends, then getRunPod fails transiently, then the stream reopens → the run result is the pod exit code; one contact_lost and one contact_restored lifecycle event');
it('window passes after the agent started (findSetupState agentStarted) → { podLost: true, contactLost: true, agentStarted: true, exitCode: -1 }');
it('window passes before the agent started → ApplicationFailure nonRetryable "lost contact with the cluster before the agent started"');
it('contact event text: "Lost contact with the cluster (ECONNRESET). Retrying." and "Contact with the cluster restored after 2 min."; no raw error message stored');
it('setup-test follower: window passes → non-retryable failure (nothing kept)');
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/worker exec vitest run test/follow-core.test.ts` (unit). The int test runs with the worker's integration config: `pnpm --filter @agentdesk/worker exec vitest run test/run.activities.int.test.ts`.
Expected: the new tests fail.

- [ ] **Step 3: Implement**

- `waitForExit(ctx, signal, cluster: FollowPass['cluster'])` runs `getRunPod` through `cluster`, and `afterStream` passes `pass.cluster`.
- `contact.lost` / `contact.restored` append a `lifecycle` event through `appendRunEvent` inside `withOrg`, with the same shape as `recordEndingDeadline` (no line key).
- `onContactLost` runs `findSetupState(ctx, -1, resume ? await floorOf() : 0)`. If the agent started, it returns the result above with `scrollbackTail` from the text tail. If not, it throws the non-retryable failure.
- `FollowEnv.reconnectWindowMs = config.RUN_RECONNECT_WINDOW_SECONDS * 1000`. Add an optional test override, `timing.reconnectWindowMs`, next to `pendingLimitMs`.

- [ ] **Step 4: Run them and see them pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

`devbox run fix`, then `git commit -m "feat(worker): run follower reconnects and reports contact loss (#89)"`.

---

### Task 4: Workflow patch: unlimited cluster retries, park survives the outage

**Files:**
- Modify: `apps/worker/src/workflows/retry.ts` (add `CLUSTER_RETRY`)
- Modify: `apps/worker/src/workflows/run.workflow.ts`
- Test: `apps/worker/test/run.workflow.test.ts`; new fixture `apps/worker/test/fixtures/run-follower-reconnect-history.json` (written with `UPDATE_REPLAY_FIXTURES=1`)

**Interfaces:**
- Consumes: `FollowPodLogsResult.contactLost` (Task 3). The constant `'ClusterPermanentError'` is mirrored in the workflow the way `POD_PENDING_TIMEOUT` is, because workflow code cannot import core.
- Produces:
  - `export const CLUSTER_RETRY: RetryPolicy = { initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 0 };`
  - `const FOLLOWER_RECONNECT_PATCH = 'follower-reconnect'`; `let followerReconnect = false`, set by `patched(...)` right after `attachLeases = patched(ATTACH_LEASES_PATCH)`.
  - `const clusterAct = proxyActivities<Pick<RunActivities, 'deleteJob' | 'endSession' | 'ensureJobGone'>>({ startToCloseTimeout: '2 minutes', retry: { ...CLUSTER_RETRY, nonRetryableErrorTypes: [CLUSTER_PERMANENT_ERROR] } })`, plus `const kubeAct = () => (followerReconnect ? clusterAct : act)`.

- [ ] **Step 1: Write the failing tests** (new `describe('follower reconnect (follower-reconnect)')`, extending `Script` with `followFailFirst?: number`, `deleteJobFailFirst?: number`, `endSessionFailFirst?: number` and `resumeCreateFailsRetryable?: boolean`; failures are `new Error('fetch failed')`)

```ts
it('follower returns contactLost after session_started → parkRun reason pod_lost, deleteRunVolume not called, no failed status');
it('followPodLogs throws a retryable error 6 times, then returns exit 0 → succeeded (no 5-attempt cap)');
it('followPodLogs throws ClusterPermanentError → failed at once, Job and volume cleaned up');
it('deleteJob inside park fails 6 times, then succeeds → parked, volume kept');
it('idle timer fires and endSession fails 6 times, then succeeds → parks, not failed');
it('resume: createRunSecretAndJob and the rollback deleteJob fail retryably → back to parked with the same expiry; volume kept; status not failed');
it('hard timer during an outage: finalize deleteJob fails 6 times, then succeeds → timed_out, then deleteRunVolume');
```

Add the history of the first test to `captured['run-follower-reconnect']` and to the replay list (around line 1912).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/worker exec vitest run test/run.workflow.test.ts -t "follower reconnect"`
Expected: FAIL (6 retryable failures exceed 5 attempts, so the run fails).

- [ ] **Step 3: Implement**

- `followPod` retry: `followerReconnect ? { ...CLUSTER_RETRY, nonRetryableErrorTypes: [POD_PENDING_TIMEOUT, CLUSTER_PERMANENT_ERROR] } : { ...RETRY, nonRetryableErrorTypes: [POD_PENDING_TIMEOUT] }`.
- Replace `act.deleteJob` with `kubeAct().deleteJob` in `park()` (~663), `abandonPod` (~585), the `resumeAttempt` rollback (~774) and `finalize` (~838). Replace `act.ensureJobGone` with `kubeAct().ensureJobGone` in `finalize`, and both `act.endSession` calls (~450, ~474) with `kubeAct().endSession`.
- The `contactLost` result needs no new branch: `endOutcome` already parks on `podLost` with `agentStarted`. Check this with the first test.

- [ ] **Step 4: Run them and see them pass, including replay**

Run: `pnpm --filter @agentdesk/worker exec vitest run test/run.workflow.test.ts`
Expected: PASS, including `replay: histories from this run and the checked-in fixtures replay without nondeterminism`. Then run once with `UPDATE_REPLAY_FIXTURES=1` to write the new fixture, and check the fixture contains no token (the existing R19 test covers this).

- [ ] **Step 5: Commit**

`devbox run fix`, then `git commit -m "fix(worker): a lost cluster connection parks the run instead of failing it (#89)"`.

---

### Task 5: Fake cluster outage, local e2e, ADR

**Files:**
- Modify: `packages/core/src/kube/fake-gateway.ts`. When `<stateDir>/kube/.outage` exists, `getRunPod`, `streamLogs` (checked each tick), `readSecret`, `deleteJob`, `exec`, `ensureJob` and `ensureSecret` throw `Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })`.
- Test: `packages/core/test/fake-gateway.test.ts` (outage file toggles the errors on and off)
- Modify: `apps/web/e2e/local/run.spec.ts` (new `describe('cluster outage')`)
- Create: `docs/adr/0024-transient-cluster-errors-never-end-a-run.md`
- Modify: `docs/runbooks/tests-and-e2e.md` §4 (one line: how to run the outage specs and the env they need)

**Interfaces:**
- Consumes: everything above. The stack runs with `RUN_RECONNECT_WINDOW_SECONDS=20` for the window test. The spec reads `E2E_RECONNECT_WINDOW_SECONDS` and skips when it is unset, like `E2E_IDLE_END_SECONDS`.

- [ ] **Step 1: Write the failing tests**

```ts
// fake-gateway.test.ts
it('with kube/.outage present every cluster call throws fetch failed; removing it restores them');

// run.spec.ts, describe('cluster outage')
test('a short cluster outage mid-run does not fail the run: the timeline shows lost and restored contact', async ({ page }) => {
  // start a run, wait for idle; write `${FAKE_STATE_DIR}/kube/.outage`; wait for a contact_lost lifecycle event in /api/runs/:id/log;
  // remove the file; expect contact_restored, then status still idle (not failed), and the pod dir still exists.
});
test('an outage longer than the window parks the run with its work kept and it can be resumed', async ({ page }) => {
  // window = E2E_RECONNECT_WINDOW_SECONDS; write .outage; wait past the window; remove .outage;
  // expect status paused with pauseReason pod_lost; the pod dir gone; Resume → Needs you with the earlier conversation.
});
```

Always remove `.outage` in a `finally` so a failed test cannot leave the stack broken.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core exec vitest run test/fake-gateway.test.ts`. Then start the stack with `RUN_RECONNECT_WINDOW_SECONDS=20 devbox run dev-bg` and run `E2E_RECONNECT_WINDOW_SECONDS=20 pnpm --filter @agentdesk/web exec playwright test e2e/local/run.spec.ts -g "cluster outage"`.
Expected: the unit test fails. The e2e fails if run against the stack before the fake outage switch exists.

- [ ] **Step 3: Implement the fake outage switch, then write the ADR**

ADR content (accepted): context (run #15); decision (follower and run-Job cluster calls retry without limit, with cluster 4xx non-retryable; a lost connection past 30 min parks; the list of definitive end signals from the spec Goals); consequences (a timed-out run holds its slot during an outage; the reconciler still sweeps leftovers).

- [ ] **Step 4: Run them and see them pass**

Same commands. Expected: PASS. If the stack cannot start, say so in the PR and list both specs as written but not run.

- [ ] **Step 5: Final checks and commit**

Run `pnpm --filter @agentdesk/core typecheck test` and `pnpm --filter @agentdesk/worker typecheck test`, and report the real results. `devbox run fix`, then `git commit -m "test(worker): local e2e for cluster outages; ADR 0024 (#89)"`.

PR: one PR for #89 if it stays around 800 lines. Otherwise split after Task 3 (core and follower) and Task 5 (workflow, e2e, ADR). Label `review:sensitive`.

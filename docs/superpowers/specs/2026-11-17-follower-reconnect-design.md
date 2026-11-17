# A lost cluster connection never fails a run or deletes its workspace

Status: draft (2026-11-17). Issue: #89. Sensitive path (run Job, `run.workflow.ts`): `review:sensitive`.

## Why

Run #15 lost 14 minutes of agent work because the local k3s API stopped answering for about 2 minutes. The log
follower (`followPodLogs`) gave up after its 5 Temporal attempts, the workflow marked the run `failed`, and `finalize`
deleted the Job and the run volume, although the pod was alive the whole time. Nothing was recoverable.

A transient infra failure (API unreachable, log stream drop, worker restart, node flap) must never fail a run and must
never delete the pod or the workspace while the pod could still be alive.

Root cause (verified in code, see #89 for the timeline):

1. `followPodLogs` uses the global `ACTIVITY_RETRY` (5 attempts) for a run that may last days. Every failed reconnect
   and every worker restart spends an attempt.
2. Nothing retries inside an attempt: `FollowLog.log` throws when the first `fetch` fails or the status is not 200;
   `waitForPod` and `waitForExit` call `getRunPod` once per poll with no retry; `followPodLog` rethrows via `safeError`.
3. A follower error goes to the workflow's catch (`if (current.error !== undefined) throw current.error;`), which marks
   the run `failed`; `finalize` then runs `deleteJob` and `deleteRunVolume` whatever the cause.
4. The existing "pod lost after the agent started parks" path (`pod-lost-parks`, `endOutcome`) only sees a follower that
   returned a result, never one that threw.

## Goals

- A cluster outage shorter than the **reconnect window (30 min, one worker setting)** is invisible to the run's outcome:
  the follower reconnects and continues from its last durable line (no missed or duplicated events).
- An outage longer than the window **parks** the run (reason `pod_lost`) once the agent has started: the Job is deleted
  once the API answers, the slot is freed, the volume is kept, and the run can be resumed until it expires under the
  existing keep rules (`paused_keep_seconds`, default 7 days).
- A worker restart never consumes a retry budget that can fail the run.
- The run's event stream says when contact was lost and when it came back.
- Only these end a run: an exit code, a pod confirmed gone (today's meaning: the cluster answered and lists no pod for
  the Job; no extra Job lookup is added), a person (cancel or finish), the hard timer, or session expiry.

## Non-goals

- Fixing the host memory pressure that caused the stall, or the stale NotReady k3s node (ops follow-ups in #89).
- A "reconnecting" run status or UI badge beyond the two lifecycle events.
- Per-agent reconnect windows.
- Changing how the attach terminal behaves during an outage.
- The one-off mitigation for runs in flight today (a Temporal write that needs the owner's approval; tracked in #89).

## Anti-goals (a failure even if it "works")

- Deleting a run volume because we could not see the pod.
- Leaking volumes for runs that genuinely failed (e.g. Job never started, setup failed): those still clean up as today.
- Treating a 403/401 or other permanent error as transient forever (it would hide a broken deployment).

## Decisions (owner)

- After the window, **park** (not keep the Job alive reconnecting). Parked runs hold no pod and no slot, only the volume.
- Window: **30 minutes**, one worker-level setting (not per agent).
- Approach **A**: the reconnect loop lives inside the follower (below).

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Reconnect loop inside the follower; after the window it returns `contactLost` instead of throwing; the workflow parks | Most code (follower + tests), but events and the window live in one place | **Picked** |
| B | Only make the follower's Temporal retry unlimited | One-line change, but no reconnect events, every try logs as a failure, and the window would need bookkeeping in the workflow | Rejected (kept only as a safety net, below) |
| C | A separate health-check activity signalling the workflow | Two moving parts that can disagree (ping ok, stream broken); more complexity for no gain | Rejected |

## Design

### 1. Transient vs final errors (core, `packages/core/src/kube`)

A single classifier `isTransientKubeError(err): boolean`:

- **Transient:** `TypeError('fetch failed')` and other undici network errors (connect timeout, `ECONNRESET`,
  `ECONNREFUSED`, `UND_ERR_*`, `BodyTimeoutError`), aborts not caused by our own cancel, `ApiException` with HTTP 5xx or
  429.
- **Permanent:** 4xx other than 429 (401/403 mean a broken deployment and must surface). These are thrown as a new
  **non-retryable** `ApplicationFailure` type `ClusterPermanentError`, so an unlimited retry policy never loops on them.
- **Anything else** (a cancel, a Postgres blip, a bug): handled as today (cancel is a cancel; other errors go through
  `safeError` and stay retryable), so the unlimited follower policy retries them instead of failing the run.
  (Builder-check call: only cluster 4xx is made non-retryable.)

`FollowLog.log` keeps its shape but must throw errors the classifier can read (today a non-200 throws an
`ApiException` carrying the status, which is fine). Error text should include the underlying cause (`err.cause.code`,
e.g. `UND_ERR_CONNECT_TIMEOUT`) instead of a bare `fetch failed`, through the existing `safeError` redaction.

### 2. Reconnect loop (worker, `follow-core.ts` + `run.activities.impl.ts`)

Every cluster call the run follower makes (pod wait `getRunPod`, log stream open `streamLogs`, exit wait `waitForExit`,
and the **first redaction read** `redactionList` → `kube.readSecret`, which must stay fail-closed: the follower waits,
it never proceeds without the list) goes through one helper, e.g. `withReconnect(env, call)`:

- On a transient error: start (or continue) a **contact-lost episode**. Back off with jitter: 1 s, doubling, capped at
  30 s (full jitter is fine). Heartbeat while waiting (heartbeat timeout is 60 s, so waits stay under it). Honour the
  activity cancel signal during the wait.
- First failure of an episode: append a run lifecycle event `{ kind: 'contact_lost', text }` (type `lifecycle`, same
  shape as `ending_deadline`). Text is fixed wording plus the classified cause, never ticket text or secrets.
- First success after failures: append `{ kind: 'contact_restored', text }` with the outage duration; the episode (and
  the window clock) resets.
- Episode longer than `reconnectWindowMs` (default 30 min, from worker env, injected through `FollowEnv`): stop and
  **return** a result instead of throwing (see 3).
- The episode start survives a new activity attempt: it is stored in the heartbeat details next to `lastLine`, and a
  new attempt that finds an open episode continues it (no second `contact_lost`, same window clock). So "longer than
  the window" counts across worker restarts. (Builder-check call.)
- A permanent error is thrown as `ClusterPermanentError` (non-retryable).
- Event appends need Postgres, not the cluster, so they can be written during the outage. If the append itself fails,
  it is retried on the next backoff tick; it must not end the follower.

Re-attaching after contact returns reuses the existing `durable` index: lines up to `durable` are skipped, so nothing is
missed or stored twice (today's behaviour, unchanged).

`waitForPod`: the Pending limit must not apply once the pod has been seen past Pending (Running, Succeeded, Failed).
Today it loops on `Unknown` and can raise `POD_PENDING_TIMEOUT` for a pod that was running; after this change `Unknown`
on a pod already seen running is treated as a transient contact loss (counts against the reconnect window, not the
Pending limit).

The setup-test follower shares `follow-core.ts`. It gets the same reconnect loop (it is the same helper), but its
"window expired" handling stays a failure: setup tests have nothing to keep.

### 3. What the follower returns after the window

- **Agent started** (the existing `findSetupState(...).agentStarted`): return the existing lost-pod result shape:
  `{ exitCode: -1, agentStarted: true, podLost: true, contactLost: true, lostText: 'lost contact with the cluster for 30 min', scrollbackTail? }`.
  `contactLost` is a new optional field so the workflow and the run events can tell "could not see the pod" apart from
  "pod confirmed gone". Both park the same way.
- **Agent not started** (checkout, plugins, setup): throw a non-retryable failure `lost contact with the cluster before
  the agent started`. The run fails and cleans up as today: there is no agent work worth keeping. (Builder's call
  recorded here; the owner agreed to this rule.)

Note: `findSetupState` reads Postgres only, so it works during the outage.

### 4. Workflow (`run.workflow.ts`), behind a new patch id `follower-reconnect`

Read once with the other patch flags (after `attachLeases`), so in-flight workflows replay unchanged.

- **Follower retry policy** (only when patched): `{ initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 0
  (unlimited), nonRetryableErrorTypes: [POD_PENDING_TIMEOUT] }`. The start-to-close timeout (hard timer + allowance)
  still bounds it. This is the safety net for worker restarts (heartbeat timeouts) and bugs that escape the loop.
  `ACTIVITY_RETRY` stays the global default for every other activity; the ADR records this exception.
- **Park on contact lost:** a result with `podLost: true` already parks through `endOutcome` (`lostKindOf(phase)`,
  reason `pod_lost`) when `podLostParks` and `agentStarted`. No new branch is needed beyond passing `contactLost`
  through for the event text.
- **Cluster-tolerant activities:** when patched, every workflow step that calls the cluster for a run whose pod may be
  alive uses a second activity proxy with the unlimited policy above (`ClusterPermanentError` non-retryable), so an
  outage makes it wait, never fail the run:
  - `deleteJob` everywhere (inside `park()`, `abandonPod`, the resume rollback in `resumeAttempt`, and finalize);
  - `endSession` (idle-timer end and person Finish; the idle timer keeps running during an outage, so this is likely);
  - `ensureJobGone` in finalize.
  A cancel still interrupts the non-finalize ones (then today's rules apply).
- **Resume during an outage:** `createRunSecretAndJob` failing on resume is a failed resume attempt: the run goes back
  to `parked` with the same expiry (today's failed-resume path), never `failed`. Its rollback `deleteJob` is tolerant
  (above), so the error cannot escape `park()`.
- **Finalize during an outage** (e.g. the hard timer fires): the tolerant `deleteJob` waits for the API, so the slot and
  the final status are written only after the Job is gone. Accepted: during an outage no other run can start anyway, and
  releasing the slot early could let a Job with live credentials outlive its slot. (Builder-check call.)
- **Finalize is unchanged.** The volume is deleted only on paths that reach `finalize` with a definitive end (exit code,
  pod confirmed gone before the agent started, cancel, hard timer, history limit, setup failure). With the follower no
  longer throwing for transient errors, and park retrying, a contact loss after the agent started never reaches
  `finalize`. We deliberately do not add "skip `deleteRunVolume` when the pod did not exit": that would also keep the
  volumes of runs that genuinely failed (anti-goal). Volumes and Jobs finalize fails to delete are already swept by
  `reconcile.activity.ts`.

### 5. Hard timer and person actions during an outage

- Hard timer fires while reconnecting: a definitive end. Cancel the follower, finalize with the tolerant `deleteJob`,
  then delete the volume (correct: the run is over).
- Finish while reconnecting: the tolerant `endSession` waits for the API; the ending deadline then applies as today.
- Idle timer fires while reconnecting: same as Finish (tolerant `endSession`), then park as today.
- Cancel while reconnecting: today's rules.

### 6. Config

`RUN_RECONNECT_WINDOW_SECONDS` (default 1800, min 1) in `packages/core/src/config.ts`, next to the other `RUN_*`
settings, injected into `FollowEnv` as `reconnectWindowMs`. Backoff numbers (1 s start, 30 s cap) are constants.

### 7. Contracts / UI

- Two new lifecycle `kind` values (`contact_lost`, `contact_restored`). If lifecycle kinds are an enum in
  `packages/contracts`, add them there first; the web run timeline must render them (at least with the generic
  lifecycle row, which shows `text`). No new run status.
- `pod_lost` is already a `PauseReason`; the paused run page already explains it.

## Tests (write first: rule 9, no network)

- **core:** classifier table (network `TypeError`, undici codes, 5xx, 429 → transient; 401/403/404, cancel → final).
- **`follow-core` / run follower** with a fake gateway:
  - log open and `getRunPod` throw `TypeError('fetch failed')` and HTTP 502 N times, then recover → normal result, no
    duplicate events, heartbeats during backoff, one `contact_lost` and one `contact_restored` event.
  - failures past the window with agent started → `{ podLost: true, contactLost: true }`; agent not started →
    non-retryable failure.
  - 403 → thrown at once, no reconnect.
  - `waitForPod`: Running then `Unknown` past the Pending limit → no `POD_PENDING_TIMEOUT`.
- **workflow** (`run.workflow.test.ts`, Temporal test env with mocked activities):
  - follower returns `contactLost` after `session_started` → `parkRun` with reason `pod_lost`, `deleteRunVolume` not
    called, status not `failed`.
  - `deleteJob` inside park fails several times with a retryable error, then succeeds → still parked.
  - follower throws a retryable error 6+ times (worker restart simulation) → not failed.
  - `endSession` (idle end) fails retryably several times, then succeeds → parks, not failed.
  - resume while `createRunSecretAndJob` and the rollback `deleteJob` fail retryably → back to `parked`, volume kept.
  - follower throws `ClusterPermanentError` → run fails without looping.
- **follower:** episode start restored from heartbeat details on a new attempt → no second `contact_lost`, window not
  reset; first redaction read failing transiently → waits (no follow without the list), then proceeds.
- **replay:** a history recorded before the patch replays without nondeterminism.
- **e2e (local, fake pod):** drop the log stream / make the fake API return 502 for a while mid-run → run continues,
  timeline shows lost and restored events; and an outage past a short window (set the env low in the e2e stack) → run
  parked with `pod_lost`, resumable. See `docs/runbooks/tests-and-e2e.md` §3a. If the fake pod cannot simulate an API
  outage, extending it is in scope.

## ADR

`docs/adr/0024-transient-cluster-errors-never-end-a-run.md`: the follower and run-Job deletes get unlimited retries
(exception to the global 5-attempt rule); a lost connection parks rather than fails; the list of definitive end signals.

## Acceptance criteria

- Dropping the Kubernetes API for 2+ minutes mid-run does not fail the run; it continues from its last durable line and
  shows `contact_lost` / `contact_restored`.
- Past 30 minutes, a run whose agent started is parked (`pod_lost`) with its volume kept, and can be resumed.
- A worker restart does not consume a retry budget that can fail the run.
- `deleteRunVolume` runs only for the definitive end signals listed in Goals.
- Coverage gates pass; no thresholds lowered.

## Left to the builder

- Exact helper names and where the classifier lives inside `packages/core/src/kube`.
- Jitter flavour and the exact event wording.
- How the fake pod / fake API simulates an outage for e2e.
- PR split if the change exceeds ~800 lines (suggested: core classifier + follower loop; then workflow patch + ADR + e2e).

# Run time limit up to 7 days with workspace-token refresh (design)

Status: accepted, implemented in one PR. Date: 2026-11-15. Issue #34. Decision record: [ADR 0021](../../adr/0021-run-time-limit-7-days-with-token-refresh.md). Amends `2026-11-12-control-plane-design.md` §6.2, §8 and ADR 0010 (the 3300 s cap and the one-hour token rule).

## Problem

An agent run can be useful for a full day, but `timeout_seconds` was capped at 3300 s (about 55 min). The cap existed only because the single-repo workspace token expires after 1 hour and the run must never outlive it.

## Goals

- A run time limit per agent from 60 s to 604800 s (7 days). New agents default to 86400 s (24 h). Existing agents keep their saved value.
- The pod keeps a working workspace token for the whole run, without a restart, and each token stays single-repo and at most 1 hour.
- The UI field takes minutes, hours or days, and the run page shows the chosen limit.

## Non-goals

- No chained or resumed pods (ADR 0010 stays: one Job per run).
- No change to the idle timer (10 min with no terminal attached ends an idle run), the slot limits, or `RUN_SETUP_TIMEOUT_SECONDS` (still 1 to 3300, counted inside the run limit).
- No guard for the Claude credential expiring early (see Assumptions).
- Setup-test Jobs mount the token the same way but are not refreshed; they live well under an hour.

## Assumptions

- A Claude OAuth token from `claude setup-token` lasts about 1 year (secondary sources only; no official page found). It may be revoked early. An expired credential fails the run with the agent's own auth error. Recorded, not guarded.

## Design

### 1. Limits (contracts, db, core, worker, web)

- `packages/contracts`: `AGENT_TIMEOUT_SECONDS_MIN = 60`, `AGENT_TIMEOUT_SECONDS_MAX = 604800`, `AGENT_TIMEOUT_SECONDS_DEFAULT = 86400`. `PutAgentRequest.timeoutSeconds` uses them; the over-limit message says "The run time limit can be at most 7 days", at pointer `/timeoutSeconds`. The API and worker import the default; `packages/db` cannot import contracts, so its schema repeats the literals with a comment.
- `packages/db`: migration `0010_agent_timeout_7_days.sql` drops `agents_timeout_check`, adds `between 60 and 604800` and sets the column default to 86400. It changes no rows, so existing agents keep their value (a test guards that the file has no `update`, `delete` or `insert`). `0000_schema.sql` is not edited.
- Project create inserts the default agent with `AGENT_TIMEOUT_SECONDS_DEFAULT`; the run list and `loadRun` fall back to it too.
- `buildRunJob`: no clamp (only `max(1, floor)`). `activeDeadlineSeconds = timeout + 120`.
- `run.workflow.ts`: the hard timer and the `followPodLogs` `startToCloseTimeout` use the limit as is.
- `apps/web`: the "Run time limit" field is a `DurationInput` (number plus a minutes/hours/days select, in `ds/` with stories). The form model stays in minutes; `splitMinutes` and `minutesIn` convert for display and entry. `formatLimit(seconds)` ("30 min", "24 h", "2 d 3 h") is used by the setup summary, the run meter's limit and the "Timed out at the … limit" note. The meter's elapsed clock shows `H:MM:SS` and `Dd HH:MM:SS` past an hour and a day.

### 2. Token delivery: a mounted file, not env

Env vars are fixed when the container starts, so updating the Secret never changes `GH_TOKEN` or a clone URL already in the process. Delivery changed:

- The run Secret `run-{runId}` has three kinds of keys: `REPO_CLONE_URL` (the repo URL, no credential in it), the agent credential (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) and `workspace-token`.
- The Job no longer uses `envFrom`. `REPO_CLONE_URL` and the credential keys are explicit `secretKeyRef` env vars, so `workspace-token` is never an env var. It is mounted read-only, key `workspace-token` as file `token`, at `/var/run/agentdesk/workspace-token` (a directory mount, no `subPath`, because subPath mounts never update). `defaultMode 0440` with the pod's `fsGroup 10001`. Env `AGENTDESK_TOKEN_FILE` and `AGENTDESK_GIT_USERNAME` point the runner at it.
- One Secret, not two, on purpose: `reconcile` keeps a Secret only if its name matches a Job, so a separate `run-{id}-token` Secret would be deleted as an orphan while the run is live. Cleanup, reconcile and the redaction read stay unchanged.
- Adapter seam (provider-agnostic): `CodeHostAdapter.cloneUrl(project, token)` and `runEnv(token)` are replaced by `repoUrl(project)` (no secret) and `gitCredentialUsername()`. GitHub returns `x-access-token`. Provider names stay inside the adapter.
- Runner image (`images/runner`): `git-credential-agentdesk` answers git's `get` with the token read from the file on each call, and `bin/gh` sets `GH_TOKEN` from the file per invocation and runs the real `gh` (`PATH` starts with its directory). `entrypoint.sh` registers the helper when `AGENTDESK_TOKEN_FILE` is set, then clones the plain URL. Without it nothing changes.
- The kubelet refreshes a mounted Secret in about 1 to 2 minutes, which the refresh margin covers.
- Redaction: `followPodLog` re-reads the redaction list periodically while it follows (every few minutes, on the injectable `redactionRefreshMs`, checked against the `Clock` as lines arrive) and accumulates: a rotated token is added and earlier tokens stay in the list, since an old one may still be in the pod's output buffer or still valid. A failed re-read keeps the last good list and logs nothing. The token-shaped patterns in `packages/core/src/redact.ts` (`ghs_…`, `x-access-token:…@`) remain a second layer. A test rotates a token of an unrelated shape and proves the new and old values are both redacted.

### 3. Refresh (worker)

- Activity `refreshWorkspaceToken(ctx)`: loads the run; a finished run is a no-op. It mints a new token with the adapter (inside the activity, never in workflow history, ruling R19) and writes it with `KubeGateway.replaceSecretData(name, data)` (read, merge, replace; keeps labels; fails on a missing Secret or a conflict; never creates). A missing Secret fails non-retryably. Errors pass through `safeError` with the token as a known secret.
- Workflow: after the logs follower starts, a loop waits `TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT = 2700` (45 min) with `condition(() => logsDone, interval)`, then calls the activity. A token lasts 3600 s, so a refresh has 15 min of margin for the kubelet sync and retries. The loop ends when the pod's logs end or the run is cancelled. `RunContext.tokenRefreshSeconds` overrides the interval (like `idleEndSeconds`; used by tests).
- Failure handling (judgment call): the activity uses the shared retry policy. If it still fails, the workflow logs a warning (error kind only) and tries again every 60 s for about 15 minutes, then every 5 minutes, so history stays small over days. A failure that can never succeed (non-retryable, e.g. the Secret is gone) ends the loop. The run is never killed for a missed refresh; git and `gh` fail only if the token really expires.
- Determinism: the loop is new workflow code. It is guarded by `patched('token-refresh')`, so runs started before the deploy replay unchanged. The four older replay fixtures are unmodified and still replay; a new fixture records a run with the loop. Those older runs are at most 55 min old and keep their env token.
- History size: the refresh loop alone is small (7 d at about 45 min is about 224 ticks, a few events each), but signals and status changes also add events and `RunWorkflow` has no `continueAsNew`. Temporal ends a workflow at 51,200 events with no cleanup, so as a safety valve the main loop checks `workflowInfo().historyLength` on every wake-up and, at 45,000 events (`HISTORY_EVENT_LIMIT_DEFAULT`; the `historyEventLimit` field of `RunContext` overrides it in tests), finishes the run as failed with a plain reason ("its activity log grew too long"). The normal cleanup then runs (Job and Secret deleted, slot freed). No `patched()` is needed: the check adds no commands and a history under the limit replays unchanged. A real `continueAsNew` that carries a long run past the limit is a follow-up.
- Refresh cadence: the activity returns the next delay (about 75% of the time left until the token's `expiresAt`, at least 60 s, from the injected clock); the workflow waits that long. A missing delay (an older recorded result) falls back to 2700 s. A failed refresh is retried every 60 s for 15 tries, then every 300 s (`refreshWaitSeconds`).

### 4. Long activities

- `followPodLogs` keeps its 10 s heartbeat and 60 s heartbeat timeout. Its `startToCloseTimeout` is the limit plus 300 s, up to about 7 days. A worker restart retries the activity, which re-attaches to the log stream.
- The hard timer `sleep(timeoutSeconds)` is a durable timer.

## Security

- Every token is single-repo, minimum permission, at most 1 hour. A run now holds a sequence of such tokens, never a longer one. The App private key stays on the worker.
- The pod can read the current token, as it could read the env var before. No new exposure inside the pod. Removing the token from env also keeps it out of the Job's container env.
- Sensitive paths touched: run Job/runner, secrets/tokens. The PR gets `review:sensitive` and a high-effort security review.
- `security.md` §1 (delivery), §4 (token and timeout) and the checklist are rewritten; ADR 0010, 0012 and 0019 carry amendment notes; the control-plane and setup specs and the PoC architecture sketch are corrected.

## Testing

- contracts: accepts 60, 3301, 86400 and 604800; rejects 59, 604801 and a fraction; the message names 7 days; the bounds are exported.
- db: the check allows up to 604800 and not 3300, the default is 86400, and the migration changes no rows.
- core: `buildRunJob` deadline for 604800 is 604920 (no clamp); the Job has no `envFrom`, takes secrets by `secretKeyRef`, mounts the token key as a read-only file and never lists it as env; `replaceSecretData` (real and fake) merges, keeps labels, fails when missing and surfaces a conflict; the fake pod env never carries the token; adapter tests for `repoUrl` and `gitCredentialUsername`.
- worker: the Secret holds the repo URL, the token key and the credential; the pod env has no token; `refreshWorkspaceToken` rotates the key only, skips a finished run, fails non-retryably when the Secret is gone, and its errors carry no token; the loop refreshes on an interval, stops with the run, retries a transient failure, ends on a permanent one and leaves the run running; a rotated token is redacted; history never holds the token; old and new histories replay. These use real time with short intervals, like the existing timer tests, because time-skipping cannot skip while `followPodLogs` is in flight.
- runner image: shell tests that the credential helper and `gh` wrapper read the current file content after it changes (and that real `git credential fill` calls the helper), and that the entrypoint registers the helper only when the token file is set.
- web: duration helpers, the `DurationInput` (labelled controls, unit change, invalid on both), the agent form (24 hours, 7 days, saving 2 days and 30 hours, a limit above 7 days refused with the server message, retry after a failed save), the run meter and timed-out note ("24 h", "7 d") and the elapsed clock.
- Not run here: Storybook, the Docker image build, and `e2e-local` (they need a cluster or a built image).

## Rollout

- **Deploy order:** publish the new runner image, then bump `RUNNER_IMAGE` (pinned by digest), then deploy the worker. A new worker with an old image creates Jobs that expect a token file the image cannot read, so every clone would fail.
- Runs in flight at the deploy keep their env token and finish within the old cap; the workflow replays them without the refresh loop.
- Existing agents keep their saved limit; only agents created afterwards default to 24 h.

## Open points

- Mounted-Secret sync time on the target cluster (k3s today). Measure it on the first real long run; the 15 min margin is large, so this is a check and not a risk.
- Whether to cap how many 7-day runs one org may hold at once. Existing `maxConcurrentRuns` applies; no new limit now.

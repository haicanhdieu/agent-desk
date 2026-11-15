# Run time limit up to 7 days with workspace-token refresh (design)

Status: proposed. Date: 2026-11-15. Issue #34. Decision record: [ADR 0021](../../adr/0021-run-time-limit-7-days-with-token-refresh.md). Amends `2026-11-12-control-plane-design.md` §6.2, §8 and ADR 0010 (the 3300 s cap and the one-hour token rule).

## Problem

An agent run can be useful for a full day, but `timeout_seconds` is capped at 3300 s (about 55 min). The cap exists only because the single-repo workspace token expires after 1 hour and the run must never outlive it.

## Goals

- A run time limit per agent from 60 s to 604800 s (7 days). New agents default to 86400 s (24 h). Existing agents keep their saved value.
- The pod keeps a working workspace token for the whole run, without a restart, and each token stays single-repo and at most 1 hour.
- The UI field takes hours and days, and the run page shows the chosen limit.

## Non-goals

- No chained or resumed pods (ADR 0010 stays: one Job per run).
- No change to the idle timer (10 min with no terminal attached ends an idle run), the slot limits, or `RUN_SETUP_TIMEOUT_SECONDS` (still 1 to 3300, counted inside the run limit).
- No guard for the Claude credential expiring early (see Assumptions).

## Assumptions

- A Claude OAuth token from `claude setup-token` lasts about 1 year (secondary sources only; no official page found). It may be revoked early. An expired credential fails the run with the agent's own auth error. Recorded, not guarded.

## Design

### 1. Limits (contracts, db, core, web)

- `packages/contracts`: export `AGENT_TIMEOUT_SECONDS_MIN = 60`, `AGENT_TIMEOUT_SECONDS_MAX = 604800`, `AGENT_TIMEOUT_SECONDS_DEFAULT = 86400`. `PutAgentRequest.timeoutSeconds` uses them. The 400 message says the limit in days. `core` and `worker` import the constants; no second copy.
- `packages/db`: new migration drops `agents_timeout_check` and adds `between 60 and 604800`, and sets the column default to 86400. It does not update rows. `0000_schema.sql` is not edited.
- Project create inserts the default agent with `AGENT_TIMEOUT_SECONDS_DEFAULT`.
- `buildRunJob`: drop the `TIMEOUT_SECONDS_MAX` clamp (keep `max(1, floor)`). `activeDeadlineSeconds = timeout + 120`.
- `run.workflow.ts`: drop the `Math.min(..., TIMEOUT_SECONDS_MAX)`.
- `apps/web`: the "Run time limit" field takes a number and a unit (minutes, hours, days) and sends seconds. A shared `formatDuration(seconds)` renders "30 min", "24 h", "2 d 3 h" on the setup summary, the run meter and the "Timed out at the … limit" note. Loading, empty and error states unchanged; the field shows the server's `/timeoutSeconds` error.

### 2. Token delivery: a mounted file, not env

Env vars are fixed when the container starts, so updating the Secret never changes `GH_TOKEN` or a clone URL already in the process. Delivery changes:

- The run Secret `run-{runId}` keeps the agent credential and static values, still via `envFrom`. It no longer holds the token or a clone URL that contains one.
- A second Secret `run-{runId}-token` holds one key `token`. The Job mounts it as a directory volume at `/var/run/agentdesk/workspace-token` (no `subPath`, because subPath mounts never update). `defaultMode 0440` with `fsGroup 10001`, so uid 10001 can read it.
- Adapter seam (provider-agnostic): `CodeHostAdapter.cloneUrl(project, token)` becomes `repoUrl(project)` (no secret) plus `gitCredential(): { username }` and `cliEnvName(): string | null`. GitHub returns username `x-access-token` and `GH_TOKEN`. Provider names stay inside the adapter.
- Runner image (`images/runner`):
  - `git clone` uses the plain repo URL and a credential helper script that prints `username=…` and `password=$(cat <token file>)` on each call.
  - A `gh` wrapper earlier on `PATH` sets `GH_TOKEN="$(cat <token file>)"` per invocation and execs the real `gh`.
  - `entrypoint.sh` no longer needs `REPO_CLONE_URL` or `GH_TOKEN`.
- The kubelet refreshes a mounted Secret in about 1 to 2 minutes, so each token must have that much margin (see §3).
- Redaction: rotated tokens are not in the `known` list built at start. They are covered by the token-shaped patterns in `packages/core/src/redact.ts` (`ghs_…`, `x-access-token:…@`). A test asserts a rotated token is redacted from followed pod logs. Providers that add a new token shape must add a pattern.

### 3. Refresh (worker)

- New activity `refreshWorkspaceToken(ctx)`: loads the run, mints a new token with the adapter (inside the activity, never in workflow history, ruling R19), and updates Secret `run-{runId}-token`. New gateway method `KubeGateway.replaceSecretData(name, data)` (fake and real), scoped to the run's namespace and labels.
- Workflow: after `createRunSecretAndJob`, a refresh loop runs next to the logs follower and ends with the run. Every `TOKEN_REFRESH_INTERVAL_SECONDS = 2700` (45 min) it calls the activity. A token lasts 3600 s, so a refresh has 15 min of margin before expiry for the kubelet sync and for retries.
- Failure handling (judgment call): the activity uses the shared retry policy. If a tick still fails, the workflow records a `lifecycle` event `token_refresh_failed` and tries again every 60 s until success or the run ends. The run is not killed for a missed refresh; pushes fail only if the token actually expires.
- Time: the loop uses Temporal timers (durable across worker restarts) and the injected `Clock` inside activities.
- Determinism: the loop is new workflow code that in-flight runs replay. Guard it with `patched('token-refresh')` so runs started before the deploy replay unchanged. Those runs are at most 55 min old and keep their env-based token.
- History size: 7 d / 45 min is about 224 ticks, a few events each. Well under the history limit; the loop does not share the signal loop's 1000-event `continueAsNew` gate.

### 4. Long activities

- `followPodLogs` keeps its 10 s heartbeat and 60 s heartbeat timeout. `startToCloseTimeout` becomes limit + margin, up to about 7 days. Because a retry after a worker restart re-attaches to the log stream, the worker test covers a restart mid-run.
- The hard timer `sleep(timeoutSeconds)` is a durable timer; no change besides removing the clamp.

## Security

- Every token is single-repo, minimum permission, at most 1 hour. A run now holds a sequence of such tokens, never a longer one. The App private key stays on the worker.
- The pod can read the current token, as it could read the env var before. No new exposure inside the pod.
- Sensitive paths touched: run Job/runner, secrets/tokens. The PRs get `review:sensitive` and a high-effort security review.
- `security.md` §4 (token ≤ 1 h, `timeout_seconds` ≤ 3300) and the checklist line (§153) are rewritten to: each token ≤ 1 h and refreshed before expiry; `timeout_seconds` ≤ 604800.

## Testing

- contracts: accepts 60 and 604800, rejects 59 and 604801, message mentions days.
- db: migration test that the check allows 604800 and rejects 604801, default is 86400, existing rows are unchanged.
- core: `buildRunJob` deadline for 604800 is 604920 (no clamp); Job mounts the token Secret as a directory and does not put the token in env; adapter seam tests.
- worker (time-skipping test environment): a run longer than 3300 s ends `timed_out` at the limit; `refreshWorkspaceToken` is called every 2700 s with a fake clock and a fake gateway; a failed refresh retries every 60 s and emits `token_refresh_failed`; a `patched` replay of an old history does not break. No network.
- runner image: shell tests that the credential helper and `gh` wrapper read the current file content after it changes, and that no token is printed.
- web: duration field converts units, shows the server error, and the meter and timed-out note show "24 h" style text. Stories for the changed shared component.
- e2e-local: one run with a short limit (the fake adapter with a 90 s token TTL) pushes after a refresh.

## Rollout and PR order

The limit must not rise before the refresh works, or any run over 1 hour would lose its token. Each PR stays near 400 lines and is one concern:

1. Docs: this spec and ADR 0021 (this PR).
2. Token delivery: adapter seam, token Secret and mount, runner credential helper and `gh` wrapper, gateway method. Limits unchanged (3300), so behavior is the same.
3. Refresh loop with `patched`, `refreshWorkspaceToken`, failure handling, worker tests.
4. Limits: contracts constants, migration, `buildRunJob` and workflow clamps removed, UI duration field and formatting, default 24 h, `security.md`, ADR 0010 note and control-plane spec lines updated, ADR 0021 set to Accepted.

## Open points

- Mounted-Secret sync time on the target cluster (k3s today). Measure it in PR 2; the 15 min margin is large, so this is a check and not a risk.
- Whether to cap how many 7-day runs one org may hold at once. Existing `maxConcurrentRuns` applies; no new limit now.

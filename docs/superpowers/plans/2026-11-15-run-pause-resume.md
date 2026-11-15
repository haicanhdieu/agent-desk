# Pause and Resume Idle Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the idle timer stops a run's pod, keep the run's files and conversation on a per-run volume so a person can resume it, and show a status that says what really happened.

**Architecture:** Every run Job mounts its own PersistentVolumeClaim at `/workspace` (repo and home folder). When the idle timer fires, the run workflow deletes the Job and Secret, frees the slot and stays open in a new `parked` phase, where it waits for resume, finish, cancel or a durable expiry timer. Resume re-queues through the project gate and starts a new Job on the same volume with `RUN_MODE=resume`.

**Tech Stack:** TypeScript, Zod contracts, Drizzle/Postgres, Temporal workflows, Kubernetes (k3s, `local-path`), bash runner image, Vite/React/TanStack.

**Spec:** [docs/superpowers/specs/2026-11-15-run-pause-resume-design.md](../specs/2026-11-15-run-pause-resume-design.md). Read it before any task.

## Global Constraints

- Repo rules in `AGENTS.md` apply to every task: contracts first; layering `apps → core → db → contracts`; no provider names outside adapters; every query through `withOrg`; no secrets in Postgres, logs, events or errors; untrusted text never interpolated into shell, k8s specs or SQL; authz on every endpoint; never edit an applied migration; strict TS (no `any`, no unexplained `!` or casts).
- Every behaviour starts with a failing test. No network in tests.
- Before each commit: `devbox run fix` until it prints `fix: clean.` Conventional Commits with the package as scope.
- One PR per phase below, about 400 changed lines each, labelled `review:sensitive` (run Job/runner, secrets, migrations, workflow). Never lower coverage thresholds or baselines.
- Exact values from the spec:
  - New statuses: `paused` (not active, not final), `expired` (final).
  - `pausedKeepSeconds`: default `604800`, range `3600` to `2592000`.
  - `doneKeepSeconds`: default `86400`, range `0` to `604800`; `0` means no session is kept.
  - `RESUME_MIN_SECONDS = 3600`: a resumed pod's time allowance is never less.
  - `RUN_KEPT_DONE_SESSIONS_PER_PROJECT`: default `10`.
  - Storage class name on the cluster: `agentdesk-run-volumes` (`rancher.io/local-path`, `reclaimPolicy: Delete`, `WaitForFirstConsumer`).
  - Resume route: `POST /api/runs/:runId/resume`.
  - Runner: `RUN_MODE=resume`; resume command for Claude Code is `claude --permission-mode bypassPermissions --continue`; exit code `79` when no saved session is found.
- New workflow behaviour is behind `patched('pause-resume')`, evaluated once right after `loadRun`. A run that started before the deploy has no volume and keeps today's behaviour (idle end writes `succeeded`).
- UI labels: `paused` → "Paused", `expired` → "Expired". Buttons: "Resume" (paused run), "Re-open session" (succeeded run with a kept session).

## Review Focus

1. **A person attaches, or the agent starts working, in the same moment the idle timer fires.** Expected: once the session end has begun the run parks; it never ends up `running` with no pod. Pinned in Task 9.
2. **Resume pressed twice, or pressed while a resume is already queued or starting.** Expected: the second call gets a 409 with a plain message; one pod, one slot request. Pinned in Tasks 10 and 12.
3. **The keep time runs out while a resume is queued for a slot.** Expected: the resume wins; the expiry timer is off from the moment a resume is accepted and is re-armed with the original deadline only if the resume falls back. Pinned in Task 10.
4. **The volume is gone or empty at resume** (node wiped, deleted by hand). Expected: the runner exits `79`, the run goes back to its kept state with a "Resume failed: no saved session was found" event, and nothing is retried in a loop. Pinned in Tasks 3 and 10.
5. **A run that started before the deploy reaches its idle timer after the deploy.** Expected: old behaviour (`succeeded`, no volume call, no park). Pinned in Task 9 (replay of `run-idle-finish-history.json`).

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| contracts | `packages/contracts/src/enums.ts`, `schemas/runs.ts`, `schemas/agents.ts`, `schemas/events.ts`, `routes.ts` | Statuses, groups, session fields, keep settings, resume route |
| db | `packages/db/src/schema/app.ts`, `packages/db/migrations/0011_run_pause_resume.sql` | Columns and checks |
| core | `packages/core/src/kube/{gateway,real-gateway,fake-gateway,job-spec}.ts`, `packages/core/src/config.ts`, `packages/core/src/temporal-names.ts` | Volume methods, Job on a volume, config, signal names |
| runner | `images/runner/{Dockerfile,entrypoint.sh}`, `images/runner/agents/claude/commands.sh` | Home on the volume, session marker, resume mode |
| worker | `apps/worker/src/activities/{run-status.activity,session.activity,run.activities,run.activities.impl,reconcile.activity}.ts`, `apps/worker/src/workflows/{signals,agent-phase,park,run.workflow}.ts` | Status rules, park and expiry, resume, cleanup |
| api | `apps/api/src/runs/{runs.controller,runs.service}.ts`, `apps/api/src/agents/agents.service.ts`, `apps/api/src/projects/projects.service.ts`, `apps/api/src/sse/sse.service.ts` | Resume endpoint, filters, settings, delete guard, live updates |
| web | `apps/web/src/ds/{tokens.ts,StatusIcon.tsx,Chips.module.css,StatusBadge.stories.tsx}`, `apps/web/src/features/runs/*`, `apps/web/src/features/desk/agent.form.ts`, routes `o.$org.p.$project.{runs.$run,runs.index,needs-you,desk.agent}.tsx`, `apps/web/src/mocks/*` | Statuses, actions, settings |
| docs | `docs/adr/0022-pause-and-resume-runs-on-a-per-run-volume.md`, notes in ADR 0010 and 0020, `docs/conventions/security.md`, `docs/superpowers/specs/2026-11-12-infra-design.md` §5.4, §6.1, §6.6 | Decision record and corrections |

---

## Phase 0: Spike (no PR)

### Task 0: Prove that the agent's resume command works in a new container

Throwaway. Nothing from this task is committed except the result line in the spec.

**Files:**
- Create (scratch, not committed): a script in the session scratchpad
- Modify: `docs/superpowers/specs/2026-11-15-run-pause-resume-design.md` (the "`--continue` is unproven here" bullet)

- [ ] **Step 1: Build the current runner image locally** (see `docs/runbooks/local-dev.md` for the image name and build command).
- [ ] **Step 2: Start container A** with a host folder mounted at `/workspace`, `HOME=/workspace/home`, a real agent credential from your local `.env`, and a tiny test repo. Start `claude --permission-mode bypassPermissions "Reply with the word PINEAPPLE and then ask me one question."` inside tmux, as the entrypoint does. Wait for the turn to end.
- [ ] **Step 3: Kill the tmux session** (`tmux kill-session -t agent`), then remove container A.
- [ ] **Step 4: Start container B** on the same host folder and `HOME`, run `claude --permission-mode bypassPermissions --continue` in `/workspace/repo` inside tmux, capture the pane.
- [ ] **Step 5: Check three things.** The pane shows the earlier conversation (PINEAPPLE and the question). Typing an answer produces a new turn. The pod's stdout shows `agentdesk: state …` lines for the new turn (hooks still fire).
- [ ] **Step 6: Record the result.** Replace the spec bullet with one line: the Claude Code version tested, the date, and "confirmed" or what failed. Commit as `docs(specs): record the resume spike result`.

**Stop rule:** if any of the three checks fails, stop and report to the human. Do not start Phase A.

---

## Phase A: Contracts and database (PR 1)

### Task 1: Statuses, session fields, keep settings and the resume route

**Files:**
- Modify: `packages/contracts/src/enums.ts`, `packages/contracts/src/schemas/runs.ts`, `packages/contracts/src/schemas/agents.ts`, `packages/contracts/src/schemas/events.ts`, `packages/contracts/src/routes.ts`
- Create: `packages/contracts/src/schemas/session.ts`, `packages/contracts/src/schemas/session.test.ts`
- Modify (compile fixes only, no behaviour): `apps/web/src/ds/tokens.ts`, `apps/web/src/mocks/*` DTO builders, `apps/api/src/runs/runs.service.ts` and `apps/api/src/agents/agents.service.ts` row mappers
- Create: `docs/adr/0022-pause-and-resume-runs-on-a-per-run-volume.md`; add amendment notes to ADR 0010 and 0020

**Interfaces — Produces:**
- `RunStatus` gains `'paused'` and `'expired'`. `FINAL_RUN_STATUSES` gains `'expired'`. `ACTIVE_RUN_STATUSES` unchanged. `FINISHABLE_RUN_STATUSES` becomes `['idle', 'done', 'paused']`.
- `RunDto`, `RunStatusEvent` gain `pausedAt: Timestamp.nullable()` and `sessionExpiresAt: Timestamp.nullable()`.
- `session.ts`:
  - `hasKeptSession(run: { sessionExpiresAt: string | null }, now: Date): boolean`
  - `canResume(run: { status: RunStatus; sessionExpiresAt: string | null }, now: Date): boolean` (true for `paused`, and for `succeeded` with a kept session)
  - `isSettled(run: { status: RunStatus; sessionExpiresAt: string | null }, now: Date): boolean` (final and no kept session: the run can never change again)
- `agents.ts`: `AGENT_PAUSED_KEEP_SECONDS_MIN/MAX/DEFAULT = 3600/2592000/604800`, `AGENT_DONE_KEEP_SECONDS_MIN/MAX/DEFAULT = 0/604800/86400`. `AgentDto` gains `pausedKeepSeconds`, `doneKeepSeconds` (ints). `PutAgentRequest` gains both as optional (absent keeps the stored value), messages "A paused run must be kept between 1 hour and 30 days" and "A finished run's session can be kept for at most 7 days".
- `routes.runs.resume = { method: 'POST', path: '/api/runs/:runId/resume', params: runParams, response: empty }`.

- [ ] **Step 1: Write failing tests** in `session.test.ts` and extend `agent-state.test.ts`:

```ts
expect(RunStatus.parse('paused')).toBe('paused');
expect(FINAL_RUN_STATUSES).toContain('expired');
expect(ACTIVE_RUN_STATUSES).not.toContain('paused');
expect(FINISHABLE_RUN_STATUSES).toEqual(['idle', 'done', 'paused']);
const now = new Date('2026-11-15T12:00:00Z');
const later = '2026-11-16T12:00:00.000Z';
const earlier = '2026-11-15T11:59:59.000Z';
expect(canResume({ status: 'paused', sessionExpiresAt: later }, now)).toBe(true);
expect(canResume({ status: 'succeeded', sessionExpiresAt: later }, now)).toBe(true);
expect(canResume({ status: 'succeeded', sessionExpiresAt: null }, now)).toBe(false);
expect(canResume({ status: 'succeeded', sessionExpiresAt: earlier }, now)).toBe(false);
expect(canResume({ status: 'failed', sessionExpiresAt: later }, now)).toBe(false);
expect(isSettled({ status: 'succeeded', sessionExpiresAt: later }, now)).toBe(false);
expect(isSettled({ status: 'expired', sessionExpiresAt: null }, now)).toBe(true);
expect(isSettled({ status: 'paused', sessionExpiresAt: later }, now)).toBe(false);
expect(PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60, pausedKeepSeconds: 3599 }).success).toBe(false);
expect(PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60, doneKeepSeconds: 0 }).success).toBe(true);
expect(PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60 }).success).toBe(true);
```

- [ ] **Step 2: Run** `pnpm --filter @agentdesk/contracts test` — expect FAIL.
- [ ] **Step 3: Implement** the items under Produces. Export `session.ts` from the package index.
- [ ] **Step 4: Make the repo compile.** Add `paused` (label "Paused", colour `--idle`) and `expired` (label "Expired", colour `--off`) to `statusTokens`; return `null` for the two new run fields and the defaults for the two agent fields in the API mappers; add the fields to web mock builders. No other behaviour.
- [ ] **Step 5: Write ADR 0022** from the spec (Context, Decision, Alternatives table from the spec's Approaches, Consequences from "Limits and risks"), and add a one-line "Amended by 0022" note to ADR 0010 and ADR 0020.
- [ ] **Step 6: Run** `pnpm --filter @agentdesk/contracts test && pnpm typecheck` — expect PASS.
- [ ] **Step 7: Commit** `feat(contracts): paused and expired run statuses, kept sessions, resume route`.

### Task 2: Columns and checks

**Files:**
- Create: `packages/db/migrations/0011_run_pause_resume.sql` (generate with the repo's Drizzle command, see `docs/conventions/database.md`)
- Modify: `packages/db/src/schema/app.ts`
- Test: the existing migration test file in `packages/db` (follow the `0010` guard test)
- Modify: `apps/api/src/runs/runs.service.ts`, `apps/api/src/agents/agents.service.ts` (read and write the real columns)

**Interfaces — Produces:**
- `runs.pausedAt` (`paused_at`), `runs.sessionExpiresAt` (`session_expires_at`), both nullable timestamps.
- `agents.pausedKeepSeconds` (`paused_keep_seconds`, not null, default 604800), `agents.doneKeepSeconds` (`done_keep_seconds`, not null, default 86400).
- Checks: `runs_status_check` re-created with `'paused','expired'` added; `agents_paused_keep_check` (`between 3600 and 2592000`); `agents_done_keep_check` (`between 0 and 604800`).
- Index `runs_project_session_idx` on `(project_id, session_expires_at)`.

- [ ] **Step 1: Write failing tests:** the migration applies on a database at `0010`; a row with status `paused` inserts; `paused_keep_seconds = 3599` is rejected; existing agent rows get `604800` and `86400`; the migration file contains no `update`, `delete` or `insert` on `runs`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/db test` — expect FAIL.
- [ ] **Step 3: Implement** the schema change and generate the migration. Comment in the schema that the literals mirror the contracts constants (db cannot import contracts).
- [ ] **Step 4: Wire the API mappers** to the new columns; `PUT` agent writes the two fields when present. Extend `apps/api/test/agents.int.test.ts`: saving `pausedKeepSeconds: 86400` round-trips; omitting it keeps the stored value.
- [ ] **Step 5: Run** `pnpm --filter @agentdesk/db test && pnpm --filter @agentdesk/api test` — expect PASS.
- [ ] **Step 6: Commit** `feat(db): session columns on runs and keep settings on agents`.

---

## Phase B: Runner and Job on a volume (PR 2)

### Task 3: Runner: home on the volume, session marker, resume mode

**Files:**
- Modify: `images/runner/Dockerfile`, `images/runner/entrypoint.sh`
- Create: `images/runner/agents/claude/commands.sh`
- Test: `images/runner/test/entrypoint.test.ts`, `images/runner/test/dockerfile.test.ts`

**Interfaces — Produces:**
- Image: baked home content is copied to `/usr/local/share/agentdesk/home-skel/` (same files as `/home/runner` has today). `/home/runner` stays as is for setup-test pods.
- Entrypoint, every mode: `mkdir -p "$HOME"`, then copy the skeleton into `$HOME` without overwriting existing files. Test seam env `AGENTDESK_HOME_SKEL` (like `AGENTDESK_LIB_DIR`).
- Marker file `"$HOME/.agentdesk/session-started"`, written right after the tmux session is created in normal mode.
- `agents/claude/commands.sh` defines two shell variables used as the tmux command: `AGENT_START_CMD='exec claude --permission-mode bypassPermissions "$PROMPT"'` and `AGENT_RESUME_CMD='exec claude --permission-mode bypassPermissions --continue'`. The entrypoint sources the file for the agent named by env `AGENT` (default `claude`; the name is matched against a fixed list, never used as a path from untrusted input).
- `RUN_MODE=resume`: skips clone, checkout, plugins and setup; registers the git credential helper as today; `cd "$REPO_DIR"`; if the marker or `$REPO_DIR/.git` is missing prints `agentdesk: resume failed (no saved session)` and exits `79`; otherwise prints `agentdesk: session resumed`, starts tmux with `AGENT_RESUME_CMD`, prints `agentdesk: session started`, and continues with the existing wait and final-scrollback code.

- [ ] **Step 1: Write failing tests** (use the existing harness and stubs):
  - normal mode: after start, the marker exists and `$HOME/.claude/settings.json` equals the skeleton's;
  - a file already in `$HOME` is not overwritten by the skeleton copy;
  - `RUN_MODE=resume` with marker and repo: stdout has `agentdesk: session resumed` then `agentdesk: session started`; the `git` stub was not called with `clone`; the `claude` stub got `--continue` and no prompt argument; no `plugins begin` or `setup begin` line;
  - `RUN_MODE=resume` without the marker: exit code `79`, stdout has `agentdesk: resume failed (no saved session)`, tmux stub not started;
  - `RUN_MODE=resume` with `SETUP_SCRIPT` set: the script is not run;
  - Dockerfile test: the skeleton folder is copied and owned by `10001`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/runner test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/runner test` — expect PASS.
- [ ] **Step 5: Commit** `feat(runner): keep home on the workspace volume and add resume mode`.

### Task 4: KubeGateway volume methods

**Files:**
- Modify: `packages/core/src/kube/gateway.ts`, `real-gateway.ts`, `fake-gateway.ts`, `packages/core/src/config.ts`
- Test: `packages/core/test/kube/real-gateway.test.ts`, `fake-gateway.test.ts`

**Interfaces — Produces** (on `KubeGateway`):

```ts
export interface RunVolumeRef { name: string; runId: string; orgId: string; projectId: string }
ensureVolumeClaim(name: string, spec: { size: string; storageClass?: string }, labels: Record<string, string>): Promise<void>; // already exists → success
deleteVolumeClaim(name: string): Promise<void>; // missing → success
listRunVolumeClaims(): Promise<RunVolumeRef[]>; // claims carrying the run labels
export const runVolumeName = (runId: string): string => `run-${runId}`;
```

- Claim spec: `accessModes: ['ReadWriteOnce']`, `resources.requests.storage = size`, `storageClassName` only when given.
- Config: `RUN_VOLUME_STORAGE_CLASS` (optional string, blank means unset), `RUN_KEPT_DONE_SESSIONS_PER_PROJECT` (int, min 0, default 10).

- [ ] **Step 1: Write failing tests:** ensure twice succeeds and creates one claim with the labels and size; delete of a missing claim succeeds; list returns only claims with run labels and maps them with `runRefFromLabels`; with `storageClass` unset the body has no `storageClassName`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/core test:unit` — expect FAIL.
- [ ] **Step 3: Implement** in the real and fake gateways, following the Secret methods' error handling (`kubeStatusOf`, 404 and 409).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(core): volume claim methods on KubeGateway`.

### Task 5: Run Job on the volume, with a resume variant

**Files:**
- Modify: `packages/core/src/kube/job-spec.ts`
- Test: `packages/core/test/kube/job-spec.test.ts`
- Modify: `docs/conventions/security.md` (workspace is a per-run volume), `docs/superpowers/specs/2026-11-12-infra-design.md` §5.4, §6.1, §6.6

**Interfaces — Produces:**
- `RunJobInput` gains `resume: boolean` and `deadlineSeconds: number` (replaces the use of `timeoutSeconds` for `activeDeadlineSeconds`; still `+ 120`).
- `buildRunJob`: the `workspace` volume is `{ persistentVolumeClaim: { claimName: runVolumeName(runId) } }`, mounted at `/workspace`; env adds `{ name: 'HOME', value: '/workspace/home' }`; when `resume` is true env has `RUN_MODE=resume` and omits `PROMPT`, `CHECKOUT_REF`, `SETUP_SCRIPT`, `PLUGIN_MARKETPLACES`.
- `buildSetupTestJob` is unchanged (still `emptyDir`, no `HOME` override). `podJob` takes `workspaceClaim?: string` to choose.

- [ ] **Step 1: Write failing tests:** run Job has a claim volume named `run-<id>` and no `emptyDir`; has `HOME=/workspace/home`; `resume: true` has `RUN_MODE=resume` and no `PROMPT` or `SETUP_SCRIPT` env; `activeDeadlineSeconds` is `deadlineSeconds + 120`; setup-test Job still has the `emptyDir` with the size limit and no `HOME` env; no mount uses `subPath`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/core test:unit` — expect FAIL.
- [ ] **Step 3: Implement.** Update the one caller in `apps/worker/src/activities/run.activities.impl.ts` to pass `resume: false` and `deadlineSeconds: ctx.timeoutSeconds`, and to call `ensureVolumeClaim(runVolumeName(runId), { size: RUN_POD_WORKSPACE_SIZE_LIMIT, storageClass }, runLabels(...))` before the Job. `deleteJob` and `ensureJobGone` keep deleting only the Job and Secret.
- [ ] **Step 4: Add a temporary volume delete to `finalize`'s cleanup path** so this PR does not leak volumes: after the Job is gone, call a new activity `deleteRunVolume(ctx): Promise<void>` (deletes the claim; missing → success). Guard the new call with `patched('run-volume')`, so a run that was already in `finalize` when the worker restarted replays unchanged; add the existing replay fixtures to the check. Extend `run.activities.int.test.ts`: after a run ends, the fake gateway has no claim for it.
- [ ] **Step 5: Update the docs** listed above: storage class `agentdesk-run-volumes`, the worker Role gains `persistentvolumeclaims` (create, get, list, delete), run pods use a per-run volume, deploy order (class and Role before the worker).
- [ ] **Step 6: Run** `pnpm --filter @agentdesk/core test && pnpm --filter @agentdesk/worker test` — expect PASS. Then `devbox run e2e-local` and confirm a run starts, the agent can write in `/workspace/repo` and `$HOME`, and the claim is gone after the run ends.
- [ ] **Step 7: Commit** `feat(core): run Jobs use a per-run volume`.

---

## Phase C: Worker (PR 3, may be split in two at Task 9 if over size)

### Task 6: Status writer rules for kept sessions

**Files:**
- Modify: `apps/worker/src/activities/run-status.activity.ts`
- Test: `apps/worker/test/run-status.test.ts`, `run-status.activity.int.test.ts`

**Interfaces — Produces** (new optional fields on `SetRunStatusInput`):

```ts
/** Set or clear the kept session. `{ expiresAt }` sets session_expires_at and paused_at = at; `null` clears session_expires_at. Absent leaves both alone. */
session?: { expiresAt: string } | null;
/** Leave agent_note as it is (used for paused, and for the statuses of a resume). */
keepAgentNote?: boolean;
/** Allow leaving `succeeded` when the row has session_expires_at in the future at `at` (re-open). */
reopen?: boolean;
```

Rules: `paused` behaves like a parked status for `idleSince` (kept as is, not reset). A transition out of a final status stays a no-op, except `succeeded → queued` with `reopen: true` and a kept session; that write clears `finishedAt` and `exitCode`. A final status other than `succeeded` clears `sessionExpiresAt`. The status event payload gains `pausedAt` and `sessionExpiresAt`.

- [ ] **Step 1: Write failing tests:**
  - `idle → paused` with `session: { expiresAt }` and `keepAgentNote`: row has status `paused`, the note unchanged, `pausedAt = at`, `sessionExpiresAt` set;
  - `done → succeeded` with `session`: `finishedAt` set, note kept, `sessionExpiresAt` set;
  - `succeeded → queued` with `reopen` and a future expiry: `changed: true`, `finishedAt` null;
  - `succeeded → queued` with `reopen` and a past or null expiry: `changed: false`;
  - `failed → queued` with `reopen`: `changed: false`;
  - `paused → expired`: `sessionExpiresAt` null, `finishedAt` set;
  - `paused → cancelled`: `sessionExpiresAt` null.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): status writer understands kept sessions`.

### Task 7: Session activities

**Files:**
- Create: `apps/worker/src/activities/session.activity.ts`
- Modify: `apps/worker/src/activities/run.activities.ts` (interface), `run.activities.impl.ts`, `follow-core.ts`, `packages/core/src/temporal-names.ts`
- Test: `apps/worker/test/session.activity.int.test.ts` (new), `run.activities.int.test.ts`, `follow-core.test.ts`, `activities-wiring.test.ts`

**Interfaces — Produces** (added to `RunActivities`):

```ts
export type ParkKind = 'needs_input' | 'done';
export interface ParkResult { status: 'paused' | 'succeeded'; /** null: nothing kept (doneKeepSeconds = 0). */ sessionExpiresAt: string | null }
/** Reads the agent's keep setting (defaults when the agent row is gone), writes the parked status and session in one
 *  transaction, and for kind `done` applies the per-project cap by signalling `dropSession` to the oldest kept ones. */
parkRun(ctx: RunContext, input: { kind: ParkKind; at: string }): Promise<ParkResult>;
/** `expired`: paused → status expired; succeeded → clears session_expires_at and notifies. `dropped`: same for succeeded; a paused run is never dropped. */
endKeptSession(ctx: RunContext, reason: 'expired' | 'dropped', at: string): Promise<void>;
/** Puts a run whose resume failed back: status `paused` or `succeeded` with the same expiry, plus a `lifecycle` event `resume_failed` with a redacted one-line reason. */
restoreParked(ctx: RunContext, input: { kind: ParkKind; sessionExpiresAt: string; reason: string; at: string }): Promise<void>;
deleteRunVolume(ctx: RunContext): Promise<void>; // from Task 5
createRunSecretAndJob(ctx: RunContext, opts?: { resume?: boolean; deadlineSeconds?: number }): Promise<TokenRefreshPlan | undefined>;
followPodLogs(ctx: RunContext, opts?: { resume?: boolean }): Promise<FollowPodLogsResult>;
```

- `CommentKind` gains `'paused'` (idempotent through `runs.outbox.paused`, so it posts once per run).
- `SIGNAL.sessionStarted = 'sessionStarted'`, `SIGNAL.dropSession = 'dropSession'`, `UPDATE.resumeRun = 'resumeRun'` in `temporal-names.ts`.
- `followPodLogs`: sends the `sessionStarted` signal to the run workflow when it stores `session_started`. With `resume: true` it does not write `running` on the first log line, reports `failureStage: undefined` and a new result field `resumeFailed?: true` when the pod exited `79` before `session_started`, and the stored `session_started` check looks only at events after the resume began.
- With `createRunSecretAndJob(..., { resume: true })` the agent and credential are read fresh from the database; a missing agent or credential fails non-retryably with type `NoAgentCredential`.

- [ ] **Step 1: Write failing tests:**
  - `parkRun` `needs_input`: status `paused`, expiry = `at` + the agent's `pausedKeepSeconds`;
  - `parkRun` `done` with `doneKeepSeconds = 0`: status `succeeded`, `sessionExpiresAt: null`;
  - `parkRun` `done` with 10 kept sessions already in the project and the cap at 10: the oldest kept run's workflow receives `dropSession` (fake Temporal client), paused runs are not counted and not signalled;
  - `parkRun` with the agent row deleted: uses `604800` and `86400`;
  - `endKeptSession('expired')` on a paused run: status `expired`; on a succeeded run: status stays `succeeded`, `sessionExpiresAt` null;
  - `endKeptSession('dropped')` on a paused run: nothing changes;
  - `restoreParked`: status and expiry restored, a `resume_failed` event stored, the reason redacted and capped;
  - `followPodLogs` with `resume: true`: no `running` write on the first line; `sessionStarted` signal sent; exit `79` gives `resumeFailed: true`;
  - comment kind `paused` posts once across two calls.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test` — expect FAIL.
- [ ] **Step 3: Implement.** All queries under `withOrg`. `parkRun`'s cap query: succeeded runs of the project with `session_expires_at > at`, ordered by `session_expires_at`, skipping the newest `cap - 1`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): activities for parking, expiring and resuming a session`.

### Task 8: Pure decisions for the parked phase

**Files:**
- Modify: `apps/worker/src/workflows/signals.ts`
- Create: `apps/worker/src/workflows/park.ts`
- Test: `apps/worker/test/park.test.ts`; the existing test that asserts workflow signal names equal `@agentdesk/core`'s

**Interfaces — Produces:**
- `signals.ts`: `RunPhase` gains `'parked'` and `'resuming'`; `sessionStarted = defineSignal<[]>('sessionStarted')`; `dropSession = defineSignal<[]>('dropSession')`; `resumeRun = defineUpdate<{ accepted: true }>('resumeRun')`.
- `park.ts` (workflow-safe, type imports only):

```ts
export const RESUME_MIN_SECONDS = 3600;
export type ParkKind = 'needs_input' | 'done';
export const parkKindOf = (phase: RunPhase): ParkKind | undefined; // 'idle' → 'needs_input', 'agent_done' → 'done', else undefined
export const phaseOfParkKind = (kind: ParkKind): 'idle' | 'agent_done';
export const statusOfParkKind = (kind: ParkKind): 'idle' | 'done';
/** Seconds the next pod may run: the unused part of the limit, never less than RESUME_MIN_SECONDS on a resume. */
export function sessionAllowanceSeconds(limitSeconds: number, usedSeconds: number, isResume: boolean): number;
/** Why a resume is refused, or undefined when allowed. Allowed only in phase 'parked'. */
export function resumeRejection(phase: RunPhase): string | undefined; // 'resuming' → 'This run is already being resumed'; other → 'Only a paused run, or a finished run whose session is still kept, can be resumed'
/** What a cancel does in this phase. */
export function cancelEffect(phase: RunPhase, kind: ParkKind | undefined, sessionUp: boolean): 'stop_run' | 'abort_resume' | 'ignore';
```

`cancelEffect`: `resuming` with `sessionUp` false → `abort_resume`; `parked` with kind `done` → `ignore` (the run already succeeded); everything else → `stop_run`. Also extend `finishRunRejection` in `agent-phase.ts`: `parked` is finishable when the kind is `needs_input`, and rejected for kind `done` with "This run already finished".

- [ ] **Step 1: Write failing tests** covering each line above, including `sessionAllowanceSeconds(86400, 86280, true) === 3600`, `sessionAllowanceSeconds(86400, 3600, true) === 82800`, `sessionAllowanceSeconds(86400, 0, false) === 86400`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test:unit` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): parked-phase decisions`.

### Task 9: Workflow: park instead of ending, and expire

**Files:**
- Modify: `apps/worker/src/workflows/run.workflow.ts`
- Test: `apps/worker/test/run.workflow.test.ts`; new fixture `apps/worker/test/fixtures/run-park-expire-history.json`

**Interfaces — Consumes:** Tasks 6 to 8. **Produces:** `RunOutcome.status` may be `'expired'`; local `FinalStatus` and `FINAL` gain `'expired'`.

Behaviour (only when `patched('pause-resume')` is true; otherwise the code path is exactly today's):

1. When the idle timer fires, record `parkKind = parkKindOf(phase)` before setting `ending`, then end the session as today.
2. After the logs end with `ending` true and `parkKind` set and no `finishRequested`: cancel the hard timer and add the elapsed seconds of this pod to `usedSeconds`; `ensureJobGone`; release the slot (`slotRequested = false`); `parkRun`; for `needs_input` post the `paused` comment, for `done` post the normal finish comment; set `phase = 'parked'`.
3. If `parkRun` returned `sessionExpiresAt: null`: delete the volume and return the workflow result `succeeded` without calling `finalize` (status and comment are already written).
4. While parked, wait for the first of: the `resumeRun` update (Task 10), a `finishRun` update (kind `needs_input` only → delete the volume, write `succeeded` with `session: null`, post the finish comment, close), a cancel (`cancelEffect`: `stop_run` → `finalize` with `cancelled`; `ignore` → nothing), `dropSession` (kind `done` only), or a durable timer until `sessionExpiresAt`.
5. On expiry or drop: `endKeptSession`, `deleteRunVolume`, and for kind `needs_input` post the finish comment with status `expired`. Result status: `expired` or `succeeded`.
6. `finalize` (cancel, failure, hard timeout, person Finish, agent exit) always calls `deleteRunVolume` after the Job is gone, and writes its final status with `session: null`.
7. The terminal `attached` counter is reset to 0 when the pod is gone.

- [ ] **Step 1: Write failing workflow tests** (Temporal test environment with mocked activities, like the existing ones):
  - idle, nobody attached, idle time passes → activities called in order `endSession`, `ensureJobGone`, `parkRun({ kind: 'needs_input' })`, `postComment('paused')`; the gate received `releaseSlot`; `state` query phase is `parked`; `deleteRunVolume` not called;
  - done → `parkRun({ kind: 'done' })`, `postComment('finish')` with status `succeeded`, phase `parked`;
  - parked `needs_input`, time skips past the expiry → `endKeptSession('expired')`, `deleteRunVolume`, finish comment with `expired`, workflow result `{ status: 'expired' }`;
  - parked `done`, time skips past the expiry → `endKeptSession('expired')`, `deleteRunVolume`, no second comment, result `{ status: 'succeeded' }`;
  - parked `done`, `dropSession` signal → same as expiry with reason `dropped`;
  - parked `needs_input`, `dropSession` signal → ignored, still `parked`;
  - parked `needs_input`, `finishRun` update → accepted, `deleteRunVolume`, final status `succeeded`;
  - parked `done`, `finishRun` update → rejected `NotFinishable`;
  - parked `needs_input`, `cancel` signal → final status `cancelled`, `deleteRunVolume` called;
  - parked `done`, `cancel` signal → still `parked`, status untouched;
  - `parkRun` returns `sessionExpiresAt: null` → `deleteRunVolume`, workflow closes with `succeeded`;
  - **Review Focus 1:** `terminalAttached` and an `agentState('working')` signal delivered after `endSession` started and before the logs end → the run still parks and no `running` status is written after the park;
  - a person presses Finish on a live idle run → final `succeeded`, `deleteRunVolume` called, `parkRun` not called;
  - **Review Focus 5:** `run-idle-finish-history.json`, `run-success-history.json`, `run-cancel-*.json` and `run-token-refresh-history.json` replay without a non-determinism error; a test that runs the idle timer with the patch reported as absent sees `succeeded` and no `parkRun` call.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test` — expect FAIL.
- [ ] **Step 3: Implement.** Keep `run.workflow.ts` as Temporal glue; put any new pure decision in `park.ts` with a unit test.
- [ ] **Step 4: Record the new replay fixture** from a park-then-expire run and add it to the replay test.
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** `feat(worker): park idle and done runs and expire kept sessions`.

### Task 10: Workflow: resume, fallback and the time limit

**Files:**
- Modify: `apps/worker/src/workflows/run.workflow.ts`
- Test: `apps/worker/test/run.workflow.test.ts`; new fixture `run-park-resume-history.json`

**Interfaces — Consumes:** `resumeRun`, `sessionStarted`, `sessionAllowanceSeconds`, `resumeRejection`, `cancelEffect`, `restoreParked`, `createRunSecretAndJob(c, { resume, deadlineSeconds })`, `followPodLogs(c, { resume })`.

Behaviour:

1. `resumeRun` update: the validator throws `ApplicationFailure.nonRetryable(resumeRejection(phase), 'NotResumable')` when rejected. The handler sets `phase = 'resuming'`, turns the expiry timer off, and returns `{ accepted: true }` at once (the API does not wait for the pod).
2. The resume attempt runs in its own cancellation scope: write `queued` (`reopen: true`, `keepAgentNote: true`); request a slot and wait for `granted`; write `starting`; `createRunSecretAndJob(c, { resume: true, deadlineSeconds: allowance })` where `allowance = sessionAllowanceSeconds(c.timeoutSeconds, usedSeconds, true)`; start the hard timer for `allowance`; start `followPodLogs(c, { resume: true })` and the token refresh loop.
3. When `sessionStarted` arrives: `sessionUp = true`; `phase = phaseOfParkKind(kind)`; write `statusOfParkKind(kind)` with `keepAgentNote: true` and `session: null`; then the normal main loop runs (idle timer included, so an unattended resumed run parks again with a fresh keep time).
4. Fallback: if the attempt fails or the pod exits before `sessionStarted` (activity failure, `PodPendingTimeout`, `resumeFailed`, `NoAgentCredential`), or a cancel arrives with `cancelEffect` = `abort_resume`: delete the Job and Secret, release the slot, cancel the hard timer without adding to `usedSeconds`, call `restoreParked` with the original `sessionExpiresAt` and a plain reason (`no saved session was found`, `the pod could not start`, `the agent or its credential is missing`, `the resume was cancelled`), set `phase = 'parked'` and re-arm the expiry timer for the original deadline. If that deadline has already passed, expire at once.
5. After `sessionUp`, everything ends by the normal rules through `finalize`. A second `succeeded` for a run whose finish comment was already posted does not post again (the outbox key already exists).

- [ ] **Step 1: Write failing workflow tests:**
  - parked `needs_input` → `resumeRun` → statuses written in order `queued`, `starting`, then `idle` after `sessionStarted`; the gate got `requestSlot`; `createRunSecretAndJob` called with `{ resume: true, deadlineSeconds }`; `followPodLogs` called with `{ resume: true }`;
  - parked `done` → `resumeRun` → ends in `done` (not `idle`), and the `queued` write carries `reopen: true`;
  - a resumed run left unattended for the idle time parks again and `parkRun` is called a second time;
  - **Review Focus 2:** a second `resumeRun` while `resuming` is rejected with type `NotResumable` and message "This run is already being resumed"; `requestSlot` called once;
  - **Review Focus 3:** `resumeRun` accepted, the slot is not granted, time skips past the original expiry → `endKeptSession` not called; then `granted` arrives and the resume completes;
  - **Review Focus 4:** `followPodLogs` returns `{ exitCode: 79, resumeFailed: true }` → `restoreParked` called with reason `no saved session was found` and the original expiry; phase `parked`; `deleteJob` called; slot released; `deleteRunVolume` not called;
  - `createRunSecretAndJob` fails with `NoAgentCredential` → `restoreParked` with `the agent or its credential is missing`;
  - `cancel` while `resuming` before `sessionStarted` → `restoreParked` with `the resume was cancelled`, status not `cancelled`;
  - `cancel` after `sessionStarted` → final `cancelled`, volume deleted;
  - fallback after the original expiry has passed → `restoreParked` then expiry runs at once;
  - time limit: limit 86400, first pod ran 86280 s, resume → `deadlineSeconds` is `3600`; first pod ran 3600 s → `82800`; time spent parked is not counted;
  - the hard timer fires in a resumed pod → final `timed_out` (or `succeeded` when the phase was `agent_done`, as today), volume deleted.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Record the replay fixture** `run-park-resume-history.json` and add it to the replay test.
- [ ] **Step 5: Run** `pnpm --filter @agentdesk/worker test` — expect PASS.
- [ ] **Step 6: Commit** `feat(worker): resume a parked run on its volume`.

### Task 11: Reconcile learns about volumes

**Files:**
- Modify: `apps/worker/src/activities/reconcile.activity.ts`
- Test: `apps/worker/test/reconcile.test.ts`, `reconcile.int.test.ts`

**Interfaces — Produces:** `ReconcileResult` gains `deletedVolumes: number` and `expiredRuns: number`. Constant `SESSION_EXPIRY_GRACE_SECONDS = 3600`.

Rules, added after the existing ones, per org under `withOrg`:
- A volume is deleted when its run is missing; or `isSettled(run, now)`; or the run has `sessionExpiresAt` older than `now - 3600 s`; or the run's workflow is closed.
- A run with status `paused` whose workflow is closed is written as `expired` (through `setRunStatusTx`, `session: null`) and its volume deleted.
- A `succeeded` run with a kept session whose workflow is closed gets `sessionExpiresAt` cleared.
- Existing Job and Secret rules must not treat a run with a kept session as leaked: such a run legitimately has a volume and no Job or Secret. The existing rule "a Secret whose Job is gone while the run is past `starting`" stays (a parked run has no Secret).

- [ ] **Step 1: Write failing tests,** one per rule above, plus: a volume of a `paused` run with an open workflow and a future expiry is kept; a volume of a `running` run is kept; a failure deleting one volume is logged (error name only) and the next one is still processed.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): reconcile cleans up run volumes`.

---

## Phase D: API (PR 4)

### Task 12: Resume endpoint and the places that assumed "final never changes"

**Files:**
- Modify: `apps/api/src/runs/runs.controller.ts`, `runs.service.ts`, `apps/api/src/projects/projects.service.ts`, `apps/api/src/sse/sse.service.ts`
- Test: `apps/api/test/runs.int.test.ts`, `projects.int.test.ts`, `sse.int.test.ts`

**Interfaces — Consumes:** `routes.runs.resume`, `canResume`, `isSettled`, `UPDATE.resumeRun`, `SIGNAL.dropSession`.

Behaviour:
- `RunsService.resume(org, runId)`: load the run under `withOrg` (404 when it is not in the caller's org, same as finish); 409 "Only a paused run, or a finished run whose session is still kept, can be resumed" unless `canResume`; 409 "This project has no agent credential, so the run cannot be resumed" when the project's agent or its credential is missing; then `executeUpdate(UPDATE.resumeRun)`; map `NotResumable`, `WorkflowNotFoundError` and `AcceptedUpdateCompletedWorkflow` to 409 like `finish` does. The controller method mirrors `finish` (same guards and decorators).
- `finish`: unchanged code path; it now also accepts `paused` through `FINISHABLE_RUN_STATUSES`.
- `cancel`: a `succeeded` run with a kept session stays a 409 "Run already succeeded".
- List filters: `needs_you` → status in (`idle`, `paused`); `ended` → final statuses (now including `expired`); `active` unchanged.
- Project delete: `LIVE_STATUSES` gains `'paused'`. Before deleting, signal `dropSession` to the workflow of every `succeeded` run of the project with a kept session (ignore `WorkflowNotFoundError`).
- SSE: the run stream is closed only when `isSettled`; the guard that drops a frame going from a final status to a non-final one lets `succeeded → queued` through; the re-send query after a reconnect also includes runs with `session_expires_at` in the future.
- Terminal attach is unchanged: no pod means refused.

- [ ] **Step 1: Write failing integration tests:**
  - resume a `paused` run → 204 and the fake Temporal client saw the `resumeRun` update;
  - resume a `succeeded` run with a kept session → 204; with an expired or null session → 409;
  - resume a `running` run → 409; resume a run of another org → 404; resume without a session → 401 (authz);
  - **Review Focus 2:** the workflow answers `NotResumable` → 409 with the workflow's message;
  - resume when the agent credential was removed → 409 with the message above and no update sent;
  - finish a `paused` run → 204;
  - list `needs_you` returns idle and paused runs; `ended` returns an expired run;
  - deleting a project with a `paused` run → 409; with only a `succeeded` kept-session run → deleted, and `dropSession` was signalled;
  - SSE: a stream on a `succeeded` kept-session run stays open and delivers a later `queued` frame; a stream on an `expired` run ends.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/api test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(api): resume endpoint and kept-session handling`.

---

## Phase E: Web (PR 5)

### Task 13: Keep-time settings in Desk → Agent

**Files:**
- Modify: `apps/web/src/features/desk/agent.form.ts`, `map.ts`, `mutations.ts`, `apps/web/src/app/routes/o.$org.p.$project.desk.agent.tsx`, `apps/web/src/mocks/agent.ts`
- Test: `apps/web/src/features/desk/agent.form.test.ts`, `agent.route.test.tsx`, `map.test.ts`

Two `DurationInput` fields under "Run time limit":
- "Keep a paused run for" — help text "After this, a paused run expires and its saved session is deleted." Default 7 days.
- "Keep a finished run's session for" — help text "How long a finished run can be re-opened. 0 turns this off." Default 1 day.

The form model stays in minutes like the time limit (`splitMinutes`, `minutesIn`). Validation messages are the contract's.

- [ ] **Step 1: Write failing tests:** the form loads `604800` as "7 days" and `86400` as "1 day"; saving "3 days" sends `pausedKeepSeconds: 259200`; "0" for the finished field sends `doneKeepSeconds: 0`; 31 days shows "A paused run must be kept between 1 hour and 30 days" and does not submit.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/web test` — expect FAIL.
- [ ] **Step 3: Implement.** Design tokens only; loading and error states follow the existing fields.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(web): keep-time settings for paused and finished runs`.

### Task 14: Paused and Expired in the UI, Resume and Re-open

**Files:**
- Modify: `apps/web/src/ds/tokens.ts`, `StatusIcon.tsx`, `Chips.module.css`, `StatusBadge.stories.tsx`, `StatusBadge.test.tsx`, `tokens.test.ts`
- Modify: `apps/web/src/features/runs/{map,detail.map,mutations,applyEvents}.ts` and their tests
- Modify: `apps/web/src/app/routes/o.$org.p.$project.runs.$run.tsx`, `runs.index.tsx`, `needs-you.tsx`
- Modify: `apps/web/src/mocks/{runs,runDetail,types}.ts*`, `apps/web/src/mocks/msw/handlers.ts`
- Test: `apps/web/src/features/runs/detail.route.test.tsx`, `runs.route.test.tsx`, `apps/web/e2e/mock/run.spec.ts`

**Interfaces — Produces:** `useResumeRun()` mutation in `mutations.ts` calling `routes.runs.resume`, invalidating the run and run-list queries like `useFinishRun`.

Run page header, exact copy:

| Run state | Shown |
| --- | --- |
| `paused` | Badge "Paused"; line "Can be resumed for {relative time to sessionExpiresAt}"; the agent note; line "Paused {time} after no one was attached"; buttons **Resume**, **Finish** |
| `succeeded` with a kept session | Badge "Succeeded"; the agent note; line "Session kept until {date and time}"; button **Re-open session** |
| `succeeded` without one | As today |
| `expired` | Badge "Expired"; line "Nobody resumed this run in time. The saved session was deleted." |
| latest event is `resume_failed` and the run is parked again | Error banner "Resume failed: {reason}" above the buttons |

- "Has a kept session" uses `hasKeptSession` from contracts with the current time; when the time passes while the page is open the button goes away.
- While a resume request is in flight both buttons are disabled; a 409 shows the server's message in a toast.
- With no pod, the terminal area shows the stored final scrollback (as it does for ended runs today).
- Needs-you page: lists `idle` and `paused` runs; a paused row shows the "Paused" badge and a Resume action.
- Run list: `paused` and `expired` badges; live updates apply `pausedAt` and `sessionExpiresAt` from the status event.
- Stories for both new badges (text and pill variants) and for the three new header states.

- [ ] **Step 1: Write failing tests:**
  - `StatusBadge` renders "Paused" and "Expired";
  - detail route, paused run: shows the note, "Can be resumed for", Resume and Finish; clicking Resume calls `POST /api/runs/:id/resume` and the page then shows "Queued";
  - detail route, succeeded with a future `sessionExpiresAt`: shows "Re-open session"; with a past one: does not;
  - detail route, expired: shows the expired line and no action buttons;
  - a 409 from resume shows the message and re-enables the button;
  - a `resume_failed` event shows the banner;
  - needs-you route lists a paused run;
  - `applyEvents`: a status event `succeeded → queued` is applied (not dropped as a change out of a final status).
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/web test` — expect FAIL.
- [ ] **Step 3: Implement.** Mock handlers gain the resume route and paused/expired/kept-session sample runs.
- [ ] **Step 4: Add a mock e2e** in `apps/web/e2e/mock/run.spec.ts`: open a paused run, press Resume, see the terminal.
- [ ] **Step 5: Run** `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web test:e2e:mock` — expect PASS.
- [ ] **Step 6: Commit** `feat(web): paused and expired runs, resume and re-open`.

### Task 15: End-to-end on the local stack

**Files:**
- Modify: `apps/web/e2e/local/run.spec.ts` or `scripts/e2e-local.ts` (follow `docs/runbooks/tests-and-e2e.md`), `packages/core/src/kube/fake-pod.mjs` if the fake pod needs a resume mode
- Modify: `docs/runbooks/local-dev.md` (one paragraph: how to see a run pause quickly by lowering the idle time)

- [ ] **Step 1: Write the e2e:** start a run that asks a question; with the idle time set low for the test, wait for "Paused"; check the pod is gone and a queued run starts; press Resume; check the terminal shows the earlier conversation; answer; the run continues.
- [ ] **Step 2: Run** `devbox run e2e-local` — expect FAIL, then implement what is missing (test seams only), then PASS.
- [ ] **Step 3: Run** `devbox run check` and report the real result.
- [ ] **Step 4: Commit** `test(e2e): pause and resume a run on the local stack`.

---

## Deploy order

1. Infra: storage class `agentdesk-run-volumes` and the worker Role with `persistentvolumeclaims`; set `RUN_VOLUME_STORAGE_CLASS=agentdesk-run-volumes`.
2. Runner image from Phase B live as `RUNNER_IMAGE` (it must understand `HOME` on the volume before the worker creates such Jobs).
3. Migration, then api and worker, then web.

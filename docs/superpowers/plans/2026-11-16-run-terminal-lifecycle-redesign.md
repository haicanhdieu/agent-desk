# Run Terminal, Idle Timer and Pause Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run waiting for a person always reaches `paused` (or `succeeded` with a kept session) within a fixed time, the pod reports how its session ended, terminal attach clients never leak, and the web shows the real state instead of an endless "Reconnecting…".

**Architecture:** The runner entrypoint becomes the only owner of the pod's exit: it notices the end (exit code checks, stop file, agent exit file, SIGTERM), saves the scrollback, runs `tmux kill-server` and prints one `agentdesk: session ended reason=… code=…` line. The run workflow gets a durable deadline on `ending` (Job delete as fallback) and parks a pod that died without that line. The API gives every socket its own named attach client and kills it on close; the workflow tracks attach leases that expire instead of a counter.

**Tech Stack:** bash runner image (tmux), TypeScript, Temporal workflows (`patched()`), NestJS/Fastify WebSocket relay, Zod contracts, Drizzle/Postgres, Vite/React/TanStack, Storybook.

**Spec:** [docs/superpowers/specs/2026-11-16-run-terminal-lifecycle-redesign.md](../specs/2026-11-16-run-terminal-lifecycle-redesign.md). Read it, and the [pause and resume plan](2026-11-15-run-pause-resume.md), before any task.

## Global Constraints

- Repo rules in `AGENTS.md` apply to every task: contracts first; layering `apps → core → db → contracts`; no provider names outside adapters; every query through `withOrg`; no secrets in Postgres, logs, events or errors; untrusted text never interpolated into shell, k8s specs or SQL; authz on every endpoint including terminal attach; never edit an applied migration; strict TS.
- Every task starts with a failing test (rule 9). No network in tests.
- Before each commit: `devbox run fix` until it prints `fix: clean.` Conventional Commits with the package as scope. One PR per phase, ≤ ~400 changed lines, one concern each. Never lower coverage thresholds or baselines.
- Before saying a phase is done: `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> test` for every package touched; report real results.
- Exact values from the spec:
  - End marker line: `agentdesk: session ended reason=<reason> code=<n>`; reasons `stop_request` | `agent_exit` | `session_gone` | `signal`.
  - Session existence check: `tmux has-session -t '=agent'`, exit code only, never its output.
  - Scrollback capture cap: 5 s. Loop period: 1 s.
  - `stop_request` and `signal` exit 0; `agent_exit` exits with the agent's code.
  - `ENDING_DEADLINE_SECONDS` default `90`.
  - Marker and pid files on tmpfs `/run/agentdesk` (`agent-exit`, `stop`, attach pid files), never on the run volume.
  - New close code `4410` "session ended"; the web never retries on 4410 or 4409.
  - Attach exit code `3` = no session. Fallback for old pods: command not found → old `TMUX_ATTACH`; remove after 7 days.
  - Connection id: server-made UUID, checked by regex in the API and in the script.
  - Lease signal every 2 minutes; the workflow drops an id unheard for 5 minutes.
  - Per-run terminal cap stays `MAX_TERMINALS_PER_RUN = 4`.
  - `pauseReason`: `idle_timeout` | `pod_lost`. `sessionEndingAt`: timestamp or null.
  - `patched()` ids: `ending-deadline`, `pod-lost-parks`, `attach-leases`.
  - Idle timer (user decision): `IDLE_END_SECONDS_DEFAULT` 600 → 1800, only in Phase 3a.
- The status stays `idle`/`done` during `ending`; filters and status tokens do not change.
- A runner image change (Phases 1, 3, 8) must be built and live on the cluster before the API/worker code that depends on it is merged (Phases 4, 8). See `docs/runbooks/` for the image build/rollout.
- Do not touch any live run pod while working on this plan.

## Review Focus

1. **Session killed while stale `tmux attach` clients keep the tmux server up** (the incident). Expected: the entrypoint still ends and exits within a few seconds. Pinned in Task 1 (stub where `display-message` prints nothing and exits 0).
2. **The pod never exits after `ending` starts** (stuck capture, entrypoint bug, image without the fix). Expected: parked within deadline + grace; the run never stays `ending`. Pinned in Task 2.
3. **The Job is deleted or the pod disappears while `followPodLogs` is running** (deadline Job delete, OOM, eviction). Expected: no "run pod disappeared" failure; the run parks. Pinned in Tasks 2 and 6.
4. **The browser closes, errors or the API shuts down with sockets open.** Expected: the in-pod attach process is killed (detach exec) on every path. Pinned in Task 4.
5. **Attach/detach/lease signals out of order** (detach before attach, double detach, lease for an unknown id, API crash). Expected: the set never goes negative and an unheard id stops blocking the idle timer after 5 minutes. Pinned in Task 9.

## Decision Points (human, not decided by this plan)

Ask each one with the `AGENTS.md` "Talking to humans" template, one at a time, and wait.

- **D1, spec open question 2, before Phase 6:** a run whose agent crashed (`agent_exit`, non-zero code) keeps `failed` and deletes its volume as today, or keeps its volume and offers Resume? Phase 6 as written keeps today's behaviour; if the answer is "keep the volume", add a task to Phase 6 (park with a new `pauseReason` value, which also changes Phase 5's enum) before starting it.
- **D2, spec open question 3, before Phase 9:** add an "attached but no input for N hours" rule now (inside Phase 9's lease design) or later (separate spec)? Phase 9 as written does not include it.

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| runner | `images/runner/entrypoint.sh`, `images/runner/bin/agentdesk-{attach,detach,end,session}`, `images/runner/Dockerfile`, `images/runner/test/{entrypoint,attach-scripts,dockerfile}.test.ts`, `images/runner/test/harness.ts`, `images/runner/test/stubs/tmux` | Pod exit ownership, attach clients, stop request |
| core | `packages/core/src/kube/{gateway,fake-gateway,real-gateway,job-spec,log-parser}.ts`, `packages/core/src/{config,temporal-names}.ts` | Fixed commands, `/run/agentdesk` mount, end marker parsing, config, signal names |
| worker | `apps/worker/src/workflows/{run.workflow,agent-phase,park,signals,attach-leases}.ts`, `apps/worker/src/activities/{run.activities,run.activities.impl,session.activity}.ts`, `apps/worker/test/*` + new replay fixtures | Deadline, pod lost, end reason, leases |
| api | `apps/api/src/terminal/{terminal.gateway,terminal-targets}.ts`, `apps/api/test/terminal.int.test.ts` | One client per socket, 4410, detach exec, leases |
| contracts/db | `packages/contracts/src/schemas/runs.ts`, `packages/contracts/src/enums.ts`, `packages/db/src/schema/app.ts`, `packages/db/migrations/0013_run_session_ending.sql` | `sessionEndingAt`, `pauseReason` |
| web | `apps/web/src/features/runs/{useTerminal,detail.map}.ts`, `apps/web/src/app/routes/o.$org.p.$project.runs.$run.tsx`, run detail components + stories, `apps/web/src/mocks/*`, `apps/web/e2e/local/run.spec.ts` | Pausing/paused/resumed states, close codes |
| docs | `docs/adr/0023-runner-entrypoint-owns-the-end-of-a-run-pod.md`, amendment notes in ADR 0011, 0014, 0022, `docs/runbooks/local-dev.md`, `.env.example` | Decision record, idle time |

---

## Phase 1: Entrypoint owns the end (PR 1) — `review:sensitive` (runner)

### Task 1: End loop on exit codes, `kill-server`, SIGTERM trap, end marker

**Files:**
- Modify: `images/runner/entrypoint.sh` (the block after `echo 'agentdesk: session started'`)
- Modify: `images/runner/test/stubs/tmux`, `images/runner/test/harness.ts`
- Test: `images/runner/test/entrypoint.test.ts` (new `describe('entrypoint session end')`)
- Create: `docs/adr/0023-runner-entrypoint-owns-the-end-of-a-run-pod.md` from the spec appendix (Status: Accepted when this PR merges); one-line "Amended by 0023" notes in ADR 0011, 0014, 0022

**Interfaces — Produces:**
- Runner stdout line `agentdesk: session ended reason=(agent_exit|session_gone|signal) code=<0-255>` printed after `final scrollback end`, immediately before exit (Phase 8 adds `stop_request`).
- Exit code: `agent_exit` → pane dead status; `session_gone` and `signal` → `0`.
- Harness: `runEntrypoint(env, repoFixture, opts?: { signalAfterMs?: number })` sends SIGTERM to the bash process after `opts.signalAfterMs`.
- tmux stub modes via `STUB_TMUX_MODE`: `dead` (default, today's behaviour: pane dead, status `STUB_PANE_STATUS` or 0), `incident` (`has-session` exits 1, `display-message` prints nothing and exits 0), `alive` (session exists and pane never dies).

- [x] **Step 1: Write the failing tests**

```ts
it('incident: session gone but display-message prints nothing still exits', async () => {
  const r = await runEntrypoint({ STUB_TMUX_MODE: 'incident' }, {});
  expect(r.stdout).toContain('agentdesk: session ended reason=session_gone code=0');
  expect(r.exitCode).toBe(0);
  expect(tmuxCalls(r).some((c) => c.argv.join(' ') === "has-session -t =agent")).toBe(true);
});
it('agent exit reports the pane status', async () => {
  const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: '3' }, {});
  expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=3');
  expect(r.exitCode).toBe(3);
});
it('SIGTERM prints the scrollback, then the end line, and exits 0', async () => {
  const r = await runEntrypoint({ STUB_TMUX_MODE: 'alive' }, {}, { signalAfterMs: 1500 });
  const begin = r.stdout.indexOf('agentdesk: final scrollback begin');
  expect(begin).toBeGreaterThan(-1);
  expect(r.stdout.indexOf('agentdesk: final scrollback end')).toBeGreaterThan(begin);
  expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=signal code=0');
  expect(r.exitCode).toBe(0);
});
it('kills the tmux server after the scrollback on every end path', async () => {
  for (const mode of ['incident', 'dead']) {
    const r = await runEntrypoint({ STUB_TMUX_MODE: mode }, {});
    const argvs = tmuxCalls(r).map((c) => c.argv[0]);
    expect(argvs.lastIndexOf('kill-server')).toBeGreaterThan(argvs.lastIndexOf('capture-pane'));
  }
});
```

- [x] **Step 2: Run** `pnpm --filter @agentdesk/runner test -- entrypoint` — expect FAIL (the incident test times out at the harness's 30 s).
- [x] **Step 3: Implement** in `entrypoint.sh`: a `trap 'end_reason=signal' TERM` set right after `new-session`; a loop that sleeps with `sleep 1 & wait $!` (so the trap fires at once; bash as PID 1 ignores SIGTERM without a trap) and checks, in order, the trap flag, `tmux has-session -t '=agent'` exit code (`session_gone`), then pane dead (`display-message -p -t '=agent:' '#{pane_dead}'` printing exactly `1` → `agent_exit`, code from `#{pane_dead_status}`, digits only else `1`). One `end_session` function: `timeout 5 tmux capture-pane -t '=agent:' …` between the existing markers, `tmux kill-server 2>/dev/null || true`, the end line, exit. Keep `remain-on-exit`.
- [x] **Step 4: Run** `pnpm --filter @agentdesk/runner test` — expect PASS (all old entrypoint tests too).
- [x] **Step 5: Write ADR 0023** and the three amendment notes.
- [x] **Step 6: Commit** `fix(runner): end the session on exit codes and kill the tmux server`.

---

## Phase 2: Deadline on `ending` (PR 2) — `review:sensitive` (run Job)

### Task 2: `ending` deadline, then delete the Job and park

**Files:**
- Modify: `apps/worker/src/workflows/run.workflow.ts` (main loop, `followPod`, `Pod` type)
- Modify: `packages/core/src/config.ts` (`RUN_ENDING_DEADLINE_SECONDS`, test seam like `RUN_IDLE_END_SECONDS`), `packages/core/src/temporal-names.ts` (`ENDING_DEADLINE_SECONDS = 90`), `apps/worker/src/activities/session.activity.ts` or wherever `loadRun` fills `idleEndSeconds` (add `endingDeadlineSeconds`)
- Modify: `apps/worker/src/activities/run.activities{,.impl}.ts` (new `recordEndingDeadline`)
- Test: `apps/worker/test/run.workflow.test.ts`, `packages/core/test/config.test.ts`, new fixture `apps/worker/test/fixtures/run-ending-deadline-history.json`

**Interfaces — Produces:**
- `export const ENDING_DEADLINE_SECONDS_DEFAULT = 90` in `run.workflow.ts` (mirrors core; a test asserts equality, like `IDLE_END_SECONDS_DEFAULT`).
- `RunContext.endingDeadlineSeconds?: number`.
- `Pod` gains `scope: CancellationScope` (the `followPodLogs` call runs inside it) and `abandoned: boolean`.
- Activity `recordEndingDeadline(ctx: RunContext, input: { scrollbackSaved: boolean; at: string }): Promise<void>` — appends a run event; text when not saved: "The session did not end in time; the pod was stopped. Final scrollback not saved."
- Workflow behaviour under `patched('ending-deadline')` (read once, right after `pauseResume`): while `ending`, the loop waits `condition(wake, deadlineMs)`; on timeout it calls `act.deleteJob(c)`, cancels `pod.scope`, sets `pod.abandoned = true`, records the event, then continues as if the pod exited: park when `pauseResume && parkKind !== undefined && !finishRequested`, else `succeeded`.

- [x] **Step 1: Write the failing tests** (real time, short values from `loadRun`, as the existing idle tests do):

```ts
it('ending deadline: a pod that never exits is deleted and the run parks', async () => {
  const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 2 });
  s.fake.ignoreEndSession(); // endSession succeeds but the pod keeps running
  // ... drive to needs_input, wait for idle end + deadline
  expect(s.calls('deleteJob').length).toBeGreaterThanOrEqual(1);
  expect(await s.phase()).toBe('parked');
  expect(s.calls('recordEndingDeadline')[0]).toMatchObject({ scrollbackSaved: false });
});
it('ending deadline after Finish ends succeeded, not parked', async () => { /* same, finishRun instead of idle */ });
it('a pod that exits before the deadline does not delete the Job early or record the event', async () => {});
it('ENDING_DEADLINE_SECONDS_DEFAULT mirrors core', () => {
  expect(ENDING_DEADLINE_SECONDS_DEFAULT).toBe(ENDING_DEADLINE_SECONDS);
  expect(ENDING_DEADLINE_SECONDS).toBe(90);
});
```

Plus in `config.test.ts`: `RUN_ENDING_DEADLINE_SECONDS` defaults to 90, blank is the default, `0` is refused.

- [x] **Step 2: Run** `pnpm --filter @agentdesk/worker test -- run.workflow` and `pnpm --filter @agentdesk/core test -- config` — expect FAIL.
- [x] **Step 3: Implement** the items under Produces. Cancelling `pod.scope` must not surface as `current.error` (treat a cancellation of an abandoned pod as "exited, no result"; use `scrollbackSaved = pod.result?.scrollbackTail !== undefined`). `park()` already calls `deleteJob`; a second delete is a no-op.
- [x] **Step 4: Replay.** Capture `run-ending-deadline-history.json` with `UPDATE_REPLAY_FIXTURES=1`; the existing replay test must pass for all old fixtures (`run-idle-timer`, `run-idle-finish`, `run-park-*`).
- [x] **Step 5: Run** `pnpm --filter @agentdesk/worker test && pnpm --filter @agentdesk/core test && pnpm typecheck` — expect PASS.
- [x] **Step 6: Commit** `fix(worker): delete the Job and park when a session does not end in time`.

---

## Phase 3: Attach and detach scripts (PR 3) — `review:sensitive` (terminal)

### Task 3: `agentdesk-attach` / `agentdesk-detach` and the `/run/agentdesk` tmpfs

**Files:**
- Create: `images/runner/bin/agentdesk-attach`, `images/runner/bin/agentdesk-detach`
- Modify: `images/runner/Dockerfile` (COPY + `chmod 0755` into `/usr/local/lib/agentdesk/bin`, which is on `PATH`; `mkdir /run/agentdesk` owned by 10001 as a fallback)
- Modify: `packages/core/src/kube/job-spec.ts` (volume `agentdesk-run`: `emptyDir: { medium: 'Memory', sizeLimit: '1Mi' }`, mounted at `/run/agentdesk` in the run container; setup-test pods too)
- Test: create `images/runner/test/attach-scripts.test.ts`; extend `images/runner/test/dockerfile.test.ts`; `packages/core` job-spec test

**Interfaces — Produces:**
- `agentdesk-attach <uuid>`: rejects an id not matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` with exit 2; exits 3 when `tmux has-session -t '=agent'` fails; otherwise writes `$$` to `${AGENTDESK_RUN_DIR:-/run/agentdesk}/attach/<uuid>.pid` and `exec tmux attach -t '=agent'`.
- `agentdesk-detach <uuid>`: same regex (exit 2); reads only that pid file; kills that pid only if its `/proc/<pid>/comm` is exactly `tmux: client` (what real tmux 3.3a sets on an attach client, checked in the runner image) or plain `tmux` (the instant right after exec); never `tmux: server` or anything else (test seam `AGENTDESK_PROC_DIR`); removes the file; exit 0 when the file is missing (idempotent).
- Core job-spec: `RUN_DIR = '/run/agentdesk'` exported constant.

- [x] **Step 1: Write the failing tests:** attach with no session → exit 3 and no tmux `attach` call; attach with a session → pid file holds the script's pid and tmux got `attach -t =agent`; attach `'../../etc'` and `'$(id)'` → exit 2, no file written; detach of a non-UUID → exit 2; detach kills only the pid in its own file (two pid files, one killed); detach of a missing id → exit 0; detach does not kill a pid whose `comm` is not `tmux`; Dockerfile copies both scripts executable; job-spec mounts a Memory `emptyDir` at `/run/agentdesk`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/runner test && pnpm --filter @agentdesk/core test -- job-spec` — expect FAIL.
- [x] **Step 3: Implement** the two scripts (bash, `set -euo pipefail`, id only ever used after the regex check, quoted) and the job-spec volume.
- [x] **Step 4: Run** the same commands — expect PASS.
- [x] **Step 5: Commit** `feat(runner): one named tmux attach client per terminal`.
- [ ] **Step 6: After merge:** build and roll out the runner image (runbook). Phases 3a and 4 wait for this.

---

## Phase 3a: Idle timer 30 minutes (PR 3a) — `review:sensitive` (run workflow)

User decision (spec §5 option A, open question 1). Lands only after Phases 1, 2 and 3 are merged and the Phase 1/3 runner image is live: pause must be reliable before it is common. Not earlier.

### Task 3a: Raise the idle end time from 600 to 1800 seconds

**Files:**
- Modify: `apps/worker/src/workflows/run.workflow.ts:60` (`IDLE_END_SECONDS_DEFAULT = 1800`)
- Modify: `packages/core/src/temporal-names.ts:55` (`IDLE_END_SECONDS = 1800`; the worker constant mirrors it and a test asserts they are equal, so both change together)
- Modify: `.env.example:65` (`# RUN_IDLE_END_SECONDS=1800`), `docs/runbooks/local-dev.md` ("the default is 1800"), `docs/conventions/testing.md:77` ("idle 30 min"), the "10 minutes" lines in ADR 0011/0020/0022 get a one-line "now 30 min (0023 rollout)" note, `apps/web/src/mocks/runDetail.tsx:393` copy
- Test: `apps/worker/test/run.workflow.test.ts:359-360`, `packages/core/test/config.test.ts:29,33`

- [ ] **Step 1: Change the tests first:** `expect(IDLE_END_SECONDS).toBe(1800)` (worker test line 360), `expect(c.RUN_IDLE_END_SECONDS).toBe(1800)` and the blank-default case (config test lines 29, 33).
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test -- run.workflow && pnpm --filter @agentdesk/core test -- config` — expect FAIL on those assertions.
- [ ] **Step 3: Implement** the two constants and the doc/copy lines above. Replay note: `idleEndSeconds` comes from `loadRun` (recorded), and Temporal does not compare timer durations on replay, so no `patched()` is needed; the replay test proves it.
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/worker test && pnpm --filter @agentdesk/core test` — expect PASS, replay included.
- [ ] **Step 5: Commit** `feat(worker): pause runs after 30 minutes with nobody attached`.

---

## Phase 4: One client per socket (PR 4) — `review:sensitive` (terminal)

Precondition: the Phase 3 runner image is live.

### Task 4: Named attach, detach exec, 4410, old-pod fallback

**Files:**
- Modify: `packages/core/src/kube/gateway.ts` (command builders), `packages/core/src/kube/fake-gateway.ts` (accept them), `packages/core/src/kube/real-gateway.ts` (surface "command not found")
- Modify: `apps/api/src/terminal/terminal.gateway.ts`, `apps/api/src/terminal/terminal-targets.ts`
- Test: `apps/api/test/terminal.int.test.ts`, `packages/core` fake/real gateway tests

**Interfaces — Produces:**
- `CONNECTION_ID_RE` (the UUID regex above) exported from core.
- `attachCommand(id: string): string[]` → `['agentdesk-attach', id]`; `detachCommand(id: string): string[]` → `['agentdesk-detach', id]`; both throw on an id failing `CONNECTION_ID_RE`.
- `EXEC_NOT_FOUND = 127`: `real-gateway` reports this code from `onClose` when the runtime says the executable was not found (record the real Status payload from a cluster once and pin it in a unit test; today unknown maps to `1`).
- `CLOSE.sessionEnded = 4410`.
- Fake gateway: `agentdesk-attach <uuid>` behaves like `TMUX_ATTACH` (exit 3 when the fake pod has exited); `agentdesk-detach <uuid>` records the id and returns `closedSession(0)`.

- [ ] **Step 1: Write the failing tests:** each socket execs `agentdesk-attach <its own uuid>` (two sockets → two different ids, both valid UUIDs, not from the client); attach exec closing with exit 3 → socket closed 4410; attach on a run whose pod already exited → 4410; socket close, socket error and API shutdown each run `agentdesk-detach <same id>` once; exec exit 127 on attach → retried once with `TMUX_ATTACH`; `attachCommand('x; rm -rf /')` throws; unauthorized sockets never exec anything.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/api test -- terminal && pnpm --filter @agentdesk/core test` — expect FAIL.
- [ ] **Step 3: Implement.** `randomUUID()` per connection on the server; detach is best effort (log error name only, never fail the close). Keep the 4-per-run cap and existing authz order unchanged.
- [ ] **Step 4: Run** the same commands — expect PASS.
- [ ] **Step 5: Commit** `feat(api): one attach client per terminal socket, closed with it`.

---

## Phase 5: Contracts and database (PR 5) — `review:sensitive` (migration)

### Task 5: `sessionEndingAt` and `pauseReason`

**Files:**
- Modify: `packages/contracts/src/schemas/runs.ts` (`RunDto`, `RunStatusEvent`), `packages/contracts/src/enums.ts`
- Modify: `packages/db/src/schema/app.ts`; create `packages/db/migrations/0013_run_session_ending.sql` via the repo's Drizzle command (`docs/conventions/database.md`)
- Modify (mapping only): `apps/api/src/runs/runs.service.ts`, `apps/api/src/sse/sse.service.ts`, `apps/web/src/mocks/*` builders
- Test: `packages/contracts` runs schema test, `packages/db` migration test (follow the `0011`/`0012` guard tests)

**Interfaces — Produces:**
- `PauseReason = z.enum(['idle_timeout', 'pod_lost'])`.
- `RunDto` and `RunStatusEvent` gain `sessionEndingAt: Timestamp.nullable()`, `pauseReason: PauseReason.nullable()`.
- Columns `runs.session_ending_at` (timestamptz null), `runs.pause_reason` (text null, check `in ('idle_timeout','pod_lost')`).

- [ ] **Step 1: Write the failing tests:** `RunDto` parses with both fields null and with `pauseReason: 'pod_lost'`; rejects `pauseReason: 'oom'`; migration applies on a db at `0012`; `pause_reason = 'x'` is rejected; the file has no `update`/`delete`/`insert` on `runs`; existing rows read back null.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/contracts test && pnpm --filter @agentdesk/db test` — expect FAIL.
- [ ] **Step 3: Implement**; API mappers read the real columns (null for old rows).
- [ ] **Step 4: Run** those plus `pnpm typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(contracts): session ending time and pause reason on runs`.

---

## Phase 6: Worker reads the end, pod lost parks (PR 6) — `review:sensitive` (run Job)

**Stop first:** ask decision point D1. Continue with the plan below only if the answer is "stay `failed`"; otherwise add the extra task first.

### Task 6a: Parse the end marker and survive a vanished pod

**Files:**
- Modify: `packages/core/src/kube/log-parser.ts` (`session_ended` kind)
- Modify: `apps/worker/src/activities/run.activities{,.impl}.ts` (`followPodLogs` result, `waitForExit`)
- Test: core `log-parser` test, `apps/worker/test/run.activities.int.test.ts`

**Interfaces — Produces:**
- `export type EndReason = 'stop_request' | 'agent_exit' | 'session_gone' | 'signal'` in core (mirrored in workflow code, which cannot import core; a test asserts equality).
- `LogLineKind` gains `'session_ended'`; `ParsedLogLine.end?: { reason: EndReason; code: number }`; regex `^agentdesk: session ended reason=(stop_request|agent_exit|session_gone|signal) code=(\d{1,3})$`.
- `FollowPodLogsResult` gains `endReason?: EndReason` (last `session_ended` line seen; stored as a run event so it survives retries) and `podLost?: true` (the pod vanished or ended with no end line after `session_started`).
- `waitForExit` returns `'gone'` instead of throwing when the pod disappeared; `followPodLogs` maps `'gone'` after `session_started` to `{ podLost: true, exitCode: -1 }` and keeps today's non-retryable failure before it.

- [ ] **Step 1: Failing tests:** parser accepts the four reasons and rejects `reason=evil`, extra text, and 4-digit codes; `followPodLogs` returns `endReason: 'signal'` for a log with the line; returns `podLost: true` when the fake pod is deleted after `session started` with no end line; still throws before `session started`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/core test -- log-parser && pnpm --filter @agentdesk/worker test -- run.activities` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): read how the session ended from the runner`.

### Task 6b: Outcome decisions, `sessionEndingAt`, pod lost parks, resume while ending

**Files:**
- Modify: `apps/worker/src/workflows/agent-phase.ts` or `park.ts` (pure decision), `apps/worker/src/workflows/run.workflow.ts`, `apps/worker/src/activities/{session.activity,run.activities.impl}.ts` (`endSession` writes `sessionEndingAt`; `parkRun` clears it and writes `pauseReason`)
- Test: `apps/worker/test/park.test.ts`, `apps/worker/test/run.workflow.test.ts`, new fixture `run-pod-lost-history.json`

**Interfaces — Produces:**
- `endOutcome(input: { ending: boolean; finishRequested: boolean; phase: RunPhase; parkKind?: ParkKind; endReason?: EndReason; podLost: boolean; exitCode: number }): { kind: 'park'; parkKind: ParkKind; reason: PauseReason } | { kind: 'succeeded' } | { kind: 'failed' }` in `park.ts`. Rules: `ending` + Finish → succeeded; `ending` (idle timer) → park with `idle_timeout`; `podLost` (or no end line) after start → park, `pod_lost`, kind from phase (`running`/`idle` → `needs_input`, `agent_done` → `done`); `agent_exit` → succeeded on 0, failed otherwise (D1).
- `parkRun(ctx, { kind, at, reason: PauseReason })` (reason added; clears `session_ending_at`).
- `endSession` sets `session_ending_at = now()` before the exec (activity-side, so no new workflow command).
- `resumeRejection(phase)` accepts `'ending'` (queued): the workflow sets `resumeAccepted` and the park loop runs it right after park.
- All new workflow branches behind `patched('pod-lost-parks')`, read once after `pauseResume`.

- [ ] **Step 1: Failing tests:** `endOutcome` table test, one row per rule above (include `running` + `podLost` → `needs_input`/`pod_lost`; `agent_done` + `podLost` → `done`); workflow: fake pod killed while idle → `paused` with `pauseReason='pod_lost'`, volume not deleted; idle timer → `sessionEndingAt` set during ending and null after park, `pauseReason='idle_timeout'`; resume sent while `ending` is accepted and a new pod starts after park; cancel while `ending` still wins (`cancelled`, volume deleted); old fixtures still replay.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test -- park run.workflow` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/worker test && pnpm typecheck` — expect PASS; capture the new fixture.
- [ ] **Step 5: Commit** `feat(worker): park a run whose pod was lost; show the session ending`.

---

## Phase 7: Web states (PR 7) — not sensitive

### Task 7: Close codes and pausing/paused/resumed states

**Files:**
- Modify: `apps/web/src/features/runs/useTerminal.ts`, `useTerminal.test.tsx`, `detail.map.ts`, `detail.map.test.ts`, the run route `o.$org.p.$project.runs.$run.tsx`, the run detail terminal-area component and its stories, `apps/web/src/mocks/*`
- API: also refuse attach with 4410 while `sessionEndingAt` is set or status is `paused` (`terminal-targets.ts`, one api test) — include it here only if Phase 4 did not; otherwise skip.

**Interfaces — Produces:**
- `useTerminal`: `CLOSE_SESSION_ENDED = 4410`; `TerminalState` gains `'ended'`. 4410 and 4409 → `onSessionEnd`, no retry. 1000 → refetch; retry only if the run is live and `sessionEndingAt` is null. Back-off only for 1006, 1011, 1013.
- `detail.map.ts`: `terminalArea(run: RunDto): 'live' | 'pausing' | 'paused' | 'resuming' | 'expired'` and `pauseReasonText(r: PauseReason): string` — "after 30 min with nobody attached" / "the pod stopped unexpectedly (out of memory / evicted)".
- Copy from spec §5, exactly: "Session ended. Pausing the run…"; "Paused: waiting for your answer. Can be resumed for <N> days." (N from `sessionExpiresAt`, not hard-coded); "Pauses after 30 min with nobody attached"; resumed banner "Resumed. The agent asked: <agentNote>. Background tasks and sub-agents that were running when it paused were stopped."; expired "Nobody resumed this run within <N> days. The saved session was deleted."
- While `sessionEndingAt` is set the run query polls (existing SSE if it carries the field, else `refetchInterval: 2000`).

- [ ] **Step 1: Failing tests:** 4410 → state `ended`, no second socket after the back-off window (fake timers); 1000 with `sessionEndingAt` set → no retry; 1006 → retries; `terminalArea` table test; `pauseReasonText` both values; route test shows the pausing text and no socket while `sessionEndingAt` is set.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/web test -- useTerminal detail` — expect FAIL.
- [ ] **Step 3: Implement**, design tokens only. Stories: pausing, paused (idle_timeout), paused (pod_lost), resumed banner, expired, plus loading and error states.
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck` and build Storybook once — expect PASS.
- [ ] **Step 5: Commit** `feat(web): show pausing, paused and resumed run states`.

---

## Phase 8: Session wrapper and stop request (PR 8) — `review:sensitive` (runner, run Job)

The runner part must be live before the worker part is relied on. Keep one PR, but the worker falls back (exec exit 127 → old `TMUX_KILL`) so merge order is safe; remove the fallback with the attach one after 7 days.

### Task 8: `agentdesk-session` exit file and `agentdesk-end` replacing `TMUX_KILL`

**Files:**
- Create: `images/runner/bin/agentdesk-session`, `images/runner/bin/agentdesk-end`; modify `images/runner/entrypoint.sh` (tmux runs `agentdesk-session "$session_cmd"`-style wrapper; loop checks `stop` then `agent-exit` files first), `images/runner/Dockerfile`
- Modify: `packages/core/src/kube/{gateway,fake-gateway}.ts` (`END_COMMAND = ['agentdesk-end']`), `apps/worker/src/activities/run.activities.impl.ts` (`endSession`)
- Test: `images/runner/test/entrypoint.test.ts`, `attach-scripts.test.ts`, `dockerfile.test.ts`; worker `run.activities.int.test.ts`; core fake gateway test

**Interfaces — Produces:**
- `agentdesk-end`: `touch "$RUN_DIR/stop"`, exit 0, no arguments accepted.
- `agentdesk-session`: runs the agent command, writes its exit code to `$RUN_DIR/agent-exit`, exits with it. The session command string is the existing fixed `AGENT_START_CMD`/`AGENT_RESUME_CMD`, never ticket text.
- Entrypoint check order (spec §3): stop file → `stop_request`; `agent-exit` file → `agent_exit` with its code; `has-session` fails → `session_gone`; trap → `signal`. Pane-dead check from Phase 1 stays as a fallback.
- `TMUX_KILL` kept only as the 127 fallback.

- [ ] **Step 1: Failing tests:** stop file present → `reason=stop_request code=0`, exit 0; agent-exit file `5` → `reason=agent_exit code=5`, exit 5; stop wins over agent-exit when both exist; `agentdesk-end extra` → exit 2; worker `endSession` execs `['agentdesk-end']` and on 127 execs `TMUX_KILL`; fake gateway accepts `agentdesk-end` and the fake pod ends with `stop_request`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/runner test && pnpm --filter @agentdesk/worker test -- run.activities && pnpm --filter @agentdesk/core test` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(runner): ask the runner to end the session instead of killing tmux` (the worker change rides in the same PR; mention it in the body).

---

## Phase 9: Attach leases (PR 9) — `review:sensitive` (terminal)

**Stop first:** ask decision point D2. The plan below does not include an "attached but idle for N hours" rule.

### Task 9: Lease set in the workflow, lease signals from the API

**Files:**
- Create: `apps/worker/src/workflows/attach-leases.ts` (pure), `apps/worker/test/attach-leases.test.ts`
- Modify: `apps/worker/src/workflows/{signals,run.workflow}.ts`, `packages/core/src/temporal-names.ts` (`SIGNAL.terminalLease`), `apps/api/src/terminal/{terminal.gateway,terminal-targets}.ts`
- Test: `apps/worker/test/run.workflow.test.ts` (+ fixture `run-attach-leases-history.json`), `apps/api/test/terminal.int.test.ts`

**Interfaces — Produces:**
- `LEASE_INTERVAL_MS = 120_000`, `LEASE_TTL_MS = 300_000`.
- `attach-leases.ts`: `type Leases = ReadonlyMap<string, number>`; `attach(l, id, nowMs)`, `detach(l, id)`, `renew(l, ids: string[], nowMs)` (unknown ids ignored), `expire(l, nowMs): Leases`, `nextExpiryMs(l): number | undefined`, `count(l): number`.
- Signals: `terminalAttached` / `terminalDetached` take `[connectionId?: string]` (no arg = legacy counter path); new `terminalLease: [string[]]`.
- Workflow under `patched('attach-leases')`: `attached` is `count(leases)`; the idle-timer wait also wakes at `nextExpiryMs` and drops expired ids.
- API: for each run with open sockets, one `terminalLease` signal with that run's live ids every 2 minutes; stops when the last socket closes; only for sockets that passed authz.

- [ ] **Step 1: Failing tests:** pure: detach before attach → count 0; double detach → count 0; renew of an unknown id → no change; an id unheard for 5 minutes expires, a renewed one does not. Workflow: attach with id, no lease for 5 min (short test values) → idle timer runs and the run parks; legacy no-id signals still count; old fixtures replay. API: lease sent every interval (fake timers) with the live ids; stopped after the last close; never sent for an unauthorized socket.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker test -- attach-leases run.workflow && pnpm --filter @agentdesk/api test -- terminal` — expect FAIL.
- [ ] **Step 3: Implement.** Lease timing values are test seams via `loadRun`, like `idleEndSeconds`.
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/worker test && pnpm --filter @agentdesk/api test` — expect PASS.
- [ ] **Step 5: Commit** `feat(worker): attach leases that expire instead of an attach counter` (API part in the same PR; one concern: leases).

---

## Phase 10: End-to-end check (PR 10) — not sensitive

Spec §8 asks for it; the spec's rollout table has no row for it.

### Task 10: idle → pause with a stale attach client → Resume → answer

**Files:**
- Modify: `apps/web/e2e/local/run.spec.ts`, `packages/core/src/kube/fake-gateway.ts` only if a stale-client hook is needed (test seam)

- [ ] **Step 1: Write the e2e test** (runs with `E2E_IDLE_END_SECONDS=5`, like the existing pause test): open the run page, close it without a clean close (leave a stale fake attach), wait for "Paused", check the reason line, press Resume, answer, see a new turn.
- [ ] **Step 2: Run** against a stack started with `RUN_IDLE_END_SECONDS=5` (`docs/runbooks/tests-and-e2e.md`) — expect PASS (it should fail on a checkout before Phase 1).
- [ ] **Step 3: Commit** `test(web): e2e pause with a stale terminal and resume`.

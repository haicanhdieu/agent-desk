# Agent Run Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Needs you" shows only when a person is needed; background work stays Running; a declared finish shows a new Done status; Finish reliably closes a run.

**Architecture:** An agent-neutral stdout protocol (`agentdesk: state …`) parsed in `packages/core`, mapped to run status in the worker, and produced in the runner image by a per-agent adapter (Claude Code hooks + an `agentdesk-status` declare command). Finish becomes a Temporal workflow update so the API returns the workflow's real answer.

**Tech Stack:** TypeScript (strict), Zod, Drizzle/Postgres, Temporal TS SDK 1.25, NestJS/Fastify, Vite/React, Vitest, Node 22 `.mjs` scripts in the runner image, Claude Code 2.1.323.

**Spec:** [docs/superpowers/specs/2026-11-14-agent-run-status-design.md](../specs/2026-11-14-agent-run-status-design.md), ADR [0020](../../adr/0020-agent-status-protocol.md).

## Global Constraints

- Protocol lines, exactly: `agentdesk: state working`, `agentdesk: state waiting background`, `agentdesk: state needs_input <source> <note-b64>`, `agentdesk: state done <source> <note-b64>`; `<source>` ∈ `declared|question|approval|undeclared|error`; `<note-b64>` is base64 of UTF-8 or `-` when empty.
- Agent note: single line, at most 500 characters, redacted with run secrets, rendered as plain text only.
- Legacy lines `agentdesk: turn started` / `agentdesk: turn finished` keep working for one release → `working` / `needs_input undeclared`.
- `idle` keeps its name (label "Needs you"); new active status `done` (label "Done"); `IDLE_END_SECONDS` (10 min) applies to both.
- Finish is allowed in `idle` and `done` only (UI, API and workflow use the same set).
- Hard timeout while `done` → `succeeded`; in `idle`/`running` → `timed_out` (unchanged).
- The agent's declaration wins over running background work; a declaration lasts one turn.
- No provider names outside `images/runner/agents/claude/` (AGENTS.md rule 3). Untrusted text only as data (rule 6). Secrets never in notes, logs or events (rule 5).
- Never edit an applied migration; add `0009_*`. Never edit replay fixtures in `apps/worker/test/fixtures/`; old histories must still replay.
- PRs ≤ ~400 lines, one concern each, Conventional Commits with package scope; `devbox run fix` until `fix: clean.` before every commit. Runner, migration, terminal and workflow PRs get `review:sensitive`.
- Deploy order follows PR order: contracts/db → core → worker → api → web → runner image (the runner switches protocol last; the worker understands both).

## Review Focus

1. An agent note with newlines, ANSI escapes, a secret value, invalid base64 or 10 kB of text → stored single-line, ≤ 500 chars, secret replaced; invalid line is plain output, never a status change. (Tests: Tasks 2, 4, 7.)
2. Finish clicked while the database says `idle` but the workflow is already `running` again → API answers 409 at once and the UI clears "Finishing…"; never a silent drop. (Tests: Tasks 6, 7, 8.)
3. A background build finishes after the agent declared `done` → the wake-up turn shows Running, then Done (or Needs you) again at its end; it is never stuck on Running. (Test: Task 11.)
4. A repo/plugin `Stop` hook blocks after ours emitted `done` → the next tool call flips the run back to Running, so the idle timer cannot kill a working agent. (Test: Task 11.)
5. A person types into the terminal while the run is Done → Running, Finish disabled, idle timer stopped; Done again when the turn ends with a declaration. (Tests: Task 6, Task 11.)

---

## PR 0 — Open check

### Task 1: Verify a repo cannot disable managed hooks

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-agent-run-status-design.md` (§8 "Open check": record the result)

- [x] **Step 1:** Build the current runner image: `podman build -t agentdesk-runner:check images/runner`.
- [x] **Step 2:** In a scratch dir create `managed-settings.json` with a `SessionStart` hook `echo managed-fired >> /tmp/out` and a repo dir whose `.claude/settings.json` is `{"disableAllHooks": true, "hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "echo repo-fired >> /tmp/out"}]}]}}`.
- [x] **Step 3:** Run `podman run --rm -v <scratch>/managed-settings.json:/etc/claude-code/managed-settings.json:ro -v <repo>:/workspace/r -w /workspace/r --entrypoint bash agentdesk-runner:check -c 'echo hi | claude -p x >/dev/null 2>&1; cat /tmp/out'`. `SessionStart` fires before any API call, so no credentials are needed.
  Expected: output contains `managed-fired`.
- [x] **Step 4:** Record the result in spec §8. **If `managed-fired` is missing, stop and ask the human** (the managed-settings choice in spec §6.2 no longer holds).
- [x] **Step 5:** Commit `docs(adr): record managed hooks precedence check`.

---

## PR A — contracts + db

### Task 2: Contracts — `done` status, agent state schema, DTO fields

**Files:**
- Modify: `packages/contracts/src/enums.ts`
- Create: `packages/contracts/src/schemas/agent-state.ts` (export from the package index the same way `runs.ts` is)
- Modify: `packages/contracts/src/schemas/runs.ts` (`RunDto`), `packages/contracts/src/schemas/events.ts` (`RunStatusEvent`)
- Test: `packages/contracts/test/agent-state.test.ts` (follow the existing test folder layout of the package)

**Interfaces:**
- Produces:
  - `RunStatus` gains `'done'` (after `'idle'`); `ACTIVE_RUN_STATUSES = ['starting','running','idle','done']`; new `FINISHABLE_RUN_STATUSES = ['idle','done'] as const`.
  - `AgentState = z.enum(['working','waiting','needs_input','done'])`
  - `AgentStateSource = z.enum(['declared','question','approval','undeclared','error'])`
  - `WaitingOn = z.enum(['background'])`
  - `AGENT_NOTE_MAX = 500`; `AgentNote = z.string().max(500).refine(no \r \n    )`
  - `toAgentNote(raw: string): string` — collapses line terminators and control chars to a space, trims, slices to 500.
  - `RunDto` and `RunStatusEvent` gain `waitingOn: WaitingOn.nullable()` and `agentNote: AgentNote.nullable()`.

- [x] **Step 1: Write failing tests**
  - `toAgentNote('a\nb\r\nc\u001b[31m')` → `'a b c [31m'` without the ESC char; `toAgentNote('x'.repeat(600)).length` → `500`.
  - `AgentNote.safeParse('a\nb').success` → `false`.
  - `RunStatus.parse('done')` → `'done'`; `FINISHABLE_RUN_STATUSES` equals `['idle','done']`.
- [x] **Step 2:** Run `pnpm --filter @agentdesk/contracts test` → FAIL.
- [x] **Step 3:** Implement the interfaces above.
- [x] **Step 4:** Run `pnpm --filter @agentdesk/contracts test` and `pnpm typecheck` → contracts PASS; typecheck errors elsewhere are expected (exhaustive `switch`es on `RunStatus` in web/api) — note them, they are fixed in their own tasks; if any prevents this PR's CI from passing, add the `done` case with the same behaviour as `idle` in that file within this PR.
- [x] **Step 5:** Commit `feat(contracts): add done run status and agent state schema`.

### Task 3: DB — status constraint and new columns; status writer

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`runs`)
- Create: `packages/db/migrations/0009_*.sql` via `pnpm --filter @agentdesk/db db:generate`
- Modify: `apps/worker/src/activities/run-status.activity.ts`
- Test: `apps/worker/test/run-status.activity.int.test.ts`

**Interfaces:**
- Consumes: `RunStatus`, `WaitingOn`, `toAgentNote` (Task 2).
- Produces:
  - Columns `waiting_on text null` with check `in ('background')`, `agent_note text null`; `runs_status_check` includes `'done'`.
  - `SetRunStatusInput` gains `waitingOn?: 'background' | null` and `agentNote?: string | null`.
  - Write rules in `setRunStatusTx`: `idleSince` = `at` when status is `idle` or `done`, else null; `waitingOn` = input value only when status is `running`, else null; `agentNote` = `toAgentNote(input)` only when status is `idle` or `done`, else null.

- [x] **Step 1: Write failing tests** in `run-status.activity.int.test.ts`:
  - `'done sets idle_since and agent_note; next running clears both'`
  - `'running with waitingOn background stores it; idle clears it'`
  - `'running → running with a new waitingOn writes and appends one status event'`
  - `'agent note is collapsed to one line and capped at 500'`
- [x] **Step 2:** Run `pnpm --filter @agentdesk/worker test -- run-status` → FAIL.
- [x] **Step 3:** Update the Drizzle schema, generate `0009`, check the SQL only drops/re-adds `runs_status_check` and adds the two columns, then implement the write rules. Also make the API/SSE row→DTO mappers (`apps/api/src/runs/runs.service.ts` ~line 126, `apps/api/src/sse/sse.service.ts`) fill `waitingOn` and `agentNote` from the row.
- [x] **Step 4:** Run the worker test and `pnpm --filter @agentdesk/api test` → PASS.
- [x] **Step 5:** Commit `feat(db): store done status, waiting_on and agent_note on runs` (label `review:sensitive`: migration).

---

## PR B — core

### Task 4: Log parser — protocol lines and legacy mapping

**Files:**
- Modify: `packages/core/src/kube/log-parser.ts`
- Test: `packages/core/test/kube/log-parser.test.ts`

**Interfaces:**
- Consumes: `AgentState`, `AgentStateSource`, `toAgentNote` (Task 2).
- Produces: `LogLineKind` gains `'agent_state'` and drops `'turn_started' | 'turn_finished'`; `ParsedLogLine` gains `agent?: { state: AgentState; source?: AgentStateSource; waitingOn?: 'background'; note?: string }`.
  - `agentdesk: state working` → `{ state: 'working' }`
  - `agentdesk: state waiting background` → `{ state: 'waiting', waitingOn: 'background' }`
  - `agentdesk: state (needs_input|done) <source> <b64|->` → `{ state, source, note? }`; note = `toAgentNote(utf8(base64))`, absent for `-` or empty.
  - Legacy `agentdesk: turn started` → `{ state: 'working' }`; `agentdesk: turn finished` → `{ state: 'needs_input', source: 'undeclared' }`.

- [x] **Step 1: Write failing tests** (replace the existing `turn_started`/`turn_finished` cases):
  - each of the four protocol forms and both legacy lines map as above (with and without trailing `\r`);
  - note `Buffer.from('Ship it?\nyes').toString('base64')` → `note: 'Ship it? yes'`;
  - stays `kind: 'text'`: unknown source (`done maybe -`), b64 with spaces, b64 longer than 2800 chars, extra field, `xagentdesk: state working`, `agentdesk: state working now`.
- [x] **Step 2:** Run `pnpm --filter @agentdesk/core test -- log-parser` → FAIL.
- [x] **Step 3:** Implement with one anchored regex per form: `^agentdesk: state (needs_input|done) (declared|question|approval|undeclared|error) ([A-Za-z0-9+/]{1,2800}={0,2}|-)$`. Decode with `Buffer.from(b64, 'base64').toString('utf8')`.
- [x] **Step 4:** Run the test → PASS.
- [x] **Step 5:** Commit `feat(core): parse agent state protocol lines`.

### Task 5: Fake pod and prompt line

**Files:**
- Modify: `packages/core/src/kube/fake-pod.mjs`, `packages/core/src/router/prompt.ts`
- Test: `packages/core/test/kube/fake-gateway.test.ts`, the existing prompt test next to `prompt.ts`'s tests

**Interfaces:**
- Produces:
  - Fake pod: a turn starts with `agentdesk: state working` and ends with `agentdesk: state needs_input declared <b64("Fake agent is waiting")>`; when the prompt contains `--fake-done` (detected the same way as `--fake-fail`) it ends with `agentdesk: state done declared <b64("Fake agent finished")>`; `--fake-background` emits `agentdesk: state waiting background`, then after `FAKE_TURN_MS` a wake-up `working` and the normal end.
  - `buildPrompt` returns exactly five lines; line 5, exact copy: ``Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.``

- [x] **Step 1: Write failing tests:** update `fake-gateway.test.ts` expectations to the new lines (keep the "typed line queues a turn" test, now asserting `state working` between two ends); add `'--fake-done ends the turn with state done'`; prompt test asserts five lines and the exact line 5.
- [x] **Step 2:** Run `pnpm --filter @agentdesk/core test` → FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `pnpm --filter @agentdesk/core test` → PASS.
- [x] **Step 5:** Commit `feat(core): fake pod and prompt speak the agent state protocol`.

---

## PR C — worker (`review:sensitive`)

### Task 6: Workflow — agent state signal, done phase, finish update, timers

**Files:**
- Modify: `apps/worker/src/workflows/signals.ts`, `apps/worker/src/workflows/run.workflow.ts`, `packages/core/src/temporal-names.ts`
- Test: `apps/worker/test/run.workflow.test.ts`, `apps/worker/test/gate.workflow.test.ts` (signal-name equality)

**Interfaces:**
- Produces:
  - `SIGNAL.agentState = 'agentState'`; `agentState = defineSignal<['working' | 'waiting' | 'needs_input' | 'done']>('agentState')`.
  - `UPDATE = { finishRun: 'finishRun' }` in `temporal-names.ts`; `finishRun = defineUpdate<FinishRunResult>('finishRun')` with `FinishRunResult = { accepted: true }`.
  - `RunPhase` gains `'agent_done'` (the existing `'done'` means the workflow ended; do not reuse it).
  - Behaviour:
    - `agentState('working'|'waiting')` = today's `resumed` (from `idle` or `agent_done` → `running`, workflow writes `running`).
    - `agentState('needs_input')` = today's `turnFinished` (→ `idle`, idle-fix rewrite as today).
    - `agentState('done')` → `agent_done`; the idle-fix rewrite writes `done` instead of `idle` when the phase is `agent_done`.
    - Idle timer runs when phase ∈ {`idle`, `agent_done`} and `attached === 0`; ends `succeeded` as today.
    - `finishRun` validator throws `ApplicationFailure.nonRetryable('Only a run that needs you or is done can be finished (phase is <phase>)', 'NotFinishable')` unless phase ∈ {`idle`,`agent_done`} and not ending; handler sets `finishRequested` and waits (`condition`) until `ending` is true, then returns `{ accepted: true }`.
    - Hard timeout while `agent_done` → outcome `succeeded` (record the phase when `stop('timed_out')` fires).
  - Legacy handlers stay registered for old histories: `turnFinished`, `resumed`, `finish` (the `finish` signal now accepts `idle` or `agent_done`).

- [ ] **Step 1: Write failing tests** in `run.workflow.test.ts`:
  - `'agentState done → done status; idle timer → endSession → succeeded'`
  - `'agentState waiting keeps running and never starts the idle timer'`
  - `'agentState working while done writes running and stops the idle timer'` (Review Focus 5)
  - `'finishRun in idle and in done → accepted, endSession, succeeded'`
  - `'finishRun while running is rejected with NotFinishable and the run keeps going'` (Review Focus 2)
  - `'hard timeout while done → succeeded; while idle → timed_out'`
  - existing `'replay: …'` test still passes with the unchanged fixtures.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/worker test -- run.workflow` → FAIL.
- [ ] **Step 3:** Implement. If the replay test reports nondeterminism, gate the new command-producing paths with `patched('agent-status-v1')`.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/worker test` → PASS.
- [ ] **Step 5:** Commit `feat(worker): done phase, agent state signal and finish update`.

### Task 7: followPodLogs — map protocol lines to status

**Files:**
- Modify: `apps/worker/src/activities/run.activities.impl.ts` (the `turn_started` / `turn_finished` branches, ~lines 663–686)
- Test: `apps/worker/test/run.activities.int.test.ts`, `apps/worker/test/run.e2e.int.test.ts`

**Interfaces:**
- Consumes: `ParsedLogLine.agent` (Task 4), `setRunStatusTx` inputs (Task 3), `SIGNAL.agentState` (Task 6).
- Produces, for each `agent_state` line (stored once with `storeLineEvent`, kind `agent_state`, payload `{ state, source, waitingOn }` — the note is not stored in the event):
  - `working` → `running`, `waitingOn: null`; `waiting` → `running`, `waitingOn: 'background'`; `needs_input` → `idle`; `done` → `done`. `onlyFrom: ['starting','running','idle','done']`.
  - `agentNote` = `redact(note, secrets)` (same `secrets` the activity uses for scrollback) before `setRunStatusTx`.
  - Signal `agentState` with the state when the line was first stored, or (replay) when the current status still equals the mapped status — same rule as today's `turn_finished`.

- [ ] **Step 1: Write failing tests:**
  - `'done line writes done with a redacted note and signals agentState done'` (note contains the run token → stored as the redaction marker; Review Focus 1)
  - `'waiting line writes running with waitingOn background'`
  - `'legacy turn finished still writes idle and signals'`
  - `'replayed done line does not re-signal after the run moved on'`
  - in `run.e2e.int.test.ts`: remove the "wait until the workflow itself has seen the turn end" workaround and assert finish still succeeds (now through `finishRun`).
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/worker test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/worker test` → PASS.
- [ ] **Step 5:** Commit `feat(worker): map agent state lines to run status`.

---

## PR D — api (`review:sensitive`: terminal)

### Task 8: Finish via update; done counts as live

**Files:**
- Modify: `apps/api/src/runs/runs.service.ts` (`finish`), `apps/api/src/projects/projects.service.ts` (`LIVE_STATUSES`, `running` count), `apps/api/src/terminal/terminal-targets.ts` (`active`)
- Test: `apps/api/test/runs*.int.test.ts` (the existing finish tests), `apps/api/test/projects.int.test.ts`, `apps/api/test/terminal.int.test.ts`

**Interfaces:**
- Consumes: `FINISHABLE_RUN_STATUSES` (Task 2), `UPDATE.finishRun` (Task 6).
- Produces:
  - `finish`: 409 when the DB status is not in `FINISHABLE_RUN_STATUSES` (message `Only a run that needs you or is done can be finished (status is <status>)`); otherwise `getHandle(id).executeUpdate(UPDATE.finishRun)`; a `WorkflowUpdateFailedError` whose cause type is `NotFinishable` → 409 with the workflow's message; `WorkflowNotFoundError` → 409 `Run is no longer active` (as today).
  - `done` is live (`LIVE_STATUSES`, `running` count) and terminal-attachable (`active`); `needsYou` still counts only `idle`.

- [ ] **Step 1: Write failing tests:** `'finish in done → 204'`, `'finish rejected by the workflow → 409 with its message'` (stub the Temporal handle as the existing tests do), `'done run counts as running, not needs you'`, `'terminal attach allowed for a done run'`.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/api test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/api test` → PASS.
- [ ] **Step 5:** Commit `feat(api): finish runs through the workflow update; done is live`.

---

## PR E — web + e2e

### Task 9: Web — Done status, notes, Finish from Done

**Files:**
- Modify: `apps/web/src/ds/tokens.ts` (`RunStatus`, `RUN_STATUSES`, `statusTokens.done = { label: 'Done', colorVar: '--ok' }`), the `StatusIcon` icon map, `apps/web/src/features/runs/map.ts` (`statusNote`), `apps/web/src/features/runs/detail.map.ts` (`'done'` case → `'RunIdle'`-like key `'RunDone'`), `apps/web/src/screens/RunDetail.tsx` (Finish enabled when status ∈ `FINISHABLE_RUN_STATUSES`), `apps/web/src/screens/RunTerminalArea.tsx` (Done banner), `apps/web/src/mocks/**` (MSW DTOs gain `waitingOn`, `agentNote`, a done run), stories for the Done banner and Done badge.
- Test: `apps/web/src/features/runs/map.test.ts`, `detail.map.test.ts`, `apps/web/src/ds/*.test.tsx`, `apps/web/src/mocks/msw/contract.test.ts`

**Interfaces:**
- Consumes: `RunDto.waitingOn`, `RunDto.agentNote`, `FINISHABLE_RUN_STATUSES`.
- Produces (exact copy):
  - Running with `waitingOn: 'background'` → status note `Waiting on background work`.
  - Done note → `Done ${n}m ago. Auto-finish after ${IDLE_END_MINUTES}m unattended`.
  - Done banner title `The agent says the task is done`; body: the agent note (plain text) if present, then `Review the work, type in the terminal to ask for changes, or Finish to end the run as succeeded.`; action `Finish run`.
  - Needs-you banner title changes to `The agent is waiting for your answer` and shows the agent note above the existing body.
  - "Finishing…" clears and the error toast shows on a 409 (existing `onError` path).
  - `applyRunStatus` (`apps/web/src/features/runs/applyEvents.ts`) copies `waitingOn` and `agentNote` from `RunStatusEvent` into cached runs.

- [ ] **Step 1: Write failing tests:** status note for `waitingOn`, Done note, `runDetailKey('done', …)` → `'RunDone'`, Finish button enabled for `done` and disabled for `running`, agent note rendered as text (a note containing `<b>x</b>` shows literally), MSW contract test with the new fields.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/web test` → FAIL.
- [ ] **Step 3:** Implement with design tokens only; add stories `RunTerminalArea/Done`, `RunTerminalArea/NeedsYouWithNote`, `StatusBadge/Done`.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/web test` and `pnpm --filter @agentdesk/web typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(web): show done runs, agent notes and finish from done`.

### Task 10: E2E — Finish from Needs you and from Done

**Files:**
- Modify: `apps/web/e2e/local/run.spec.ts`, `scripts/e2e-local.ts`

- [ ] **Step 1:** Update the existing local spec's lifecycle check from `turn_finished` events to `agent_state` events with `state: 'needs_input'`; keep "Finish from Needs you → succeeded".
- [ ] **Step 2:** Add test `'a --fake-done run shows Done and Finish closes it as succeeded'`, and in `scripts/e2e-local.ts` a scenario `done: comment with --fake-done -> run done -> finish -> succeeded`.
- [ ] **Step 3:** Run `devbox run dev` then `devbox run e2e-local` → all scenarios PASS (see `docs/runbooks/tests-and-e2e.md`).
- [ ] **Step 4:** Commit `test(web): e2e finish from needs you and from done`.

---

## PR F — runner adapter (`review:sensitive`) + docs

### Task 11: Claude Code adapter and declare command

**Files:**
- Create: `images/runner/agentdesk-status.mjs` (agent-neutral declare command)
- Create: `images/runner/agents/claude/hook.mjs`, `images/runner/agents/claude/managed-settings.json`
- Modify: `images/runner/settings.json` (remove `hooks`; keep `skipDangerousModePermissionPrompt`), `images/runner/Dockerfile`
- Create: `images/runner/test/fixtures/claude-hooks/*.json` (payloads captured in the spike, paths replaced with `/workspace/repo`), `images/runner/test/claude-hook.test.ts`, `images/runner/test/agentdesk-status.test.ts`

**Interfaces:**
- Consumes: protocol (Global Constraints).
- Produces:
  - Env: `AGENTDESK_STATE_DIR` (default `/home/runner/.agentdesk`), `AGENTDESK_STATUS_OUT` (default `/proc/1/fd/1`). State file `state.json`: `{ declared?: { state: 'done' | 'needs_input'; summary: string }, last?: string }` (`last` = last emitted state word).
  - `agentdesk-status <done|needs_input> "<summary>"`: validates args (else usage on stderr, exit 2), writes `declared`, prints `status recorded: <state>`; never writes protocol lines.
  - `hook.mjs`: reads one JSON object from stdin (invalid JSON → exit 0, emit nothing), dispatches on `hook_event_name`, appends protocol lines to `AGENTDESK_STATUS_OUT`, and for a block prints `{"decision":"block","reason":"<copy>"}` on stdout. Rules, top to bottom (spec §6.2):
    1. `UserPromptSubmit` → clear `declared`; emit `working`.
    2. `PreToolUse` `AskUserQuestion` → `needs_input question <questions[0].question>`; `PostToolUse` `AskUserQuestion` → `working`.
    3. `PreToolUse` other tool and `last !== 'working'` → `working`.
    4. `Notification` `permission_prompt`|`elicitation_dialog` and `last` is not a `needs_input` → `needs_input approval <message>`.
    5. `Stop` with `declared` → `done|needs_input declared <summary>`, clear `declared`.
    6. `Stop` with non-empty `background_tasks` or `session_crons` → `waiting background`.
    7. `Stop`, `stop_hook_active` false → block; reason, exact copy: ``Before ending your turn, run `agentdesk-status done "<summary>"` if the task is complete, or `agentdesk-status needs_input "<the question>"` if you need an answer from the human. Then end your turn.``
    8. `Stop`, `stop_hook_active` true → `needs_input undeclared <last_assistant_message>`.
    9. `StopFailure` → `needs_input error -`. Anything else → nothing.
  - Notes are passed through a `toAgentNote`-equivalent (one line, 500 chars) then base64; untrusted text never reaches a shell.
  - Dockerfile: `ENV DISABLE_AUTOUPDATER=1`; copy `agentdesk-status.mjs` to `/usr/local/lib/agentdesk/` with an executable wrapper `/usr/local/bin/agentdesk-status` (`exec node /usr/local/lib/agentdesk/agentdesk-status.mjs "$@"`); copy `hook.mjs` to `/usr/local/lib/agentdesk/agents/claude/`; copy `managed-settings.json` to `/etc/claude-code/managed-settings.json` (root-owned, 0644) registering `UserPromptSubmit`, `PreToolUse` (matcher `*`), `PostToolUse` (matcher `AskUserQuestion`), `Notification`, `Stop`, `StopFailure` → `node /usr/local/lib/agentdesk/agents/claude/hook.mjs`.

- [ ] **Step 1: Write failing tests** in `claude-hook.test.ts` (run `hook.mjs` with a temp state dir and temp out file, feeding fixtures):
  - the six spike scenarios from spec §3 produce: background shell → `waiting background`; subagent → `waiting background`; wake-up → `working`; AskUserQuestion → `needs_input question …` then `working`; plain question with `needs_input` declared → `needs_input declared …`; done declared → `done declared …`;
  - `'declared done wins over running background tasks'`;
  - `'undeclared stop blocks once with the exact reason, then falls back to needs_input undeclared'`;
  - `'background finishes after done: working, then done again on the next declared stop'` (Review Focus 3);
  - `'a tool call after done emits working once; the next tool call emits nothing'` (Review Focus 4);
  - `'permission_prompt during an open question emits nothing more'`;
  - `'note with newline, 10 kB and $(rm -rf /) is one line, ≤500 chars, base64, and nothing is executed'`;
  - `'invalid JSON on stdin emits nothing and exits 0'`.
  - `agentdesk-status.test.ts`: valid states write `declared`; bad state → exit 2 and no write.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/runner test` → FAIL.
- [ ] **Step 3:** Implement scripts, settings and Dockerfile.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/runner test` → PASS; `podman build -t agentdesk-runner:dev images/runner` succeeds and `podman run --rm --entrypoint sh agentdesk-runner:dev -c 'ls -l /etc/claude-code/managed-settings.json && command -v agentdesk-status'` shows both.
- [ ] **Step 5:** Manual smoke (record in the PR): run the image against a scratch repo with a real token, give a prompt that backgrounds `sleep 30` and then declares done; the run shows Running during the sleep and Done at the end.
- [ ] **Step 6:** Commit `feat(runner): claude code status adapter and agentdesk-status command`.

### Task 12: Docs — bring older docs in line

**Files:**
- Modify: `docs/adr/0011-interactive-claude-code-in-tmux.md` (add under Status: `Partly superseded by [0020](0020-agent-status-protocol.md) (hooks and run status)`), `docs/superpowers/specs/2026-11-12-control-plane-design.md` (§4.1 status line adds `done`; §6.2 main loop events; §8 marker list → protocol lines), `docs/superpowers/specs/2026-11-14-agent-run-status-design.md` (Status: Accepted).

- [ ] **Step 1:** Make the edits; run `devbox run fix` → `fix: clean.`
- [ ] **Step 2:** Commit `docs(adr): point run status docs at ADR 0020`. Ships in PR F.

---

## Final verification

- [ ] `devbox run check` → report real results (format:check is known to fail repo-wide until the one-time reformat; `fix` covers touched files).
- [ ] `pnpm test:unit:coverage` → changed lines ≥ 80%, no package below `coverage-baseline.json`.
- [ ] `devbox run e2e-local` → all scenarios pass, including `done`.

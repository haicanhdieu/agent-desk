# Finish after Re-open keeps the session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish on a session re-opened from a kept succeeded session re-parks the run with its original deadline instead of deleting the volume.

**Architecture:** The run workflow remembers the kept `{kind, expiresAt}` while a resumed session is live. On Finish, if that kind is `done` and the deadline is still in the future, it parks again through `parkRun` with a `keepUntil` override. Everything else ends as before. A new `patched()` id guards in-flight runs.

**Tech Stack:** Temporal TypeScript workflows, Drizzle activities, Vitest, MSW, Playwright (mock).

**Spec:** `docs/superpowers/specs/2026-11-20-finish-after-reopen-keeps-session-design.md` (ADR 0030).

## Global Constraints

- Contracts first (AGENTS.md rule 1): no contract change is expected; if one is needed, start in `packages/contracts`.
- Never edit an applied migration; no migration is planned.
- No new dependency. Each task starts with a failing test. No network in tests.
- Retention is never extended: the re-park uses the original `sessionExpiresAt`.
- Cancel, cap drop, expiry and non-`done` Finishes delete the volume as today.

## Review Focus

- Finish exactly at or after the deadline: must delete and end, not re-park.
- Finish twice in a row (Re-open, Finish, Re-open, Finish): second re-park keeps the same deadline.
- Finish after a paused or stopped resume: still deletes (BR-2).
- Per-project cap: a re-parked run counts and can be dropped by the cap.
- Workflow replay: runs started before the patch behave as today (`patched` id).

---

### Task 1: `parkRun` accepts a `keepUntil` deadline

**Files:**
- Modify: `apps/worker/src/activities/session.activity.ts` (`parkRun`)
- Test: `apps/worker/test/session.activity.int.test.ts`

**Interfaces:**
- Produces: `parkRun(ctx, input: { kind; at; reason?; resumeQueued?; podExitCode?; keepUntil?: string })`; when `keepUntil` parses to a time after `at`, it is the stored `sessionExpiresAt`.

- [ ] **Step 1: Write failing tests** `parkRun with keepUntil in the future stores that deadline, not at + keep seconds` and `parkRun ignores a keepUntil that is not after at`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker exec vitest run test/session.activity.int.test.ts -t keepUntil` (source `scripts/runner-env.sh` first). Expected: FAIL.
- [ ] **Step 3: Implement** the optional input and the expiry choice in `parkRun`; the cap logic is untouched.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): parkRun can keep an earlier deadline`.

### Task 2: Workflow re-parks on Finish after a done Re-open

**Files:**
- Modify: `apps/worker/src/workflows/run.workflow.ts`, `apps/worker/src/workflows/park.ts`
- Test: `apps/worker/test/run.workflow.resuming.test.ts`, `apps/worker/test/park.test.ts` (or the existing park unit test file)

**Interfaces:**
- Consumes: `parkRun` `keepUntil` (Task 1).
- Produces: `shouldRepark(input: { finishRequested: boolean; kept: { kind: ParkKind; expiresAt: string } | undefined; nowMs: number }): boolean` in `park.ts`; patch id `finish-reparks`.

- [ ] **Step 1: Write failing tests:** (a) workflow: parked `done` run, Re-open, `finishRun` update → `parkRun:done` count 2, `deleteRunVolume` 0, `postComment:finish` count 1, second `parkRun` input carries the original `keepUntil`, final status stays `succeeded` and the workflow keeps waiting in `parked`; then a second Re-open works. (b) Finish after the deadline passed → `deleteRunVolume` 1 and result `succeeded`. (c) Finish after a paused/stopped resume still deletes (existing tests at ~234/~248 unchanged and green). (d) `shouldRepark` truth table in the park unit test.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/worker exec vitest run test/run.workflow.resuming.test.ts test/park.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement:** add `FINISH_REPARKS_PATCH = 'finish-reparks'` read once beside the other patches; store `resumedKeep` when `resumeAttempt` succeeds (cleared at park and end); in the end-outcome branch call `park(c, 'done', <reason>, undefined, 'off', 0, keepUntil)` when `shouldRepark`; extend `park` with an optional `keepUntil` passed to `act.parkRun` and skip the finish comment in that case. Reason value: reuse an existing `PauseReason` unless the `pause_reason` constraint allows a new one without a migration; note the choice in the PR.
- [ ] **Step 4: Re-run the command.** Expected: PASS; also run `pnpm --filter @agentdesk/worker exec vitest run test/run.workflow.leases.test.ts`.
- [ ] **Step 5: Commit** `feat(worker): finish after re-open keeps the session`.

### Task 3: Web mock and e2e

**Files:**
- Modify: `apps/web/src/mocks/msw/handlers.ts` (`runs.finish`), mock run state if needed
- Test: `apps/web/src/mocks/msw/contract.test.ts` (or nearby), `apps/web/e2e/mock/finish-after-reopen.spec.ts`

**Interfaces:**
- Consumes: mock resume state (what `runs.resume` sets for a done re-open).

- [ ] **Step 1: Write failing tests:** a handler test (re-open a kept succeeded mock run, finish it, `sessionExpiresAt` still set and unchanged, so `canResume` is true) and the mock Playwright spec `TC-1: Finish after Re-open still offers Re-open session` plus `TC-2: a paused run resumed then finished is not re-openable`, following `apps/web/e2e/mock/stop-session.spec.ts`.
- [ ] **Step 2: Run** the handler test with vitest; Expected FAIL. Build and run the spec as in `docs/runbooks/tests-and-e2e.md` §3a (mock); Expected FAIL.
- [ ] **Step 3: Implement** the handler change: when the run was re-opened from a kept succeeded session, `runs.finish` returns it to `succeeded` with the original `sessionExpiresAt`; otherwise `endRun` as today.
- [ ] **Step 4: Re-run both.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): mock finish after re-open keeps the session`.

## Self-review

- Spec coverage: BR-1 → Task 2; BR-2 → Task 2 (c); BR-3 → Task 2 (b) plus unchanged paths; BR-4 → Task 1 (cap untouched) with Review Focus note; TC-1, TC-2 → Task 3; docs → ADR 0030 and spec amendments in this PR.
- Interface names consistent: `keepUntil`, `shouldRepark`, `resumedKeep`, `finish-reparks`.

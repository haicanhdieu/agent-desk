# Finish after Re-open keeps the session — design

Date: 2026-11-20 · Status: approved by the human in the issue #194 session (expiry option 1) · Sensitive: yes (run
workflow and run Job lifecycle; the volume is kept instead of deleted)

Issue: #194. Decision record: [ADR 0030](../../adr/0030-finish-after-reopen-keeps-the-session.md). Builds on the
[pause and resume design](2026-11-15-run-pause-resume-design.md) and the
[stopped session design](2026-11-19-stopped-session-resume-design.md).

## Intent

A user re-opens a successful run, works on it, and presses **Finish run**. Today the run volume is deleted and the
**Re-open session** action disappears, so the retention window the agent promised (`doneKeepSeconds`) is lost. The user
wants to repeat Re-open and Finish while the retained session is still valid.

## Goals

1. **Finish after Re-open re-parks.** A Finish on a session re-opened from a kept succeeded session (kept kind `done`)
   ends the pod, frees the slot, keeps the volume and returns the run to `succeeded` with its session kept.
2. **Original deadline.** The re-parked session keeps the `sessionExpiresAt` it had before the Re-open (human: option 1).
   Repeating Re-open and Finish never extends retention.
3. **Expiry and cancel still delete.** When the deadline passes, or on Cancel or a per-project cap drop, the run ends and
   the volume is deleted as today. A Finish at or after the deadline ends the run and deletes the volume.
4. **Consistent state.** The API `canResume` (succeeded with a future `sessionExpiresAt`) and the run page ("Re-open
   session" shown, no "cannot be resumed" line) follow from the re-parked row; the contracts need no change.
5. **No duplicate comment.** The re-park posts no second finish comment.
6. **Old runs unchanged.** The workflow change sits behind a new `patched()` id.

## Business rules

- BR-1: Finish on a re-opened kept succeeded session keeps the run reopenable until the original deadline.
- BR-2: Finish on a run that was never parked, or resumed from paused or stopped, ends it for good (unchanged).
- BR-3: Cancel, the cap drop and session expiry delete the volume immediately (unchanged).
- BR-4: The per-project cap on kept done sessions applies to the re-parked run.

## Non-goals

- Extending or resetting retention. Changing agent retention settings. Changing Finish for paused or stopped runs.

## Architecture

- `apps/worker/src/workflows/run.workflow.ts`: `resumeAttempt` already receives `kind` and `expiresAt`. Keep them in
  workflow state once the resumed session is up (`resumedKeep: { kind, expiresAt } | undefined`, cleared on park or
  end). In the end-of-session outcome (`endOutcome` caller, around the `pauseResume && ending && parkKind !== undefined
  && !finishRequested` branch), when `finishRequested`, the patch is on, `resumedKeep?.kind === 'done'` and
  `Date.parse(resumedKeep.expiresAt) > Date.now()`, call `park(c, 'done', 'finish', …, keepUntil)` instead of
  returning `succeeded`. `park` skips the finish comment for this case.
- `apps/worker/src/activities/session.activity.ts` `parkRun`: accept an optional `keepUntil: string` (ISO). When
  present and in the future it is the `sessionExpiresAt` (instead of `at + keepSeconds`); the cap logic is unchanged.
  Not reusing `restoreParked`, which appends a `resume_failed` event.
- `apps/worker/src/workflows/park.ts`: a pure helper deciding the re-park so it is unit-testable.
- `PauseReason` gets no new value if `finish` can be avoided; Agent call: reuse `idle_timeout`-style reason only if the
  `pause_reason` constraint forbids a new one (a new reason would need a migration).
- Web: the MSW `runs.finish` handler and the run fixtures mirror the behavior; no contract change.

## UI and Storybook

No new component. The existing kept-session notice and "Re-open session" action show after Finish because the row is
`succeeded` with a future `sessionExpiresAt`. Add a story only if a shared component changes (none planned).

## Testing

- Worker workflow tests (`apps/worker/test/run.workflow.resuming.test.ts`): Finish after a done re-open re-parks
  (`parkRun:done` count 2, `deleteRunVolume` 0, no second finish comment, original expiry passed); a second
  Re-open then works; Finish after the deadline deletes; Finish after a paused or stopped resume still deletes (the
  existing tests at lines ~234 and ~248 stay as they are).
- `parkRun` activity integration test: `keepUntil` future is used; a past `keepUntil` is not used for a kept session.
- Web: MSW contract test and a mock Playwright spec: Finish after Re-open leaves "Re-open session" available.

## E2E requirements

- TC-1: (mock) Open a succeeded run with a kept session, click **Re-open session**, then **Finish run**. Expected:
  the run detail still offers **Re-open session** and does not say it cannot be resumed.
- TC-2: (mock) A paused run that was resumed and then finished no longer offers **Re-open session** (unchanged).

## Needs approval

None: no new dependency.

## Agent calls

- Agent call: no migration; the existing pause reason `idle_timeout` is not reused for this park unless `pause_reason`
  forbids another value — the implementer checks the schema and records the choice in the PR.

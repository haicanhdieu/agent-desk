# 0032. A reopened session keeps the run's result

- Status: Accepted
- Date: 2026-11-21
- Source: issue #203 (reopened session of a succeeded run changes the run's result and blocks reopening again)
- Amends: [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md), [0030](0030-finish-after-reopen-keeps-the-session.md)

## Context

ADR 0022 lets a person reopen the session of a succeeded run whose disk is kept. The run then went back to a live
status and was treated as a fresh run: Cancel wrote `cancelled` and deleted the disk, Stop parked it as `paused` and
later `expired`, a pod crash or an agent question parked it as `paused`, and a time limit wrote `timed_out`. ADR 0030
kept the disk on Finish, but only until the original deadline, so repeated reopens could not extend the keep time.

## Decision

Once a run succeeds, its result is fixed. A reopened session is a flag on top of Succeeded, not a new result.

- New column `runs.reopened_at`, set when a reopen starts and cleared when the run is saved again. The run page shows
  **Succeeded · Session open** while it is set. `reopenedAt` is part of the run DTO and the run status event.
- The one action is **Close session** (`POST /api/runs/:runId/close-session`, permission `run:update`), which replaces
  Finish and Stop. Cancel, Stop and Finish are hidden, the API answers 409 for them (and for Resume) while
  `reopened_at` is set, and the workflow ignores a cancel and refuses `stopSession`.
- Close session, the idle timeout, a pod crash and the time limit all end the same way: the run returns to
  `succeeded`, the disk is kept, the keep time starts again from now (the agent's `doneKeepSeconds`), and no ticket
  comment is posted. Never `paused`, `expired`, `cancelled` or `timed_out`, and no automatic resume. This supersedes
  ADR 0030's "original deadline".
- The status writer refuses any final status other than `succeeded` while `reopened_at` is set. If the workflow itself
  ends (an error, a history too long), `finalize` writes `succeeded` and clears the flag; the disk is deleted because
  no workflow remains to reopen it.
- Reopen is allowed while the status is succeeded, the keep time has not passed, the workflow is still waiting, the
  agent credential exists and a project slot frees up. There is no limit on the number of reopens. When the disk is
  gone, Reopen is disabled with a tooltip and the tab reads "Transcript (read-only)".
- Finish on a fresh live Done run (never parked, never resumed from paused) now keeps the disk for the normal keep
  time; when `doneKeepSeconds` is 0 nothing is kept and the page shows "Reopen unavailable".
- Events: `session_reopened` and `session_closed` (`how`: `person`, `idle`, `crash`, `time_limit`).
- Workflow changes sit behind `patched('reopen-keeps-result')`; runs already in flight replay and behave as before.

## Alternatives considered

| Alternative                                                 | Why rejected                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Keep a new status for a reopened run                        | Every status switch (API, SSE, web, reconcile) needs a new case for no gain.  |
| Keep the original deadline on every close (ADR 0030)        | Retention would not renew; the person asked to reopen repeatedly.             |
| Let Cancel in a reopened session end the run as `cancelled` | Contradicts "the result is fixed"; the disk and the earlier success are lost. |

## Consequences

- The live status of a reopened run stays `queued`/`starting`/`running`/`idle`/`done`; only the flag and the page's
  pill say it is a succeeded run. Slot, idle timer and terminal rules are unchanged.
- ADR 0030's re-park at the original deadline stays only for runs started before this change.
- Migration `0028_runs_add_reopened_at` adds the nullable column; no backfill.

# 0030. Finish after Re-open keeps the session until its original deadline

- Status: Accepted
- Date: 2026-11-20
- Source: [Finish after Re-open design](../superpowers/specs/2026-11-20-finish-after-reopen-keeps-session-design.md) (issue #194)
- Amends: [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md), [0024](0024-transient-cluster-errors-never-end-a-run.md)

## Context

A succeeded run keeps its session (the run volume) for the agent's `doneKeepSeconds`, and the person can press
**Re-open session**. Today **Finish run** on that re-opened session ends the run for good and deletes the volume, so the
person cannot re-open it again inside the retention window they were promised. ADR 0024 lists "a person (cancel or
finish)" as an end that deletes the volume; the 2026-11-19 spec made "Finish stays final" a goal.

## Decision

- A Finish on a session that was re-opened from a kept succeeded session (kept kind `done`) ends the pod, then parks the
  run again: status `succeeded`, session kept, volume kept. It keeps the original `sessionExpiresAt`; repeating
  Re-open and Finish never extends retention (human, issue #194 thread: option 1).
- If the original deadline has already passed at Finish, or nothing is kept, Finish ends the run and deletes the volume
  as before.
- Unchanged: a Finish on a run that was never parked, a Finish on a run resumed from `paused` or stopped, Cancel, the
  per-project cap drop and session expiry. They end the run and delete the volume.
- The per-project cap on kept done sessions still applies to the re-parked run.
- No second finish comment is posted for the re-park.
- Workflow change is gated by a new `patched()` id so runs already in flight keep today's behaviour.

## Alternatives considered

| Alternative                                         | Why rejected                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Fresh keep time at each Finish                      | Retention would be unbounded for a user who keeps re-opening; disk is held. |
| Fresh keep time, capped at one keep from first done | More state to carry for a small gain; not what the ticket's wording asks.   |
| Keep the volume after every Finish                  | Reverses "Finish stays final" for runs that were never kept; out of scope.  |

## Consequences

- Amends the "a person finish deletes the volume" line of 0024 and the Finish rows of 0022 for the re-opened `done` case.
- The 2026-11-19 and 2026-11-15 specs are amended in the same change.
- A re-opened session can be finished many times; each Finish re-parks, so the pod and slot are freed each time.

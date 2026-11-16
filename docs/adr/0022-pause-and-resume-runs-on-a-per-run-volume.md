# 0022. Pause idle runs and resume them on a per-run volume

- Status: Accepted
- Amended by [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md) (the entrypoint owns the end of the pod)
- Date: 2026-11-15
- Source: [Pause and resume design](../superpowers/specs/2026-11-15-run-pause-resume-design.md); issue #50
- Amends: [0010](0010-one-kubernetes-job-per-run.md) (one Job per run), [0020](0020-agent-status-protocol.md) (`done` and `idle` both end as `succeeded`)

## Context

A run that waits for a person (`idle`) or that the agent declared finished (`done`) is ended after 10 minutes with
nobody attached. Freeing the slot is right, but both cases were written as `succeeded`, so a run with an unanswered
question looked finished. The pod workspace was an `emptyDir` and the Job was deleted, so the conversation and every
unpushed file were gone and the person could not come back to the session.

## Decision

Give every run its own volume and keep it while the run can still be resumed.

- Each run gets a `PersistentVolumeClaim` named like its Job and Secret (`run-{runId}`), mounted once at `/workspace`
  (repo in `/workspace/repo`, runner home `HOME=/workspace/home`). It replaces the `emptyDir` workspace.
- When the idle timer fires, the workflow ends the session, deletes the Job and the Secret, keeps the volume, frees the
  slot and stays open. A run that was `idle` becomes `paused`; a run that was `done` becomes `succeeded` with a kept
  session. `pausedAt` and `sessionExpiresAt` record when and until when.
- Two new statuses: `paused` (not active, not final) and `expired` (final). `succeeded` with a kept session is the one
  final status that can go back to `queued`.
- `POST /api/runs/:runId/resume` (same authorization as Finish) re-queues through the project gate and starts a new Job
  on the same volume with `RUN_MODE=resume`. The runner skips clone, plugins and setup and runs the agent's resume
  command (`claude --continue` for Claude Code). A kept session is given up only once the resumed session is up.
- Keep times are agent settings: `pausedKeepSeconds` (default 7 days, 1 hour to 30 days) and `doneKeepSeconds` (default
  1 day, 0 to 7 days, 0 keeps nothing). Every kept session expires and its volume is deleted.
- Run volumes use their own storage class (`agentdesk-run-volumes`, `reclaimPolicy: Delete`), not the cluster default
  that retains data.
- New workflow code is guarded with `patched('pause-resume')`; runs started before the deploy keep today's behaviour.

## Alternatives considered

| Approach                                                                                    | Trade-off                                                                                                     | Verdict                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Keep the disk, drop the pod: per-run volume, resume starts a new pod on it               | Pause and resume in seconds, exact files, one new part. Full uncompressed size per kept run; tied to one node | **Chosen.** Fewest new parts, fits the single-node PoC                  |
| 2. Pack and store: archive the folders in a file store, delete everything, unpack on resume | Much less disk, works across nodes. Needs a file store plus upload and download steps; minutes to resume      | Not now. Can be added later behind the same statuses if disk gets tight |
| 3. Freeze the live pod (container checkpoint)                                               | Only way to keep running processes. No built-in restore in Kubernetes; unlikely to work on k3s-in-Podman      | Rejected                                                                |

## Consequences

- `--continue` is unproven on the pinned Claude Code version until the spike (plan Task 0) is run; if it fails the
  design returns for review.
- Open question menus are not restored; the person sees the last question as text and types the answer.
- Volume size is not enforced on `local-path`: one run can use more than the requested 4Gi. Accepted for the PoC; a
  storage class with quotas fixes it later.
- A `local-path` volume lives on one node. More nodes need shared storage or approach 2.
- A resumed pod uses the current runner image; a newer agent CLI may not read an older session. Not guarded.
- Each pause and resume adds events to the same workflow; the existing 45,000-event guard still applies.
- The worker Role in `agentdesk-runs` gains `persistentvolumeclaims` (create, get, list, delete); the storage class and
  Role must be live before the worker that creates volumes.
- Every place that treats final as "never changes" must check for a kept session first.

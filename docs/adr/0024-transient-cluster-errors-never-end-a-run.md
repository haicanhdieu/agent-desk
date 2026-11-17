# 0024. Transient cluster errors never end a run

- Status: Accepted
- Date: 2026-11-17
- Source: [Follower reconnect design](../superpowers/specs/2026-11-17-follower-reconnect-design.md) (issue #89)
- Amends: [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md)

## Context

Run #15 lost 14 minutes of work. A short loss of connection to the Kubernetes API made the log follower and the run
Job's cluster calls throw; the workflow read that as a dead pod, failed a healthy run and deleted its workspace volume.
A connection error says nothing about the pod.

## Decision

- The follower and the run Job's cluster calls retry without a retry limit when the error is a lost connection
  (refused, reset, timed out, 5xx). A cluster 4xx answer is a real answer and is not retried.
- The follower reconnects with jittered backoff and continues from its last durable line. The run's events say when
  contact was lost (`contact_lost`) and when it came back (`contact_restored`).
- A connection lost for longer than the reconnect window (30 minutes, `RUN_RECONNECT_WINDOW_SECONDS`) parks the run
  with `pauseReason=pod_lost`: the Job is deleted once the API answers, the slot is freed and the volume is kept, so
  the run can be resumed.
- Only these end a run: an exit code, a pod confirmed gone (the cluster answered and lists no pod for the Job), a
  person (cancel or finish), the hard timer, or session expiry. `deleteRunVolume` runs only for these.

## Alternatives considered

| Alternative                                                                                 | Why rejected                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Make only the follower's Temporal retry unlimited                                           | No reconnect events, every try logs as a failure, and the window needs bookkeeping in the flow                                                  |
| A separate health-check activity that signals the workflow                                  | Two moving parts that can disagree (ping ok, stream broken); more complexity for no gain                                                        |
| Fail fast after a fixed retry cap, or skip `deleteRunVolume` only when the pod did not exit | A cap still ends healthy runs in a long outage; the plan ties deletion to the definitive end signals, so the volume is kept in every other case |

## Consequences

### Positive

- An outage shorter than the window is invisible to the run's outcome, with no missed or duplicated events.
- A longer outage parks the run with its volume kept, so the work can be resumed.
- A worker restart no longer spends a retry budget that can fail the run.

### Negative

- A run that hits its time limit during an outage holds its slot until the cluster answers.
- The reconciler still has to sweep leftover Jobs and volumes once the cluster is back.
- A heartbeat-restored outage stays open until the first log line or a clean stream end.

The fake cluster has an outage switch (`<state dir>/kube/.outage`) so the local e2e can exercise both paths.

## Links

- [Follower reconnect design](../superpowers/specs/2026-11-17-follower-reconnect-design.md)
- [Follower reconnect plan](../superpowers/plans/2026-11-17-follower-reconnect.md)
- Issue #89
- Related ADRs: [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md), [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md)

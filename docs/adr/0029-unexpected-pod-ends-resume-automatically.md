# 0029. Unexpected pod ends resume automatically, up to a per-agent limit

- Status: Accepted
- Date: 2026-11-20
- Source: [Automatic resume after an unexpected pod end](../superpowers/specs/2026-11-20-pod-crash-auto-resume-design.md)
- Amends: [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md)

## Context

[0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md) made the runner entrypoint own the end of a pod, and a pod
that died after the agent started parks the run as paused (`pod_lost` or `agent_crashed`) with its session kept. A
person had to press Resume every time, even for a pod killed for memory or lost with its node, so a run could sit
paused for hours.

## Decision

A run whose pod ends unexpectedly after the agent started resumes by itself through the existing Resume path.

- **What counts (U1 to U5):** the pod was killed by the system, the pod was lost, the pod was shut down from outside,
  the agent's terminal session died, or the agent CLI crashed. These are exactly the parks with `pauseReason`
  `pod_lost` or `agent_crashed`. A person's Stop, Finish or Cancel, the idle timer, agent exit 0, any failure before
  the session started, and a resume with no saved session are never resumed automatically.
- **Approach A, reuse pause and resume:** park the run as today, then start the existing resume attempt at once. It
  reuses the gate, the volume, the failure fallback and the cancel rules.
- **The count and its reset:** each agent has `autoResumeMax` (0 to 10, default 5; 0 turns it off). The workflow counts
  automatic tries in a row. Typing in the terminal (the `personInput` signal) or a person pressing Resume starts the
  count again. At the limit the run stays paused, with a `auto_resume_gave_up` event and the paused comment.
- **The note:** every resume after an unexpected end gives the agent one short fixed note (`RESUME_NOTE`) that holds
  fixed text, an integer exit code, a checked cluster reason word and the memory limit, never pod output, ticket text
  or repo text.
- **A pod that could not start:** a try whose pod could not start counts as a try and is retried after a wait of 1, 2,
  4, 8 minutes, then 10 minutes at most, on a durable workflow timer. Finish, Cancel, a person's Resume and the kept
  session's expiry all end the wait. When the kept session would expire before the next wait ends, there is no retry and the paused comment
  is posted once. "No saved session" and "agent or credential missing" are never retried.
- **Cancel during an automatic try cancels the run.** No session is up and no person asked for the resume, so there is
  nothing to take back; a person's own Resume still only gives up the resume on Cancel.
- **Rollout:** all workflow changes sit behind `patched('auto-resume')`, so runs that started before the deploy keep
  today's behaviour. The runner image goes live before the worker sends `RESUME_NOTE`.

## Alternatives considered

| Alternative                                                                | Why rejected                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B. Restart in place while keeping the slot                                 | A second resume code path to keep in step with the first                               |
| C. Kubernetes Job `backoffLimit`, with the runner switching to resume mode | Fights 0023, the workflow follows one pod, and the count would be a deployment setting |

## Consequences

### Positive

- A crashed run needs no person unless it keeps crashing; the limit stops a crash loop and the event log shows every
  automatic try.
- A browser tab left open on a crashing run never resets the count: only input that still has bytes after terminal
  control sequences are stripped counts as typing.

### Negative

- The slot is freed and requested again for each try, so at the project's run limit a try may wait in the queue.

## Links

- [Automatic resume after an unexpected pod end](../superpowers/specs/2026-11-20-pod-crash-auto-resume-design.md)
- Related ADRs: [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md)

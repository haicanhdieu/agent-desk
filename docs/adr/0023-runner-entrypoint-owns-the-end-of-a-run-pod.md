# 0023. The runner entrypoint owns the end of a run pod

- Status: Accepted
- Date: 2026-11-16
- Source: [Run terminal lifecycle redesign](../superpowers/specs/2026-11-16-run-terminal-lifecycle-redesign.md) §3, §4
- Amends: [0011](0011-interactive-claude-code-in-tmux.md), [0014](0014-terminal-over-websocket-exec-relay.md),
  [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md)

## Context

The worker ended a session by killing the tmux session from outside, and the entrypoint guessed that the session ended
from `tmux display-message` output. With stale `tmux attach` clients holding the tmux server up, the guess was wrong,
the pod never exited and the run stayed in `ending` forever. Closing an exec stream does not kill its process in the
pod. An unexpected pod death failed the run and deleted its volume although the conversation was on disk.

## Decision

The entrypoint is the only owner of the pod's exit.

- The worker asks for an end with one fixed in-image command (`agentdesk-end`); Job deletion (SIGTERM) takes the same
  path. The entrypoint saves the scrollback, runs `tmux kill-server` and prints one
  `agentdesk: session ended reason=… code=…` line, then exits.
- The workflow's `ending` phase has a deadline; after it the Job is deleted and the run is parked anyway.
- A pod that ends without that line after the session started is parked as `paused` (`pauseReason=pod_lost`), never
  failed with its volume deleted.
- Each terminal socket gets its own attach client (`agentdesk-attach <uuid>`), killed on close (`agentdesk-detach`).
  Attach state in the workflow is a set of leases that expire, not a counter.

## Alternatives considered

| Alternative                                             | Why rejected                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| Keep killing tmux from outside, only fix the loop check | Still guesses from tmux; no way to tell pod loss from a clean end |
| Always delete the Job, no graceful end                  | Scrollback depends on the kill grace; every end looks like a kill |
| Detach tmux clients by tty                              | The API cannot reliably learn the client tty through exec         |

## Consequences

### Positive

- A run cannot stay in `ending` for more than about two minutes.
- Pod loss no longer destroys a session someone can resume.
- No leaked attach processes; an API crash no longer blocks the idle timer forever.

### Negative

- More runner scripts and an image rollout before API/worker changes; a fallback for older pods for 7 days.
- Lease signals add a few hundred workflow events per attached day.

## Links

- [Run terminal lifecycle redesign](../superpowers/specs/2026-11-16-run-terminal-lifecycle-redesign.md)
- Related ADRs: [0010](0010-one-kubernetes-job-per-run.md), [0020](0020-agent-status-protocol.md)

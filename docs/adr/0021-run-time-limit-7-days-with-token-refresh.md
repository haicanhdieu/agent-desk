# 0021. Run time limit up to 7 days, with the workspace token refreshed inside the running pod

- Status: Proposed
- Date: 2026-11-15
- Source: [Run time limit design](../superpowers/specs/2026-11-15-run-time-limit-design.md) §2, §3; issue #34

## Context

[0010](0010-one-kubernetes-job-per-run.md) caps `timeout_seconds` at 3300 so the one-hour, single-repo workspace token
outlives the run. Agent runs are useful for a day or more. The token reaches the pod through `envFrom` and inside the
git remote URL, and a container's environment never changes after it starts, so updating the Secret alone cannot
rotate it. GitHub installation tokens cannot be made longer than 1 hour.

## Decision

Raise the limit to 7 days (604800 s, default 24 h) and keep the one-hour token rule by rotating the token in the
running pod.

- The token moves out of env into a separate Secret `run-{runId}-token`, mounted as a directory (no `subPath`) so the
  kubelet updates the file.
- The runner reads it on each use: a git credential helper and a `gh` wrapper.
- A Temporal loop in the run workflow calls `refreshWorkspaceToken` every 45 minutes. The token is minted inside the
  activity and written to the Secret; it never enters workflow history.
- `activeDeadlineSeconds` stays `timeout_seconds + 120`, with no 3300 clamp.
- Each token is still single-repo, minimum permission and at most 1 hour. The pod is not restarted.

This supersedes the 3300 s cap and "keep `timeout_seconds` ≤ 3300 so the token stays valid" in 0010 and in
`docs/conventions/security.md` §4. The rest of 0010 stands.

## Alternatives considered

| Alternative                                        | Why rejected                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| One long-lived token                               | GitHub installation tokens cannot outlive 1 hour; a long-lived credential also breaks the single-repo ≤ 1 h rule |
| Chain pods, each under 55 min                      | Breaks one Job per run; loses the agent session, unpushed files and the attached terminal at every hop           |
| Update only the Secret that `envFrom` reads        | The running container's env does not change, so the pod would keep an expired token                              |
| Raise the cap a little and keep tokens as they are | Does not meet the 7-day goal                                                                                     |

## Consequences

### Positive

- Runs can last as long as the work needs, in one pod, with live terminal and session state intact.
- The token an attacker could read from the pod is never valid for more than 1 hour.
- Env no longer carries the token, so it is not in the Job's container env.

### Negative

- New moving part: a durable refresh loop. A missed refresh means pushes fail once the token expires (the run is
  not killed).
- The runner image changes (credential helper, `gh` wrapper); a custom runner image must do the same.
- Rotated tokens are redacted from logs by token-shaped patterns, not by an exact-match list.
- The workflow change needs `patched()` for in-flight runs.
- A 7-day run holds a concurrency slot for its whole life.

## Links

- [Run time limit design](../superpowers/specs/2026-11-15-run-time-limit-design.md)
- Amends: [0010](0010-one-kubernetes-job-per-run.md); [security conventions](../conventions/security.md) §4
- Related: [0012](0012-credentials-in-kubernetes-secrets.md), [0009](0009-temporal-for-durable-work.md)

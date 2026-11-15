# 0021. Run time limit up to 7 days, with the workspace token refreshed inside the running pod

- Status: Accepted
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

- The token moves out of env into its own key (`workspace-token`) of the existing run Secret `run-{runId}`. The Job
  mounts only that key as a file, as a directory volume (no `subPath`) so the kubelet updates it. The Job no longer
  uses `envFrom`: the repo URL and the agent credential are explicit `secretKeyRef` env vars, so the token is never
  an env var.
- The runner reads it on each use: a git credential helper and a `gh` wrapper (`AGENTDESK_TOKEN_FILE`).
- A Temporal loop in the run workflow calls `refreshWorkspaceToken` every 45 minutes (guarded by `patched` so runs
  started earlier replay unchanged). The token is minted inside the activity and written to the Secret with
  `KubeGateway.replaceSecretData`; it never enters workflow history.
- `activeDeadlineSeconds` stays `timeout_seconds + 120`, with no 3300 clamp.
- Each token is still single-repo, minimum permission and at most 1 hour. The pod is not restarted.

This supersedes the 3300 s cap and "keep `timeout_seconds` ≤ 3300 so the token stays valid" in 0010 and in
`docs/conventions/security.md` §4. The rest of 0010 stands.

## Alternatives considered

| Alternative                                        | Why rejected                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One long-lived token                               | GitHub installation tokens cannot outlive 1 hour; a long-lived credential also breaks the single-repo ≤ 1 h rule                                           |
| Chain pods, each under 55 min                      | Breaks one Job per run; loses the agent session, unpushed files and the attached terminal at every hop                                                     |
| Update only the Secret that `envFrom` reads        | The running container's env does not change, so the pod would keep an expired token                                                                        |
| A second Secret `run-{runId}-token`                | `reconcile` treats any Secret whose name is not a Job name as an orphan, so it would delete a live token; one Secret keeps cleanup and reconcile unchanged |
| Raise the cap a little and keep tokens as they are | Does not meet the 7-day goal                                                                                                                               |

## Consequences

### Positive

- Runs can last as long as the work needs, in one pod, with live terminal and session state intact.
- The token an attacker could read from the pod is never valid for more than 1 hour.
- Env no longer carries the token, so it is not in the Job's container env.

### Negative

- New moving part: a durable refresh loop. A missed refresh means pushes fail once the token expires (the run is
  not killed).
- The runner image changes (credential helper, `gh` wrapper); a custom runner image must do the same.
- The redaction list is re-read every 30 s during a run and keeps the first read's values plus the 8 most recent rotated ones. A rotated token is redacted by exact value from the next re-read, normally before the pod's mounted file updates (1-2 min); a value older than about 6 h is no longer in the list (tokens live 1 h).
- The workflow change needs `patched()` for in-flight runs.
- Deploy order matters: the runner image with the token-file support must be live (`RUNNER_IMAGE`) before the worker
  that creates token-file Jobs, or every clone fails.
- A 7-day run holds a concurrency slot for its whole life.
- `RunWorkflow` has no `continueAsNew`. A run whose history reaches 45,000 events (heavy signal traffic over days) is finished as failed with a plain reason so cleanup still runs, instead of being terminated by Temporal at 51,200. A real `continueAsNew` is a follow-up.

## Links

- [Run time limit design](../superpowers/specs/2026-11-15-run-time-limit-design.md)
- Amends: [0010](0010-one-kubernetes-job-per-run.md); [security conventions](../conventions/security.md) §4
- Related: [0012](0012-credentials-in-kubernetes-secrets.md), [0009](0009-temporal-for-durable-work.md)

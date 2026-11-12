# 0010. One Kubernetes Job per run as the sandbox

- Status: Accepted
- Date: 2026-11-11
- Source: PRD (PoC) §3 (Run), G2; Architecture (PoC) §1 "Runs are cattle", §5, §7, §9 (Run isolation); control plane design §6.2, §8; infra design §6.5

## Context

An agent run executes a user-defined skill against a repo, with write access to
that repo, driven by untrusted ticket text (prompt injection is the main risk).
The PRD requires each run to execute in a fresh Kubernetes container with the
repo checked out (G2). The control plane must never execute agent code.

## Decision

Every run is exactly one Kubernetes Job (one pod, one container) in namespace
`agentdesk-runs`, named `run-{runId}`:

- Fresh clone per run; nothing survives except what was pushed and the stored
  run log.
- A per-run Secret holds a one-hour, single-repo workspace token and a copy of
  the agent credential.
- `backoffLimit: 0`, `restartPolicy: Never`, `activeDeadlineSeconds` =
  `timeout_seconds` + 120 as a backstop to the workflow's hard timer
  (`timeout_seconds` ≤ 3300 so the token stays valid).
- Non-root (uid 10001), restricted Pod Security, no service account token,
  `emptyDir` workspace capped at 4 Gi, CPU/memory limits.
- NetworkPolicy: no ingress; egress to the public internet only, blocking
  private ranges, the cluster and metadata endpoints.
- Labels `agentdesk/run-id`, `agentdesk/project-id`, `agentdesk/org-id`;
  orphans are removed by a daily reconcile.

## Alternatives considered

| Alternative                               | Why rejected                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Long-lived agent pods, persistent volumes | Set aside in Architecture §9; revisit when clone and dependency install dominate run time         |
| GitHub Actions as the runner              | Set aside in Architecture §9 (trigger mechanism row); no reason recorded beyond the chosen design |

## Consequences

### Positive

- Strong per-run isolation; a bad run cannot affect the next one.
- Cancel is a Job delete; time, memory and disk are bounded by Kubernetes.
- Runs need no network path back to the control plane.

### Negative

- Cold start (image pull, clone, first event) must fit the 60 s target; measuring it is an open check.
- No dependency caching; project-specific toolchains are baked into one runner image for the PoC.
- Domain-level egress allowlisting is deferred (needs an FQDN-capable CNI).
- The agent can read its Claude credential (known gap; see [0012](0012-credentials-in-kubernetes-secrets.md)).

## Links

- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §2, §3, §6
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §1, §5, §7, §9
- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §6.2, §6.5, §8
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §6.5, §6.6
- Related: [0011](0011-interactive-claude-code-in-tmux.md), [0009](0009-temporal-for-durable-work.md)

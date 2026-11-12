# 0016. QA on a separate k3s container in the Mac mini's shared Podman machine

- Status: Accepted
- Date: 2026-11-12
- Source: infra design §1, §2 (Scope, Hosting on the Mac mini, Kubernetes distribution, Exposure, Capacity), §4, §5.2

## Context

The first environment is QA on a Mac mini (24 GB) that already hosts airi, a
separate product, as k3s inside its only Podman machine. Agent runs execute
untrusted repo code with `bypassPermissions`
([0011](0011-interactive-claude-code-in-tmux.md)). airi must keep its memory,
and Agent Desk must never exceed a cap. The Architecture doc had suggested kind
or k3d locally. QA must receive real webhooks at a public URL.

## Decision

- Scope: QA on the Mac mini built for real; AWS and Azure designed as targets
  only; GitHub Actions CI in scope.
- A separate privileged container `agentdesk-k3s` in the same Podman machine as
  `airiprod-k3s`, started by an engine-agnostic `k3s-up.sh` and a rootful
  Quadlet unit (`Restart=always`).
- k3s everywhere (Mac mini, laptops, CI) at the image digest airi pins.
- Capacity: Podman machine 12 → 16 GiB (disk 100 → 120 GiB), `agentdesk-k3s`
  hard-capped at 4 GiB, 3 CPUs, `system-reserved=12Gi`, one concurrent run; a
  one-line change in airi raises its own `system-reserved` so its scheduler does
  not count Agent Desk's memory.
- Exposure: Agent Desk's own locally-managed Cloudflare Tunnel to
  `qa-desk.myairi.app`; only the API port is published, on 127.0.0.1.

## Alternatives considered

| Alternative                                        | Why rejected                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Namespaces in airi's cluster                       | Untrusted agent code must not share airi's prod cluster                                             |
| kind                                               | Does not reliably survive reboots                                                                   |
| A second Podman machine                            | One VM is all the Mac can afford                                                                    |
| k3d, minikube, Docker Desktop                      | One distribution and one set of flags on Docker and Podman; shared image layers with airi save disk |
| 14 GiB borrowing from airi; 20 GiB                 | Borrowing takes airi's share; 20 GiB leaves the Mac 4 GB                                            |
| LAN only; Tailscale Funnel / ngrok; LAN and public | Own tunnel gives real webhooks, no CA to install, and leaves airi's tunnel untouched                |
| One cloud with IaC now; both clouds now            | Prove the PoC first; a cloud move is adding a target                                                |

## Consequences

### Positive

- Own API server, ingress and policies, isolated from airi.
- airi keeps its full current memory; Agent Desk cannot take more than 4 GiB.
- The same k3s and launcher run on laptops and in CI e2e.

### Negative

- One planned maintenance window on the Mac mini and one change in airi's repo.
- Tight budget: 3.4 GiB of pod limits, one run at a time, `Recreate` rollouts
  with brief downtime; hook Jobs can briefly exceed the budget.
- Open check: `--memory`/`--cpus` caps on rootful Podman inside the macOS VM.

## Links

- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §1, §2, §4, §5.2, §9, §15
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §8 Suggested stack
- Related: [0017](0017-helm-chart-delivered-by-flux.md), [0018](0018-portable-app-layer-target-contracts.md)

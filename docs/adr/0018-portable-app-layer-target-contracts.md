# 0018. Portable app layer: targets supply capabilities behind fixed names

- Status: Accepted
- Date: 2026-11-12
- Source: infra design §1, §2 (Routing, Secrets, Database, Temporal), §3, §8, §11

## Context

airi's deployment is a hand-written CLI bound to its Mac, which makes a move to
a cloud a rewrite. Agent Desk starts on the Mac mini
([0016](0016-qa-on-separate-k3s-in-shared-podman.md)) but AWS and Azure are
designed targets. The infra spec states the rule: a target supplies standard
capabilities, the app consumes only standard interfaces, and there is no custom
deploy code; what differs between targets is data, never code.

## Decision

Three layers: host (the only imperative part), platform (one implementation per
target), app (the chart, platform-neutral). The chart depends only on these
contracts:

- Routing via Gateway API: the platform owns `Gateway/edge` in
  `agentdesk-system`; the chart owns one `HTTPRoute` (`/api`, `/auth`,
  `/webhooks` → api; `/` → web).
- Secrets with fixed names (`agentdesk-db`, `agentdesk-auth`,
  `agentdesk-github-app`): Flux SOPS (age) on the Mac mini, External Secrets
  Operator in the cloud.
- The default StorageClass (never named by the chart), image registry and
  digests, Postgres host (in-cluster StatefulSet or managed), Temporal address
  (in-cluster or Temporal Cloud), service account annotations, OTel endpoint.
- A conftest portability gate (P1–P5) runs on every PR against every target's
  render: neutral chart, hardening, memory budget, secret contract, run sandbox.

## Alternatives considered

| Alternative                           | Why rejected                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Ingress` with controller annotations | Gateway API is supported by Traefik, the AWS Load Balancer Controller and Azure Application Gateway for Containers |
| ESO everywhere; Vault/OpenBao         | No extra pod on the Mac; the app never knows which supplier filled a Secret                                        |
| CloudNativePG; Bitnami Postgres chart | Plain StatefulSet is the smallest footprint; QA data is disposable                                                 |

## Consequences

### Positive

- Moving to EKS or AKS is adding a target (values, platform implementations,
  IaC for the cluster), not changing the app.
- CI proves every target, including AWS and Azure examples, renders and passes
  the gate.

### Negative

- More structure than a single-environment deploy needs today.
- Each target must implement every contract; the gate enforces it.
- No Postgres backups in QA; egress from app pods stays open for the PoC
  because restricting it needs per-target IPs.
- Open checks: k3s bundled Traefik's Gateway API provider and CRDs.

## Links

- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §1, §2, §3, §5, §6.4, §6.7, §8, §11, §15
- Related: [0012](0012-credentials-in-kubernetes-secrets.md), [0016](0016-qa-on-separate-k3s-in-shared-podman.md), [0017](0017-helm-chart-delivered-by-flux.md)

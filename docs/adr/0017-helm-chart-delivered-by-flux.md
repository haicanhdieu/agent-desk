# 0017. One Helm chart delivered by Flux from OCI release bundles

- Status: Accepted
- Date: 2026-11-12
- Source: infra design §2 (Packaging, Delivery, Promotion, QA promotion, Images), §6, §7

## Context

The Architecture doc suggested plain manifests with Kustomize ("Helm is
unnecessary at this size") and loading the runner image without a registry.
The infra design adds many per-target knobs (QA, local, AWS, Azure), a public
QA environment that CI must reach without connecting to the Mac mini, a tight
memory budget, and a requirement that rollback is one workflow run.

## Decision

- Package the app layer as one Helm chart `agentdesk` with a values file per
  target and a `values.schema.json`.
- Images (api, worker, web, runner) are multi-arch (arm64, amd64), pushed to
  GHCR and pinned by digest; the chart is pushed as an OCI artifact.
- Each green `main` commit produces a release bundle `agentdesk-deploy:<sha>`
  (platform manifests, target values, SOPS files, a generated `release.yaml`
  with chart version and digests).
- Flux (source, kustomize and helm controllers, with lowered limits) on the
  cluster pulls the bundle tagged `qa`. Promotion moves the tag; every green
  `main` auto-promotes to QA; rollback is re-tagging a previous sha.
- HelmRelease remediation rolls back a failed upgrade.

## Alternatives considered

| Alternative                                                          | Why rejected                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Kustomize base/overlays (Architecture doc suggestion); Timoni; cdk8s | Many target knobs; a versioned package any cluster can install, consumed natively by Flux and cloud tooling    |
| Argo CD                                                              | Does not fit the memory budget                                                                                 |
| CI pushing `helm upgrade`                                            | CI would have to reach the Mac mini; Flux is pull-based                                                        |
| OpenTofu/Pulumi for apps; Score/Radius                               | Weighed; Flux chosen as pull-based with no deploy CLI, identical on EKS and AKS                                |
| Bot commits digests to Git; Flux image automation                    | Needs write access to Git or extra controllers; re-tagging gives rollback and identical bytes for a later prod |
| Manual promote to QA                                                 | Slower feedback; manual promote stays available for rollback                                                   |
| Local registry; airi's zot                                           | GHCR matches the ECR/ACR flow; airi's registry stays airi's                                                    |

## Consequences

### Positive

- No custom deploy code and no inbound access from CI; only `GITHUB_TOKEN` is used.
- A later prod runs the exact bundle QA tested.
- `flux get` shows the deployed commit.

### Negative

- Flux controllers cost memory in the 4 GiB budget (96 → 352 Mi).
- A GHCR pull token on the cluster must be rotated.
- Open checks: `HelmRelease.chartRef` to an OCIRepository chart, and setting its
  tag from `release.yaml` via a kustomize replacement.

## Links

- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §2, §6, §7, §9, §15
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §8 Suggested stack
- Related: [0016](0016-qa-on-separate-k3s-in-shared-podman.md), [0018](0018-portable-app-layer-target-contracts.md)

# Agent Desk Infra — Design

Date: 2026-11-12 · Status: draft for review · Companions: `docs/Agent Desk — Architecture (PoC).md`, `docs/superpowers/specs/2026-11-12-control-plane-design.md` (backend), `docs/superpowers/specs/2026-11-12-frontend-design.md` (frontend)

## 1. Intent

Agent Desk has three stacks: frontend, backend (control plane), and infra (this spec). This spec covers how the system is packaged, delivered and hosted: images, the Kubernetes cluster, the Helm chart, GitOps delivery, GitHub Actions CI, and the first environment.

The first environment is **QA on the Mac mini**, public at `https://qa-desk.myairi.app`. That machine already hosts airi (another product) as k3s inside its only Podman machine. airi's deployment is a hand-written CLI bound to that Mac, which makes a move to a cloud a rewrite. This design avoids that. **A target supplies standard capabilities, the app consumes only standard interfaces, and there is no custom deploy code.** What differs between targets is data (values files, secrets, host settings), never code.

AWS and Azure are designed here as targets that fill the same contracts. No cloud IaC is built in this spec.

Success for this spec:

- `k3s-up.sh` brings up a working cluster on Docker or Podman. One green commit on `main` reaches QA with no manual step, and a rollback is one workflow run.
- A comment → run → finish flow works through `qa-desk.myairi.app`, including live SSE and the terminal through Cloudflare.
- airi keeps the memory it has today, and Agent Desk can never take more than its cap.
- CI renders every target, including the AWS and Azure examples, through the portability gate on every PR.

## 2. Decisions

| Topic | Choice | Alternatives weighed | Why |
|---|---|---|---|
| Scope | Local QA built for real; AWS and Azure designed as targets with no IaC; GitHub Actions CI in scope | One cloud with IaC now; both clouds now | Prove the PoC first; keep the cloud move to adding a target |
| Hosting on the Mac mini | A separate k3s container `agentdesk-k3s` in the same Podman machine as `airiprod-k3s` | Namespaces in airi's cluster; kind; a second Podman machine | Agent runs execute untrusted repo code with `bypassPermissions`, so they must not share airi's prod cluster. Own API server, ingress and policies. Survives reboots (kind does not reliably). One VM is all the Mac can afford |
| Kubernetes distribution | k3s everywhere (Mac mini, laptops, CI), the same image digest airi pins | kind, k3d, minikube, Docker Desktop | One distribution and one set of flags on Docker and Podman; shared image layers with airi save disk |
| Packaging | One Helm chart `agentdesk` with a values file per target | Kustomize Base/Overlays; Timoni; cdk8s | Many target knobs; a versioned package that any cluster can install; Flux and cloud tooling consume it natively |
| Delivery | Flux (source, kustomize and helm controllers) pulling a release bundle from GHCR | Argo CD; CI pushing `helm upgrade`; OpenTofu/Pulumi for apps; Score/Radius | Pull-based: CI never reaches the Mac mini; no deploy CLI; Flux fits the memory budget, Argo CD does not; identical on EKS and AKS |
| Promotion | Release bundle per commit (`agentdesk-deploy:<sha>`); promote = move the tag `qa` | Bot commits digests to Git; Flux image automation | No write access to Git; rollback is a re-tag; a later `prod` gets the same bytes QA tested; no extra controllers |
| QA promotion | Every green `main` auto-promotes to QA | Manual promote | Fast feedback on the PoC; manual promote stays available for rollback |
| Routing | Gateway API: platform owns `Gateway/edge`, the chart owns `HTTPRoute`s | `Ingress` with controller annotations | Supported by Traefik, the AWS Load Balancer Controller and Azure Application Gateway for Containers |
| Exposure | Cloudflare Tunnel of Agent Desk's own, `qa-desk.myairi.app` | LAN only; Tailscale Funnel / ngrok; LAN and public | Real webhooks; no CA to install; airi's tunnel untouched; a one-level name is covered by Universal SSL |
| Secrets | Fixed Secret names. Mac mini: Flux SOPS decryption (age). Cloud: External Secrets Operator | ESO everywhere; Vault/OpenBao | No extra pod on the Mac; the app never knows which supplier filled a Secret |
| Database | Plain Postgres StatefulSet behind `postgres.inCluster`; managed Postgres in the cloud | CloudNativePG; Bitnami chart | Smallest footprint for QA; QA data is disposable |
| Temporal | One `temporalio/server` process on the shared Postgres behind `temporal.inCluster`; Temporal Cloud possible later | Official multi-service chart; `temporal server start-dev` | One pod fits the budget and still uses real persistence |
| Images | GHCR, multi-arch (`linux/arm64`, `linux/amd64`), pinned by digest | Local registry; airi's zot | Same flow as ECR/ACR; the Mac mini is arm64, the clouds likely amd64; airi's registry stays airi's |
| Capacity | Podman machine 12 → 16 GiB (disk 100 → 120 GiB); `agentdesk-k3s` hard-capped at 4 GiB; 1 concurrent run | 14 GiB with borrowing from airi; 20 GiB (leaves the 24 GB Mac 4 GB) | Agent Desk's ~4 GiB comes from new memory, so airi keeps all of its current share |

## 3. Architecture

### 3.1 Layers

| Layer | Holds | Platform-neutral | Lives in |
|---|---|---|---|
| 1. Host | Starts a k3s container with a memory cap and published ports; first-time Flux bootstrap | No (the only imperative part) | `deploy/host/` plus `targets/<t>/host.env` |
| 2. Platform | Cluster capabilities behind fixed names: Gateway, edge, secret supplier, default storage class, Flux | No: one implementation per target | `deploy/platform/<capability>/<implementation>` |
| 3. App | api, worker, web, run sandbox, in-cluster Postgres and Temporal (each switchable) | Yes, enforced by the gate in section 8 | `deploy/chart/agentdesk` |

### 3.2 Repository layout

```
deploy/
  chart/agentdesk/                 Helm chart (app layer); values.schema.json
  platform/
    gateway/traefik-k3s/           HelmChartConfig (Gateway API provider, ClusterIP, readTimeout 0) + Gateway/edge
    edge/cloudflared/              Namespace agentdesk-edge, Deployment, ConfigMap with tunnel routes, NetworkPolicy
    storage/local-path-retain/     StorageClass local-path-retain (Retain), marked default
    flux/                          Flux components (3 controllers, lowered limits), self-managed after bootstrap
  targets/
    macmini-qa/                    values.yaml, secrets.sops.yaml, host.env, flux/ (OCIRepository, Kustomizations, HelmRelease)
    local/                         values.yaml, host.env (laptops on Docker or Podman; CI e2e)
    _conformance/                  minimal values; proves the chart renders with nothing extra
    aws/  azure/                   designed only: README, example values.yaml, empty infra/
  host/
    k3s-up.sh                      engine-agnostic launcher (podman | docker)
    quadlet/agentdesk-k3s.container.tpl
    test/                          bats tests with fake podman/docker shims
  policy/                          conftest Rego rules P1–P5
apps/api/Dockerfile  apps/worker/Dockerfile  apps/web/Dockerfile  images/runner/Dockerfile
.github/workflows/ci.yml  e2e.yml  release.yml  promote.yml
.sops.yaml
docs/runbooks/agentdesk-*.md
```

### 3.3 Contracts between layers

The chart depends only on these. A target must supply every one; the gate (section 8) checks that it does.

| Contract | Fixed name or key | Supplied on macmini-qa by | Supplied in the cloud by |
|---|---|---|---|
| Gateway | `Gateway/edge` in namespace `agentdesk-system`, an HTTP listener that accepts routes from `agentdesk` | Traefik (k3s bundled) Gateway API provider | AWS Load Balancer Controller / Application Gateway for Containers |
| Public origin | `values.publicHost` | Cloudflare Tunnel to `Gateway/edge` | Cloud load balancer + DNS |
| Secrets | `agentdesk-db`, `agentdesk-auth`, `agentdesk-github-app` in `agentdesk`; `cloudflared-tunnel` in `agentdesk-edge` (macmini only) | Flux SOPS decryption of `secrets.sops.yaml` | ESO `ExternalSecret`s with the same names |
| Storage | the default StorageClass; the chart never names one | `local-path-retain` | gp3 / Azure Disk CSI |
| Images | `values.image.registry` and a digest per image | GHCR | ECR / ACR or GHCR |
| Database | `values.postgres.host`, `port`, database names; passwords from `agentdesk-db` | in-cluster StatefulSet | RDS / Azure Database for PostgreSQL Flexible |
| Temporal | `values.temporal.address`, `namespace`; optional mTLS Secret | in-cluster single process | in-cluster or Temporal Cloud |
| Identity | `values.serviceAccounts.<name>.annotations` | none | EKS Pod Identity / Azure Workload Identity |
| Telemetry | `values.otel.endpoint` (empty = off) | off | ADOT / Azure Monitor |

Secret keys:

- `agentdesk-db`: `admin-password` (the server's superuser or managed admin), `owner-password` (`agentdesk_owner`), `app-password` (`agentdesk_app`), `temporal-password` (`temporal`).
- `agentdesk-auth`: `better-auth-secret`.
- `agentdesk-github-app`: `app-id`, `private-key`, `webhook-secret`, `client-id`, `client-secret`.
- `cloudflared-tunnel`: `credentials.json`.

Per-agent Claude credentials are not part of this list. The api writes them at runtime through `SecretStore` (backend spec); they are not in Git, so Flux never prunes them.

### 3.4 Request path

- macmini-qa: Cloudflare edge (TLS) → tunnel → `cloudflared` → Traefik `Gateway/edge` (HTTP) → `HTTPRoute` → api or web.
- local: `127.0.0.1:8443` → Traefik `Gateway/edge` → the same routes.
- AWS / Azure: load balancer (TLS) → their Gateway API controller → the same routes.

## 4. Host layer

### 4.1 `deploy/host/k3s-up.sh <target> [--bootstrap]`

Engine-agnostic: uses `$CONTAINER_ENGINE` if set, else `podman`, else `docker`. Every target-specific value comes from `targets/<target>/host.env`. Idempotent; re-running on a running cluster changes nothing. It:

1. Creates the volume `agentdesk-k3s-state` (k3s state and local-path PVC data).
2. Starts `rancher/k3s@<digest>` as a privileged container named `agentdesk-k3s` with the settings in 4.2. On macmini-qa it renders and installs the Quadlet unit instead of running the container directly.
3. Waits for the API and writes `~/.kube/agentdesk-<target>.yaml` (server `https://127.0.0.1:16443`).
4. With `--bootstrap`: creates the Secret `sops-age` (from `$SOPS_AGE_KEY_FILE`) and, if `GHCR_TOKEN` is set, the Secret `ghcr-pull` in `flux-system`; installs Flux from `deploy/platform/flux` at the pinned version; applies `targets/<target>/flux/`. From then on Flux manages itself and everything else.

It holds no deploy, release or rollback logic.

### 4.2 Container settings

| Setting (`host.env` key) | macmini-qa | local / CI |
|---|---|---|
| `K3S_IMAGE` | `docker.io/rancher/k3s@sha256:21ea6e0f…` (v1.37.2+k3s1, the digest airi pins) | same |
| `MEMORY` | `4g`, with swap equal (hard cap) | `4g` |
| `CPUS` | `3` (of 8) | unset |
| `IP` | `10.88.0.11` on the Podman network (k3s persists its node IP; airi uses `.10`) | engine default |
| `PORTS` | `127.0.0.1:16443:6443` only; the tunnel dials out, so no 443 | `127.0.0.1:16443:6443`, `127.0.0.1:8443:8000` |
| Restart | Quadlet `agentdesk-k3s.container` (rootful, in `/etc/containers/systemd/` of `podman-machine-default`), `Restart=always`, starts with the VM | `--restart unless-stopped` |
| `K3S_ARGS` | `server --disable=metrics-server,servicelb --secrets-encryption --kubelet-arg=system-reserved=memory=12Gi --kubelet-arg=eviction-hard=memory.available<300Mi` | the same without `system-reserved` |

### 4.3 Memory model

Kubelet inside a container sees the whole VM (16 GiB), so its own eviction cannot protect the cap. The guarantee is built from limits:

- `system-reserved=12Gi` leaves about 3.7 GiB allocatable, so the scheduler never places more than that.
- Every pod has requests and limits (a `LimitRange` fills in defaults), and the gate (P3) checks that steady-state pod limits plus the run quota stay at or below **3.4 GiB**.
- With about 0.6 GiB of k3s overhead, that stays under the 4 GiB container cap. A pod over its limit is OOM-killed in its own cgroup and never pushes the container over its cap.
- api, worker and temporal use the `Recreate` strategy, so a rollout never runs two copies (QA accepts a few seconds of downtime per deploy).
- Helm hook Jobs (section 6.3, 384 Mi of limits for under a minute) can briefly exceed the budget. The worst case is an OOM kill inside `agentdesk-k3s`, never in airi. The capacity check (section 9.1) measures the real peak.

### 4.4 Mac mini prerequisites (one planned window)

Done by the operator with airi's own runbook; nothing in this repo changes airi.

1. Stop the Podman machine, then `podman machine set --memory 16384 --disk-size 120` (growing the disk is non-destructive). Start it.
2. In airi's repository, a one-line change to `deploy/overlays/macmini-lan/host/airiprod-k3s.container`: `--kubelet-arg=system-reserved=memory=3500Mi` → `7500Mi`, merged there, then `airi host install-unit --restart`. Without this, airi's scheduler would count Agent Desk's 4 GiB as its own.
3. `airi status` must be OK before Agent Desk is installed.

Resulting VM layout: 3.5 GiB VM OS, Podman and the airi dev stack; 8.5 GiB `airiprod-k3s` (unchanged); 4 GiB `agentdesk-k3s`.

## 5. Platform layer (macmini-qa)

### 5.1 Gateway

`deploy/platform/gateway/traefik-k3s/` holds a `HelmChartConfig` for k3s's bundled Traefik:

- the Kubernetes Gateway API provider on; the chart's own default Gateway off;
- Service type `ClusterIP` (servicelb is disabled);
- `ports.web.transport.respondingTimeouts.readTimeout: 0` so WebSocket and SSE connections are not cut;
- for `local` only, `ports.web.hostPort: 8000` (set by a second file that only `local` includes).

It also holds `Namespace/agentdesk-system` and `Gateway/edge` (class `traefik`, one HTTP listener on port 8000, `allowedRoutes` from namespace `agentdesk`).

### 5.2 Edge

`deploy/platform/edge/cloudflared/`:

- `Namespace/agentdesk-edge` (restricted Pod Security).
- `Deployment/cloudflared` (1 replica, image by digest, 32 → 64 Mi) running a **locally-managed** tunnel: `tunnel run` with the credentials file from Secret `cloudflared-tunnel` and a config ConfigMap whose ingress rules are `qa-desk.myairi.app → http://traefik.kube-system.svc:8000`, then `http_status:404`. Routing therefore lives in Git, not in the Cloudflare dashboard.
- NetworkPolicy: no ingress; egress to DNS, Cloudflare (7844 TCP/UDP, 443) and Traefik 8000.

One-time setup (runbook): `cloudflared tunnel create agentdesk-qa`, `cloudflared tunnel route dns agentdesk-qa qa-desk.myairi.app`, put the credentials JSON into the SOPS file. airi's tunnel and records are not touched.

TLS terminates at Cloudflare (Universal SSL covers `qa-desk.myairi.app`); traffic inside the cluster is HTTP.

### 5.3 Secrets

- `.sops.yaml` has one rule per target file (`deploy/targets/macmini-qa/secrets.sops.yaml`) with exactly one age recipient. The private key exists only on the operator's machine and as the Secret `sops-age` in `flux-system`.
- The file holds the Secrets of section 3.3 as plain `Secret` manifests, encrypted per value.
- The platform `Kustomization` decrypts it (`decryption.provider: sops`).

### 5.4 Storage

`StorageClass/local-path-retain` (provisioner `rancher.io/local-path`, `reclaimPolicy: Retain`, `volumeBindingMode: WaitForFirstConsumer`) annotated as the default, and the bundled `local-path` class un-defaulted. Deleting a PVC never deletes Postgres data. Data lives in the `agentdesk-k3s-state` volume.

### 5.5 Not included for QA

cert-manager, External Secrets Operator, CloudNativePG, Cloudflare Access, Postgres backups (QA data is disposable; cloud targets use managed backups), metrics-server, a Temporal UI Deployment.

## 6. App chart (`deploy/chart/agentdesk`)

### 6.1 Namespaces

`agentdesk` (app), `agentdesk-runs` (one Job per run). The chart creates both. `agentdesk-system`, `agentdesk-edge` and `flux-system` belong to the platform.

### 6.2 Workloads

All pods run under `restricted` Pod Security: non-root, `readOnlyRootFilesystem` (with `emptyDir` for `/tmp`), all capabilities dropped, `RuntimeDefault` seccomp, no privilege escalation, images by digest.

| Component | Kind | Details | Memory request → limit |
|---|---|---|---|
| `api` | Deployment ×1, `Recreate` | port 3000; probes `/healthz` (liveness) and `/readyz` (readiness); SA `agentdesk-api` | 160 → 320 Mi |
| `worker` | Deployment ×1, `Recreate` | Temporal worker; SA `agentdesk-worker` | 160 → 320 Mi |
| `web` | Deployment ×1 | `nginx-unprivileged` on 8080 serving the SPA build; unknown paths → `index.html`; `Cache-Control: immutable` for hashed assets, `no-cache` for `index.html` | 16 → 32 Mi |
| `postgres` | StatefulSet ×1 (`postgres.inCluster`) | `postgres:18` by digest; 5 Gi PVC from the default class; `shared_buffers=64MB`, `max_connections=50`; databases `agentdesk`, `temporal`, `temporal_visibility` | 192 → 320 Mi |
| `temporal` | Deployment ×1, `Recreate` (`temporal.inCluster`) | `temporalio/server` running frontend, history, matching and worker in one process; SQL persistence on `postgres`; `numHistoryShards: 4` (fixed for the life of this cluster) | 256 → 448 Mi |

Platform pods counted in the same budget: `cloudflared` 32 → 64 Mi; Flux source, kustomize and helm controllers 96 → 352 Mi in total (lowered from Flux's 1 Gi defaults by a patch in `deploy/platform/flux`).

Steady-state platform total: about 0.9 GiB requests, 1.8 GiB limits. With the run quota (1.5 GiB): 3.4 GiB of limits.

Configuration: a ConfigMap `agentdesk-config` rendered from values feeds the backend `ConfigModule`. It holds `PUBLIC_ORIGIN`, `KUBE_MODE=incluster`, `RUNS_NAMESPACE`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, database host and names, run pod resources, and `OTEL_EXPORTER_OTLP_ENDPOINT`. Passwords come from `agentdesk-db` via `secretKeyRef`.

### 6.3 Hooks

Helm `pre-install,pre-upgrade` Jobs, the same on every target:

1. **`db-migrate`** (api image, 128 → 256 Mi). Connects as the admin user, idempotently creates the roles `agentdesk_owner`, `agentdesk_app` and `temporal` and the three databases, then runs the Drizzle migrations as `agentdesk_owner`. Works unchanged against RDS or Azure because nothing depends on Postgres init scripts.
2. **`temporal-schema`** (`temporalio/admin-tools` by digest, 64 → 128 Mi; only when `temporal.inCluster`). Runs `temporal-sql-tool setup-schema` / `update-schema` for both Temporal databases, then creates the Temporal namespace `agentdesk` if it is missing. This runs after `db-migrate` (hook weight).

A failed hook fails the upgrade, and Flux remediation rolls back (section 7.3).

### 6.4 Routing

One `HTTPRoute/agentdesk` on `Gateway/edge`, hostname `values.publicHost`:

- `PathPrefix /api`, `/auth`, `/webhooks` → `api:3000` (includes the terminal WebSocket and both SSE endpoints);
- `PathPrefix /` → `web:8080`.

### 6.5 Run sandbox (`agentdesk-runs`)

- `ResourceQuota`: `limits.memory` 1536 Mi, `requests.memory` 768 Mi, `pods` 2 (one finishing while the next starts). Values: `runs.maxConcurrent`, `runs.resources`. Setup-test pods ([ADR 0019](../../adr/0019-repo-setup-and-approved-store-plugins.md)) run in this namespace with the run pod's resources and count against this quota: an open test (kept for `SETUP_TEST_TTL_SECONDS`) can block a run pod, which then fails after the 2 min Pending limit. Follow-up: give setup tests their own quota (or namespace) sized for one open test per project.
- `LimitRange` with the run pod defaults.
- Pod Security `restricted`. Run pods (created by the worker) use uid 10001, `automountServiceAccountToken: false`, an `emptyDir` workspace with `sizeLimit: 4Gi`, and `ephemeral-storage` limit 4 Gi.
- NetworkPolicy: deny all ingress. Egress allowed to DNS (kube-system) and to `0.0.0.0/0` **except** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`. This blocks the cluster, the Podman network, the LAN, and cloud metadata endpoints with the same rule on every target. Run pods must also reach the plugin marketplace sources (GitHub) and package registries ([ADR 0019](../../adr/0019-repo-setup-and-approved-store-plugins.md)); any future egress allowlist has to include them.
- Optional values for cloud targets: `runs.nodeSelector`, `runs.tolerations`, `runs.runtimeClassName`.

### 6.6 RBAC

- SAs `agentdesk-api` and `agentdesk-worker`. In `agentdesk-runs`: a Role on `jobs`, `pods`, `pods/log`, `pods/exec` and `secrets` (create, get, list, watch, delete). In `agentdesk`: a Role on `secrets` (agent credentials, via `SecretStore`). Nothing cluster-wide.
- App pods mount their SA token only where needed (api and worker).

### 6.7 `agentdesk` network policy

Default-deny ingress, then allow: Traefik pods (kube-system) → api 3000 and web 8080; api and worker → postgres 5432 and temporal 7233; temporal → postgres; hook Jobs → postgres. Egress stays open for the PoC (GitHub API, Anthropic, the kube API), because restricting it needs IPs that differ per target.

### 6.8 Images

| Image | Build | Notes |
|---|---|---|
| `agentdesk-api` | `apps/api/Dockerfile`, multi-stage, `node:22-slim` by digest, `pnpm deploy --prod` | also carries the migrate entrypoint |
| `agentdesk-worker` | `apps/worker/Dockerfile`, same pattern | |
| `agentdesk-web` | `apps/web/Dockerfile`: Vite build stage → `nginxinc/nginx-unprivileged` by digest | |
| `agentdesk-runner` | `images/runner/Dockerfile`: `node:22-slim` + git, gh, tmux, Claude Code at a pinned version, the Stop-hook user settings, the entrypoint of backend §8; user 10001 | target size under 1.2 GB; only the toolchains the demo repo needs |

All Dockerfiles build with Podman and Docker. Every base image is pinned by digest.

## 7. Delivery

### 7.1 Workflows (GitHub Actions)

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | PR, push to `main` | pnpm install (cached); lint; typecheck; Vitest unit, workflow and contract tests; database tests (Testcontainers on the runner's Docker); web build. Deploy checks: `helm lint`; `helm template` for every target; `kubeconform` against Kubernetes 1.37 and Gateway API schemas; `conftest` rules P1–P5; `shellcheck` and `bats` for `deploy/host` |
| `e2e.yml` | PR (paths: `apps/**`, `packages/**`, `deploy/**`, `images/**`), push to `main` | build images in the job; `k3s-up.sh local` on Docker; import the images into k3s; `helm install` with `targets/local` values; backend end-to-end test (comment → run → finish with the `fake` provider) and Playwright; assert that a run pod cannot reach `postgres:5432` or `169.254.169.254` |
| `release.yml` | push to `main` after `ci` and `e2e` pass (`workflow_run`); manual | build the four images for `linux/arm64` and `linux/amd64` on native `ubuntu-24.04-arm` and `ubuntu-24.04` runners, merge into multi-arch indexes, push to `ghcr.io/<owner>/agentdesk-*:sha-<sha>`, attach build provenance (`actions/attest-build-provenance`); `helm push` the chart as `oci://ghcr.io/<owner>/charts/agentdesk:0.1.0-<sha>`; build the deploy bundle (section 7.2) and `flux push artifact oci://ghcr.io/<owner>/agentdesk-deploy:<sha>` with source and revision annotations; `flux tag artifact … --tag qa` |
| `promote.yml` | manual, inputs `env` (`qa`), `sha` | re-tag `agentdesk-deploy:<sha>` as `<env>`. This is also rollback |

Only the repository's `GITHUB_TOKEN` (with `packages: write`) is used. CI never connects to the Mac mini.

### 7.2 Release bundle

`agentdesk-deploy:<sha>` contains `deploy/platform/**` and, for each target, `flux/**`, `values.yaml` and `secrets.sops.yaml` as committed. It also contains one generated file per target, `release.yaml`, which holds the chart version (`0.1.0-<sha>`) and the four image digests. The bundle records its source commit, so `flux get` shows what is deployed.

### 7.3 Flux on the cluster (`targets/macmini-qa/flux/`)

- `OCIRepository/agentdesk-deploy`: `ghcr.io/<owner>/agentdesk-deploy`, `ref.tag: qa`, interval 1 m, `secretRef: ghcr-pull`.
- `Kustomization/platform`: path `platform/` items listed for this target, SOPS decryption with `sops-age`, `prune: true`, `wait: true`.
- `Kustomization/app`: `dependsOn: platform`. Its `configMapGenerator` turns `values.yaml` and `release.yaml` into the ConfigMap `agentdesk-values`, and it applies `OCIRepository/agentdesk-chart` (the chart at the exact version from `release.yaml`, patched in by a kustomize replacement) and `HelmRelease/agentdesk` (`chartRef` to that OCIRepository, `valuesFrom` the two keys of `agentdesk-values`, release values last). `install.remediation.retries: 1`; `upgrade.remediation.retries: 1` with `remediateLastFailure: true` and strategy `rollback`.
- Flux components themselves come from `platform/flux`, so a Flux upgrade is a commit.

### 7.4 Promotion and rollback

- Green `main` → `release.yml` → tag `qa` moves → Flux applies within about a minute.
- Rollback: run `promote.yml` with the previous sha. A failed upgrade also rolls back on its own (7.3).
- A later `prod` environment gets its own tag and target; promotion copies the tag, so prod runs the exact bundle QA ran.

## 8. Portability gate (`deploy/policy`, conftest)

Runs in `ci.yml` on the output of `helm template` for every target, and on `deploy/platform/**` where noted.

| Rule | Applies to | Fails on |
|---|---|---|
| P1 Neutral chart | the chart rendered with `_conformance` and `local` values | `hostPath`, `hostNetwork`, `hostPort`, `externalIPs`; `Ingress`, `IngressClass`, `PersistentVolume`; `kubernetes.io/arch` selectors; any `storageClassName`; IPv4 literals in env or ConfigMaps (except the run egress `except` list); cloud annotations (`eks.amazonaws.com/*`, `azure.workload.identity/*`, `service.beta.kubernetes.io/*`) not coming from values; controller-specific kinds (`traefik.io/*`, `helm.cattle.io/*`) |
| P2 Hardening | every rendered workload and hook | missing requests or limits; root user; privilege escalation; writable root filesystem; no seccomp profile; an image without a digest |
| P3 Budget | each target | steady-state pod limits (app + platform pods listed in the target's `budget.platformPods`) plus the run quota above `budget.podLimits` (macmini-qa: 3.4 Gi) |
| P4 Secret contract | each target | a workload reads a Secret not in the contract list, or the target supplies no source for a contract Secret (an entry in its SOPS file or an `ExternalSecret`) |
| P5 Run sandbox | every render | the `agentdesk-runs` quota, LimitRange or NetworkPolicy missing; the egress `except` list missing any of the five ranges |

## 9. Operations

### 9.1 Runbooks (`docs/runbooks/`)

1. `agentdesk-prereqs.md`: the window of section 4.4.
2. `agentdesk-install.md`: create the age key, write `secrets.sops.yaml`, create the tunnel, create a fine-grained GHCR token (`read:packages`, expiry recorded), `k3s-up.sh macmini-qa --bootstrap`, check `flux get all`, sign in at `https://qa-desk.myairi.app`.
3. `agentdesk-operate.md`: what is deployed (`flux get sources oci`, `flux get hr`), logs, rollback (`promote.yml`), pause (`flux suspend hr agentdesk`), Temporal UI by port-forward, rotating the GHCR token and the tunnel credentials.
4. `agentdesk-capacity.md`: during a real run, `podman stats` on the root connection for `agentdesk-k3s` and `airiprod-k3s`, `memory_pressure` on the Mac; record peaks; adjust limits in values.
5. `agentdesk-teardown.md`: remove the Quadlet unit, container and `agentdesk-k3s-state` volume; delete the tunnel and its DNS record. Never touches airi objects.

### 9.2 Observability

pino JSON logs through `kubectl logs`; Flux events through `flux events` and `flux logs`. OTLP is off until a target sets `otel.endpoint`.

### 9.3 Failure handling

| Failure | Behavior |
|---|---|
| Upgrade fails (hook or readiness) | HelmRelease remediation rolls back to the previous release; `flux get hr` shows the reason |
| A bad release reaches QA | `promote.yml` with the previous sha |
| Pod over its memory limit | that pod is OOM-killed; for a run pod the backend marks the run `failed`; the 4 GiB cap protects airi |
| `agentdesk-k3s` exits, VM or Mac restarts | Quadlet restarts it; Postgres data survives (Retain class, state volume); Temporal resumes workflows |
| GHCR token expired | the OCI sources go `NotReady`; the running release keeps serving; rotate the token (runbook 3) |
| VM disk pressure | run workspaces capped at 4 Gi; k3s image GC; the runner image is the only large image |
| Tunnel down | QA is unreachable from outside; the app keeps running; Polling projects keep working |
| Cloudflare idle timeout (~100 s) | SSE heartbeats every 15 s; the terminal WebSocket pings every 30 s (amendment 3) |

## 10. Testing

| Layer | Tool | Covers |
|---|---|---|
| Chart | `helm lint`, `helm template`, `kubeconform` | every target renders and validates against Kubernetes 1.37 and Gateway API schemas |
| Policy | `conftest` with Rego unit tests (`conftest verify`) | P1–P5, each with a passing and a failing fixture |
| Host | `shellcheck`, `bats` with fake `podman` and `docker` shims | engine detection, flags per target, idempotent re-run, Quadlet rendering, bootstrap Secrets |
| Images | build in CI for both architectures; a smoke run of each container (`--help` or health endpoint) | Dockerfiles build on Docker; the runner image has git, gh, tmux and Claude Code |
| Cluster e2e | `e2e.yml` on a real k3s on Docker | install with hooks, routes through `Gateway/edge`, the backend end-to-end flow, run sandbox egress blocks |
| Manual, after first QA install | runbook 2 and 4 | a real run through `qa-desk.myairi.app` with SSE and the terminal through Cloudflare; the capacity reading |

Podman parity: the bats suite runs both shims in CI; a manual `k3s-up.sh local` on Podman is part of build step 3.

## 11. Cloud targets (designed, not built)

`deploy/targets/aws/` and `deploy/targets/azure/` each hold a README listing how they fill every contract of section 3.3, an example `values.yaml` that CI renders through P1–P5, and an empty `infra/` for the OpenTofu module that will replace `k3s-up.sh`.

| Contract | AWS | Azure |
|---|---|---|
| Cluster (replaces the host layer) | OpenTofu: EKS, managed node group, VPC | OpenTofu: AKS, VNet |
| `Gateway/edge` | AWS Load Balancer Controller (Gateway API), ALB, ACM certificate | Application Gateway for Containers, Key Vault certificate |
| Public origin / DNS | Route 53, or Cloudflare DNS to the ALB | Azure DNS, or Cloudflare |
| Secrets | ESO + Secrets Manager | ESO + Key Vault |
| Postgres | `postgres.inCluster: false`, RDS for PostgreSQL | Azure Database for PostgreSQL Flexible |
| Temporal | in-cluster, or Temporal Cloud (`temporal.address` + mTLS Secret) | same |
| Storage | gp3 default class | Azure Disk CSI default class |
| Registry | ECR or GHCR | ACR or GHCR |
| Identity | EKS Pod Identity through SA annotations in values | Workload Identity through the same values |
| Telemetry | ADOT collector | Azure Monitor OTLP |
| Delivery | the same Flux bundle, its own tag | same |
| Run isolation | a node group tainted `agentdesk/runs`; optional gVisor or Kata via `runs.runtimeClassName` | a node pool with the same values |

Known risk: the terminal relay uses `pods/exec` through the API server. It works on EKS and AKS; with a private API endpoint the api pod must be inside the cluster network, which it already is.

## 12. Scope

In scope: sections 3–10; the `aws` and `azure` designed targets of section 11; the backend spec amendments in section 13.

Out of scope: cloud IaC (OpenTofu modules); a `prod` environment; cert-manager, External Secrets Operator and managed databases on the Mac mini; Postgres backups for QA; Cloudflare Access; metrics and dashboards; per-project runner images; more than one concurrent run on the Mac mini; changes inside airi's repository other than the one line of section 4.4, which is made and deployed there.

## 13. Backend spec amendments

Made in `docs/superpowers/specs/2026-11-12-control-plane-design.md` in the same commit as this spec (the frontend spec's mentions of the kind cluster are updated to the `local` target in the same commit):

1. **Run pod settings from config**: the worker sets the Job's `resources`, ephemeral storage, `securityContext` (uid 10001, restricted), workspace `emptyDir` size, `automountServiceAccountToken: false`, and optional `nodeSelector`, `tolerations` and `runtimeClassName` from `ConfigModule`, supplied by chart values.
2. **`KUBE_MODE=incluster`**: uses the pod's service account; `kind` mode becomes `kubeconfig` (any local cluster, including the `local` target).
3. **Terminal keepalive**: the api sends a WebSocket ping every 30 s on the terminal relay.
4. **Migrate entrypoint**: the api image has a migrate entrypoint that connects as the admin user, creates `agentdesk_owner`, `agentdesk_app` and `temporal` and the databases idempotently, then migrates as `agentdesk_owner`.
5. **End-to-end cluster**: the kind end-to-end test becomes the `local` target (k3s on Docker via `k3s-up.sh`).

## 14. Build order

Steps 1–5 need `apps/api`, `apps/worker` and `apps/web` to exist; until the backend reaches them, a stub image with `/healthz` and `/readyz` stands in, so infra runs in parallel with backend steps 1–6.

1. Dockerfiles for api, worker, web and the runner; build with Docker and Podman.
2. Chart skeleton, `_conformance` and `local` values, and the policy gate with its tests.
3. `k3s-up.sh` and the `local` target; install by hand on a laptop with Docker and with Podman.
4. In-cluster Postgres and Temporal, and both hooks.
5. `ci.yml` and `e2e.yml`.
6. `release.yml` and `promote.yml`: GHCR images, OCI chart, deploy bundle, tags.
7. Flux platform layer, `targets/macmini-qa`, SOPS.
8. Mac mini: prerequisites window, tunnel, bootstrap, first QA deploy, capacity check.
9. `aws` and `azure` designed targets, rendered in CI.

## 15. Open technical checks

- k3s v1.37.2's bundled Traefik: the Gateway API provider settings in `HelmChartConfig`, and whether its CRD chart installs the Gateway API standard CRDs.
- Traefik v3 `readTimeout` on WebSocket and SSE connections, and that `0` disables it.
- SSE through the Cloudflare Tunnel: no buffering of `text/event-stream`, and the idle timeout with 15 s heartbeats.
- Temporal single-process memory under 448 Mi with 4 shards on Postgres.
- The `--memory` and `--cpus` caps on a rootful Podman container inside the macOS Podman machine (krunkit), and k3s behavior at the cap.
- GitHub-hosted `ubuntu-24.04-arm` runners for a private repository, and their cost.
- Flux `HelmRelease.chartRef` to an `OCIRepository` chart, and setting that OCIRepository's tag from `release.yaml` with a kustomize replacement.
- `db-migrate` against RDS and Azure: `CREATE ROLE` rights of the managed admin user.

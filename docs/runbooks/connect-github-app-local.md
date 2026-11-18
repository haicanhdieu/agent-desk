# Connect a real GitHub App locally (optional)

Use a real GitHub repo instead of the fake provider while developing. Most work doesn't need this; the fake provider covers every flow ([local-dev.md](local-dev.md)).

**Applies to:** testing the GitHub adapter end to end on your laptop. _(Once backend lands.)_

## 1. Create a GitHub App (once, on your own account)

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**:

| Field                     | Value                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Homepage URL              | `http://localhost:5173`                                                                   |
| Callback URL              | `http://localhost:5173/auth/callback/github`                                              |
| Setup URL (post-install)  | `http://localhost:5173/api/connections/github/callback`                                   |
| Webhook                   | **Off**. GitHub can't reach localhost, so use **Polling** mode.                           |
| Repository permissions    | Contents: read & write; Issues: read & write; Pull requests: read & write; Metadata: read |
| Account permissions       | **Email addresses: read-only** (sign-in fails with `email_not_found` without it)          |
| Organization permissions  | **Members: read-only** (without it, org installs are not auto-linked)                     |
| Where can it be installed | Only on this account                                                                      |

Then generate a **private key** (`.pem`) and a **client secret**.

## 2. Configure `.env`

Set all six values, or none. The config schema rejects a partial set, and an empty value counts as unset: the api then exits at startup with an empty `{}` error. `GITHUB_WEBHOOK_SECRET` can be any random string (`openssl rand -hex 32`) while webhooks are off. To turn the `.pem` into one line: `awk 'NF {printf "%s\\n", $0}' key.pem`.

```sh
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=my-agentdesk-dev
GITHUB_CLIENT_ID=Iv1.xxxxx
GITHUB_CLIENT_SECRET=xxxxx
GITHUB_WEBHOOK_SECRET=any-random-string
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

`.env` is gitignored. Never commit these values, and don't paste them into issues, PRs or agent prompts ([security.md](../conventions/security.md)).

## 3. Use it

1. Restart the stack: `devbox run stop && devbox run dev`.
2. Sign in with GitHub at http://localhost:5173 and install the App on a **throwaway test repo**. A run can push to it.
3. Create a project in **Polling** mode, at the minimum interval.
4. Comment `/code-review` on an issue or PR in that repo. The run starts on the next poll.

With `KUBE_MODE=fake`, the "agent" is still the scripted fake. For real Claude Code, see section 4.

## 4. Real Claude runs (local k3s)

1. **Rootful Podman.** k3s needs cpuset cgroups, so a rootless Podman machine fails with `failed to find cpuset cgroup (v2)`. Run `podman machine stop && podman machine set --rootful && podman machine start`. The rootful store has its own images and volumes; switching back restores the old ones.
2. **Runner image.** `podman build -t agentdesk-runner:dev images/runner`.
3. **Cluster.**

```sh
podman run -d --name agentdesk-k3s --privileged --memory 8g --memory-swap 8g --restart unless-stopped \
  -p 127.0.0.1:16443:6443 -v agentdesk-k3s-state:/var/lib/rancher/k3s \
  docker.io/rancher/k3s:v1.33.5-k3s1 server --disable=metrics-server,servicelb,traefik --tls-san=127.0.0.1
podman exec agentdesk-k3s cat /etc/rancher/k3s/k3s.yaml | sed 's#https://127.0.0.1:6443#https://127.0.0.1:16443#' > ~/.kube/agentdesk-local.yaml
chmod 600 ~/.kube/agentdesk-local.yaml
export KUBECONFIG=~/.kube/agentdesk-local.yaml
kubectl create namespace agentdesk-runs   # run Jobs and per-run Secrets
kubectl create namespace agentdesk        # stored agent credentials (APP_NAMESPACE)
podman tag localhost/agentdesk-runner:dev docker.io/library/agentdesk-runner:dev
podman save docker.io/library/agentdesk-runner:dev | podman exec -i agentdesk-k3s ctr -n k8s.io images import -
```

**Sizing (local, 12 GiB Podman machine).** `--memory` caps the whole k3s container: the run pod, CoreDNS, kubelet and containerd all share it. A cap equal to the run pod limit (`RUN_POD_MEMORY_LIMIT`, default `4Gi`) leaves nothing for the rest; the kernel then OOM-kills CoreDNS first, so new runs fail with `Could not resolve host`, and exec/terminal attach into a busy pod stops answering. Use `cluster = ~1 GiB system + one run pod limit + slack`, so **8g** for one run at a time. The rest of the machine (Postgres, Temporal, the VM) needs about 3 to 4 GiB, so do not go above 8g on 12 GiB. The cap is fixed when the container is created, so to change it you recreate the container. Keep the `agentdesk-k3s-state` volume (the runner image and run volumes live in it), and keep the **same hostname and IP**: k3s names the node after the container hostname, run volumes are pinned to that node name, and the node keeps the IP it first registered. A plain `podman rm` and `podman run` gives a new hostname and IP: paused runs then cannot resume (their volumes belong to the old node name), and with the old hostname but a new IP k3s crash-loops with `failed to find interface with specified node ip`. Read both values with `kubectl get nodes -o wide` (the name and `INTERNAL-IP`) and pass them back: `podman stop agentdesk-k3s && podman rm agentdesk-k3s`, then re-run the command above with `--hostname <node name> --ip <INTERNAL-IP>` added (the default `podman` network allows a fixed `--ip`). The runner image needs no re-import after this.

**Other environments (QA, prod).** No cap is defined yet. For reference only, the minimums that held in local use:

| Level                     | Minimum                                                                 | Why                                                                                    |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Run pod memory limit      | 4 GiB                                                                   | Heaviest measured step (`pnpm test`) peaks at 2.9 GiB ([runner-pod.md](runner-pod.md)) |
| Cluster (k3s node) memory | ~1 GiB system + 4 GiB per concurrent run (5 GiB for one, 9 GiB for two) | Runs burst to their limit; the system part keeps CoreDNS and kubelet alive             |
| VM / host memory          | Cluster + 3 to 4 GiB (12 GiB for the 8g local cluster)                  | Postgres, Temporal, the VM kernel and the API/worker if co-hosted                      |

4. **`.env`:** `KUBE_MODE=kubeconfig`, `KUBECONFIG=<absolute path of ~/.kube/agentdesk-local.yaml>`, `RUNNER_IMAGE=agentdesk-runner:dev`. Restart the stack.
5. Add the agent credential (OAuth token or API key) in the UI, never in chat or Git.

**Always point `KUBECONFIG` at the dedicated file.** If it is empty, the client may use your current kubectl context, which can be a shared or production cluster. Runs execute untrusted repo code with `bypassPermissions`.

`devbox run dev` rebuilds and re-imports the runner image on its own when `images/runner` changed (`devbox run runner-image` does it by hand). Running pods keep the old image; start a new run to use the new one.

## 5. Clean up

Uninstall the App from the test repo when you're done. If the private key or client secret was exposed anywhere, follow [incident-response.md](incident-response.md).

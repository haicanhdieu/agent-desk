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
| Where can it be installed | Only on this account                                                                      |

Then generate a **private key** (`.pem`) and a **client secret**.

## 2. Configure `.env`

Set all six values, or none. The config schema rejects a partial set.

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

With `KUBE_MODE=fake`, the "agent" is still the scripted fake. To run real Claude Code in a pod, you need a local k3s cluster with `KUBE_MODE=kubeconfig`. That is covered by the infra spec's `local` target and isn't part of this runbook.

## 4. Clean up

Uninstall the App from the test repo when you're done. If the private key or client secret was exposed anywhere, follow [incident-response.md](incident-response.md).

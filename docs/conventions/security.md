# Security rules

Agent Desk runs an AI agent with push access, driven by text that strangers can write, inside our cluster. These rules keep secrets out of storage and logs, keep run pods contained, and make every endpoint check who is asking.

**Applies to:** all code in `apps/*` and `packages/*`, the runner image and entrypoint, `deploy/` (chart, policies, targets), and anyone handling credentials or incidents.

Threat model and controls: Architecture doc §7, backend spec §4.2, §7.5, §8, infra spec §6.5–6.7. Related: [architecture.md](architecture.md), [backend.md](backend.md), [database.md](database.md), [frontend.md](frontend.md), [testing.md](testing.md), [code-review-checklist.md](code-review-checklist.md).

## 1. Secrets handling

Secrets in scope: agent credentials (Claude API key or OAuth token), workspace tokens (short-lived code-host tokens), the code-host App private key and client secret, webhook secrets, `BETTER_AUTH_SECRET`, database passwords, SOPS/age keys, tunnel credentials.

- **MUST** store secret values only in Kubernetes Secrets (via `SecretStore`, or the infra Secret contract: `agentdesk-db`, `agentdesk-auth`, `agentdesk-github-app`). _Why:_ Postgres is backed up, queried and shown in the UI; Secrets have RBAC and k3s encrypts them at rest (`--secrets-encryption`).
- **MUST** reference a secret by name in Postgres (`agents.credential_secret_name`, `org-{orgId}-agent-{agentId}`) plus non-secret metadata (`credential_type`, `credential_updated_at`, `credential_set_by`). _Why:_ the row is useful without being dangerous.
- **MUST NOT** put a secret value in: Postgres (any table, including `audit_log` and `run_events`), logs, Temporal workflow/activity inputs or results, SSE events, API responses, error messages or `problem+json` `detail`, ticket comments, Kubernetes labels/annotations, or a Job's literal `env`. _Why:_ each of those is readable by more people, or retained longer, than the secret should be.
- **MUST** deliver run secrets to the pod only through the per-run Secret `run-{runId}` via `envFrom`. This includes `REPO_CLONE_URL`, which embeds the token (backend plan Task 14). _Why:_ anyone with `get jobs` can read a Job's literal env.
- **MUST** treat a credential write as write-only: `PUT /api/agents/:id/credential` returns `{ updatedAt }` only, and no endpoint ever returns the value. The UI shows "set / not set" (FR-3).
- **MUST** strip secret-bearing keys from audited bodies (`redactBody` drops `value`, `token`, `secret`, `password`) and add any new secret field name to that list.
- **MUST** fetch secrets inside activities, not pass them through workflow history. _Why:_ Temporal persists inputs and results in its database and shows them in the UI.
- **MUST NOT** commit real secrets. `.env` is gitignored; `.env.example` holds dev placeholders only; target secrets live in `deploy/targets/<t>/secrets.sops.yaml` encrypted per value.

```ts
// Good: pass the name, resolve inside the activity
await activities.createRunSecretAndJob({ orgId, runId });
// Bad: secret lands in Temporal history and its UI
await activities.createRunSecretAndJob({ orgId, runId, token, credential });
```

```ts
// Bad: the error message carries the token into logs and problem+json
throw new Error(`clone failed for ${cloneUrl}`);
// Good
throw new Error(`clone failed for run ${runId}`);
```

## 2. Redaction of run output

- **MUST** pass every stored or forwarded run text (pod log lines, final scrollback, `failure_reason`, finish-comment tail) through `redact(text, secrets)` from `packages/core/src/redact.ts`, with the run's workspace token and agent credential in `secrets`. _Why:_ the agent can print anything, including its own env.
- `redact` also masks known patterns (`x-access-token:…@`, `ghs_…`, `sk-ant-…`). **MUST** add a pattern when a new provider or credential format is introduced (in that provider's adapter, exported to `redact`).
- **MUST** redact before the write, not on read. _Why:_ stored plaintext survives later bug fixes.
- **MUST** configure the logger (pino) with `redact` paths for `authorization`, `cookie`, `set-cookie`, the webhook signature header and any body field named like a secret.
- Redaction is a backstop, not a control. Known gap (Architecture §7): the agent process can read the Claude credential, so a successful injection can exfiltrate it. Mitigation now: a dedicated low-limit key per project. Planned fix: an egress proxy that injects the credential outside the container.
- Live terminal bytes are relayed, not stored, in the PoC; do not add storage of them without redaction.

## 3. Webhook verification

Route: `POST /webhooks/:provider`. Verification lives in the provider's `BoardAdapter.verifyAndParseWebhook`.

- **MUST** verify the signature over the **raw request body bytes** (Fastify content parser with `parseAs: 'buffer'`, scoped to the route). _Why:_ re-serialized JSON does not match the signed bytes.
- **MUST** compare with a constant-time function, after checking lengths. _Why:_ `===` leaks the match length through timing.
- **MUST** verify before any side effect: no `inbound_events` row, no project lookup, no log of the body. Bad signature → 401 and nothing written (backend spec §6.6).
- **MUST** dedupe on `(provider, delivery_id)` and on `(project_id, trigger_comment_id)`. _Why:_ signatures do not prevent replay; dedupe does.
- **MUST** fail closed when the webhook secret is not configured for that provider/connection (reject, do not skip verification).
- **MUST** register the `fake` provider (and its `x-fake-signature` with `FAKE_WEBHOOK_SECRET=dev`) only when `NODE_ENV !== 'production'`; config validation rejects `ENABLE_FAKE_PROVIDER=true` in production.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
// Bad: if (header === 'sha256=' + digest) …
```

## 4. Run pod hardening invariants

These hold for every run pod on every target. The worker builds the Job (`buildRunJob`); the chart and conftest gate (P2, P5, **planned**) check the namespace.

- **MUST** set `automountServiceAccountToken: false`. _Why:_ the agent executes untrusted repo code; a token would be cluster access.
- **MUST** keep the run pod unable to reach the Kubernetes API and cluster-internal addresses: `agentdesk-runs` NetworkPolicy denies all ingress and allows egress only to DNS and `0.0.0.0/0` except `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`. _Why:_ blocks Postgres, Temporal, the LAN, airi on the Mac mini, and cloud metadata.
- **MUST** mint a workspace token scoped to the project's single repo, with the minimum permissions, expiring in ≤ 1 hour; keep `timeout_seconds` ≤ 3300 so the run never outlives it.
- **MUST** put nothing else in the pod: no App private key, no webhook secret, no database or Temporal access, no other project's credential.
- **MUST** run as non-root (uid 10001) under `restricted` Pod Security, no privilege escalation, all capabilities dropped, `RuntimeDefault` seccomp, with CPU/memory/ephemeral-storage limits and an `emptyDir` workspace size limit.
- **MUST** keep `backoffLimit: 0` and `activeDeadlineSeconds = timeout_seconds + 120` as the backstop to the workflow timer.
- **MUST** pin the runner image (and Claude Code version) by digest. _Why:_ a floating tag is an unreviewed code change inside every run.
- Pod output is untrusted. A pod can print `agentdesk: turn finished` at will; **MUST NOT** let a pod's output affect anything beyond its own run (no cross-run, cross-project or cross-org effect, no Kubernetes call derived from log content).
- Repo content runs code in the pod (`.claude/settings.json` hooks, `.mcp.json`). This is accepted only because of the invariants above; weakening any of them reopens it.

## 5. Untrusted input

Untrusted: ticket titles and bodies, comments and their args, labels, author names, branch names, repo file contents (including skills), pod log output, webhook payloads, query strings.

- **MUST** assume ticket and comment text is a prompt-injection attempt. Controls in order: only the bot or `OWNER`/`MEMBER`/`COLLABORATOR` can trigger (checked identically for polled comments); single-repo short-lived token; contained pod; branch protection on the default branch.
- **MUST NOT** interpolate untrusted text into shell commands, `tmux` command strings, `exec` commands, SQL, Kubernetes object names, labels or annotations. _Why:_ each is an injection sink.
- **MUST** pass untrusted text to the pod only as an env value (`PROMPT`) consumed as a quoted variable (`"$PROMPT"`), never spliced into the entrypoint script.
- **MUST** build Kubernetes names and labels only from ids we generate (`run-{runId}`, `org-{orgId}-agent-{agentId}`).
- **MUST** call `exec` with an argv array of constants (`['tmux', 'attach', '-t', 'agent']`), never a string built from input.
- **MUST** parse commands with the anchored regex on the first line only (`^/([a-z0-9-]+)(\s+.*)?$`); validate skill names and commands with `SlugName`. _Why:_ skill names become repo paths (`.claude/skills/<name>/SKILL.md`), so path traversal must be impossible.
- **MUST** render ticket, comment, skill and scrollback text in the web app as text (React escaping); no `dangerouslySetInnerHTML` without a sanitizer. Do not enable xterm addons that write the clipboard or open links without confirmation.
- **MUST** validate redirect targets (`redirect=` on sign-in/dev-login, install callbacks) as same-origin relative paths; `redirect=https://evil.example` → 400.
- **MUST** sign and verify the `state` on connection install callbacks (`{orgId, userId}` signed with `BETTER_AUTH_SECRET`), and verify the user can access the external installation before linking it to an org.

```ts
// Bad: args from a comment reach a shell
await gateway.exec(pod, ['sh', '-c', `echo ${args} > /tmp/a`]);
// Good: constant argv; user text only travels inside PROMPT
await gateway.exec(pod, ['tmux', 'kill-session', '-t', 'agent']);
```

## 6. Authorization on every endpoint

- **MUST** require a session on every `/api/*` route, SSE stream and the terminal WebSocket, and run it under `withOrg(activeOrganizationId)` after a membership check. Public exceptions are explicit and short: `/auth/*`, `/webhooks/:provider` (signature instead), `/healthz`, `/readyz`, `/api/docs`.
- **MUST** deny by default: a new controller without the session guard fails review (an automated "every route is guarded" test is **planned** in the api auth tests).
- **MUST** check project access for project-scoped routes, not just org membership.
- **MUST** authorize the terminal on connect: session (else close 4401), org member and project creator or org owner (else 4403), run `running` or `idle` (else 4409). _Why:_ `pods/exec` is shell-equivalent.
- **MUST** check the `Origin` header on the terminal WebSocket upgrade and SSE against `PUBLIC_ORIGIN`. _Why:_ browsers send cookies on cross-site WebSocket upgrades (cross-site WebSocket hijacking).
- **MUST NOT** give Kubernetes credentials, exec URLs or pod names to the browser; the api relays.
- **MUST** use `SameSite` + `HttpOnly` + `Secure` (outside localhost) session cookies via better-auth; keep the SPA same-origin with `/api` so no CORS is configured.
- **MUST** keep dev-only surfaces (`/auth/dev-login`, `/dev/*`) unregistered in production.
- **MUST** write `audit_log` for every mutating `/api` call (the audit interceptor).

## 7. Dependencies and scanning

| Control                                                                    | Status                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm-lock.yaml` committed; installs with `--frozen-lockfile` in CI        | lockfile exists; CI **(planned)** (`ci.yml`, infra spec §7.1)     |
| pnpm 10 does not run dependency install scripts unless allowed             | default; adding a package to `onlyBuiltDependencies` needs review |
| Dependency vulnerability scan (`pnpm audit` or Dependabot/Renovate alerts) | **(planned)**                                                     |
| Secret scanning (gitleaks in CI and pre-commit; GitHub push protection)    | **(planned)**                                                     |
| Base images and runner image pinned by digest; build provenance attested   | **(planned)** with Dockerfiles and `release.yml`                  |
| conftest gate P2 hardening, P4 secret contract, P5 run sandbox             | **(planned)** in `deploy/policy`                                  |
| e2e asserts a run pod cannot reach `postgres:5432` or `169.254.169.254`    | **(planned)** in `e2e.yml`                                        |

- **SHOULD** prefer well-maintained packages; justify any new dependency that touches auth, crypto, Kubernetes or process execution in the PR description.

## 8. Changes that require security review

Request a security-focused reviewer (and run `/security-review`) when a change touches:

- Auth, sessions, cookies, the session/org guards, OAuth/OIDC config, account linking, `redirect` handling.
- `withOrg`, RLS policies, database roles/grants, or any new `SECURITY DEFINER` function.
- Webhook verification, the intake pipeline, command parsing, or the authorization step of the router.
- `SecretStore`, `redact`, `redactBody`, logger redaction, anything that stores or forwards run output.
- `buildRunJob`, the runner image or entrypoint, the prompt template, Claude Code permission mode or settings.
- The terminal relay, SSE endpoints, or any new WebSocket.
- RBAC, NetworkPolicy, Pod Security, ResourceQuota, or the conftest policies.
- Code-host App permissions, token scope or lifetime.
- A new provider adapter, or a new public (unauthenticated) route.

## 9. Incidents

If a secret leaks, a run goes rogue or tenant data is exposed, follow [docs/runbooks/incident-response.md](../runbooks/incident-response.md). Every incident fix ships with a regression test.

## Checklist

```
- [ ] No secret value in Postgres, logs, Temporal inputs/results, SSE, API responses, errors, comments, Job env literals
- [ ] Secrets referenced by name; delivered to pods only via the per-run Secret (envFrom)
- [ ] Run output redacted with the run's token + credential before storage; new token formats added to redact
- [ ] Webhook: raw body, constant-time compare, verify before any write, fail closed, dedupe
- [ ] Run pod: no SA token, egress except-list intact, single-repo ≤1h token, timeout ≤3300, non-root restricted, image by digest
- [ ] Untrusted text never in shell/exec/tmux/SQL/k8s names; exec uses constant argv; names validated as SlugName
- [ ] Every route/SSE/WS authenticated + org + project check; terminal close codes 4401/4403/4409; Origin checked
- [ ] Dev-only surfaces disabled in production
- [ ] Touches an item in §8 → security reviewer requested
```

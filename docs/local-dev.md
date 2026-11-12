# Local development

Run the whole control plane on one machine: Postgres and the Temporal dev server in containers, and the API, the
worker and the web app as local Node processes. With the defaults, nothing outside the machine is needed: the `fake`
provider stands in for GitHub, and `KUBE_MODE=fake` runs each "run pod" as a local Node process.

## Prerequisites

- **Node 22** (`.nvmrc`; 22.9 or newer for `--env-file-if-exists`) and **pnpm 10** (`corepack enable`).
- **Docker** with the Compose plugin, or **Podman** with `podman compose`. The dev scripts call `docker compose`
  unless you set `COMPOSE`:

  ```bash
  export COMPOSE="podman compose"   # Podman-only machines
  ```

## Start

```bash
pnpm install
cp .env.example .env    # optional: `pnpm dev` copies it for you when .env is missing
pnpm dev                # or: COMPOSE="podman compose" pnpm dev
```

`pnpm dev` (`scripts/dev.sh up`) does this, in order:

1. creates `.env` from `.env.example` if it does not exist;
2. `$COMPOSE up -d --wait`: Postgres 18 on `localhost:54329` and the Temporal dev server (`temporalio/temporal:1.9.1`,
   namespace `agentdesk` created at start) on `localhost:7233`, both healthy before it continues;
3. `pnpm db:migrate`: creates or updates the database roles and databases, then applies pending migrations (safe to
   rerun);
4. starts the API (`:3000`), the worker and the web app (`:5173`) with `turbo run dev`. Set `DEV_WEB=0` to skip the web
   app.

Ctrl-C stops the Node processes. `pnpm dev:down` (alias `pnpm stop`) stops the containers and kills any fake run pods
that are still running. Both honour `COMPOSE`.

Ready check: `curl localhost:3000/readyz` returns `{"status":"ok"}` once Postgres and Temporal are reachable.

| What               | Where                                             |
| ------------------ | ------------------------------------------------- |
| API                | http://localhost:3000 (OpenAPI UI at `/api/docs`) |
| Web app            | http://localhost:5173                             |
| Temporal UI        | http://localhost:8233 (namespace `agentdesk`)     |
| Postgres           | `postgres://postgres:postgres@localhost:54329`    |
| Fake provider data | `.agentdesk/fake/` (board, skills, secrets, pods) |

Environment variables set in your shell override `.env` (for example `KUBE_MODE=kubeconfig pnpm dev`).

## Sign in

Dev login creates the user (and a personal org) on first use and sets the session cookie:

- http://localhost:3000/auth/dev-login?handle=me&redirect=/
- http://localhost:5173/auth/dev-login?handle=me&redirect=/ once the web app's Vite proxy for `/api` and `/auth` is
  merged.

Dev login and the `/dev/*` routes exist only when `NODE_ENV` is not `production` (and `AUTH_DEV_LOGIN=true` /
`ENABLE_FAKE_PROVIDER=true`).

## Trigger a run by hand (fake provider)

After signing in, install the fake connection and create a project on `dev/demo` with an agent credential, a skill and
a rule (in the web app, or as `scripts/e2e-local.ts` does with the API). Then add a ticket and a command comment on the
fake board. `/dev/*` needs your session cookie:

```bash
# Sign in and keep the cookie
curl -s -c /tmp/ad.cookies -o /dev/null 'http://localhost:3000/auth/dev-login?handle=me&redirect=/'

# A ticket on the fake board
curl -s -b /tmp/ad.cookies -H 'content-type: application/json' \
  -d '{"repoPath":"dev/demo","number":1,"kind":"issue","title":"Try Agent Desk"}' \
  http://localhost:3000/dev/fake/tickets

# A command comment, delivered now as a webhook ("deliver":"poll" leaves it for the project's poller instead).
# Add "projectId":"<uuid>" to pick the project; the default is your newest project on that repo.
curl -s -b /tmp/ad.cookies -H 'content-type: application/json' \
  -d '{"repoPath":"dev/demo","ticketNumber":1,"body":"/code-review please","deliver":"webhook"}' \
  http://localhost:3000/dev/fake/comments

# Comments the bot posted back (start and finish)
curl -s -b /tmp/ad.cookies 'http://localhost:3000/dev/fake/posted?repoPath=dev/demo'
```

The fake run pod echoes each line typed in the terminal, ends a "turn" two seconds after each input, and exits when the
run is finished. Put `--fake-fail` in the comment to make it exit with code 3 after the first turn, or `--fake-pending`
to keep the pod Pending.

The fake board is shared by every org on the machine (one repo, `dev/demo`); the connection is per org.

## End-to-end check

With the stack running (`pnpm dev` in another shell):

```bash
pnpm test:e2e:local
```

It runs three scenarios, each in a new org (dev login `e2e-<random>`), and prints `PASS`/`FAIL` per scenario; the exit
code is non-zero if any fails:

1. **webhook**: fake install, project `dev/demo` (webhook mode), agent credential, skill and rule `code-review`, ticket +
   `/code-review please` comment delivered as a webhook; the run reaches `idle`; the terminal WebSocket echoes typed
   input; finish; the run SSE stream ends with `succeeded`; start and finish comments are on the ticket.
2. **polling**: the same with a polling project (`pollIntervalSeconds: 300`); the comment is picked up after the script
   triggers the `poll-<projectId>` Temporal Schedule.
3. **failure**: a `--fake-fail` comment; the run ends `failed` and the finish comment is posted.

It also checks that the agent credential value never comes back in any response, SSE frame or terminal output. Each
scenario deletes its project at the end. `E2E_BASE_URL` overrides `http://localhost:3000`; `PUBLIC_ORIGIN` and the
Temporal settings come from `.env`.

## Tests

```bash
pnpm test        # all packages (Testcontainers starts its own Postgres; @temporalio/testing downloads a server once)
pnpm typecheck
pnpm lint
```

## Tracing (optional)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (for example `http://localhost:4318`) and the API and the worker export OpenTelemetry
traces over OTLP/HTTP to `<endpoint>/v1/traces` (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` overrides the full URL,
`OTEL_SERVICE_NAME` the service name; defaults `agentdesk-api` and `agentdesk-worker`). Spans cover the Temporal client
calls (start/signal), workflow and activity execution, linked across processes, plus the spans Better Auth emits. Left
empty (the default), no tracer is registered and nothing is exported. An unreachable collector never blocks startup.
Workflows started before tracing was turned on simply have no parent span.

## Optional: a real GitHub App

1. Create a GitHub App (Settings > Developer settings > GitHub Apps):
   - Callback URL: `http://localhost:5173/auth/callback/github` (sign-in with GitHub).
   - Repository permissions: Issues and Pull requests read & write (ticket comments), Contents read & write (skills
     live in the repository), Metadata read.
   - Webhook: leave it inactive locally and use **Polling** mode for projects (GitHub cannot reach localhost).
2. Generate a client secret and a private key, then set all six values in `.env` (all or none):
   `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY` (the PEM, newlines as `\n`), `GITHUB_WEBHOOK_SECRET`,
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
3. Restart `pnpm dev`, sign in with GitHub, install the App on a test repository and create a project in Polling mode.

## Optional: a real cluster

`KUBE_MODE=kubeconfig` runs runs as Kubernetes Jobs in `RUNS_NAMESPACE` (default `agentdesk-runs`) of the cluster that
`KUBECONFIG` (or `~/.kube/config`) points at, with the image `RUNNER_IMAGE`. The namespace must exist, and the identity
needs to create/get/delete Jobs and Secrets, read Pods and their logs, exec into Pods (terminal), and list/delete Secrets
(the daily reconcile removes leaked run Secrets).

## Troubleshooting

- **`docker: unknown command: compose`**: no Compose plugin. Use `COMPOSE="podman compose" pnpm dev`, or install the
  plugin.
- **Testcontainers cannot find a container engine (Podman)**: point it at the Podman socket and disable Ryuk:

  ```bash
  export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
  export TESTCONTAINERS_RYUK_DISABLED=true
  ```

  `podman compose` does not need these; it talks to the Podman machine directly.

- **Reset all local state** (database, Temporal history, fake board, fake secrets and pods):

  ```bash
  pnpm dev:down -v      # compose down with volumes (or: $COMPOSE down -v)
  rm -rf .agentdesk
  ```

  Do this too after pulling a change to the fake provider's file formats.

- **A webhook delivery shows outcome `error`**: routing failed after the delivery was recorded (the cause is in the API
  log, by error name). That outcome is final for that delivery id: a redelivery of the same id is treated as a
  duplicate. A polling project picks the comment up on its next poll (a different delivery id); in webhook mode, post
  the comment again.
- **Port already in use**: the stack uses 3000, 5173, 7233, 8233 and 54329.
- **Leftover fake pods** after a crash: `pnpm dev:down` kills them (`pkill -f kube/fake-pod.mjs`).

## Known gaps

Parked during review; a developer should know them:

- **RBAC for reconcile**: the daily reconcile lists and deletes Secrets in the runs namespace; the cluster Role must
  grant `list` and `delete` on Secrets there (the infra chart is not in this repo yet).
- **Runner image contract** (the fake pod mirrors it; the real runner must match):
  - the agent credential arrives as `CLAUDE_CODE_OAUTH_TOKEN` (type `oauth_token`) or `ANTHROPIC_API_KEY` (type
    `api_key`);
  - the final scrollback is captured with `tmux capture-pane -J` (joined lines, so a wrapped secret is still redacted);
  - stdout log markers: `agentdesk: session started`, `agentdesk: turn finished`, `agentdesk: final scrollback begin`
    / `agentdesk: final scrollback end`.
- Terminal sessions and the `resumed` throttle are limited per API process (4 terminals per run); with several API
  replicas the limits are per replica.
- Issue runs check out `main`: the project's default branch is not stored yet.
- No Dockerfiles, Helm chart or cluster e2e yet (deferred in the plan).

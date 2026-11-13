# Run Agent Desk locally

Start the whole stack (Postgres, Temporal, api, worker, web) on your laptop with devbox, sign in, and trigger a run through the fake provider. No GitHub App or Kubernetes needed.

**Applies to:** anyone developing on this repo, humans and agents.

## 1. Prerequisites (once)

| Tool                                                                          | Why                                                          | Check            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------- |
| [devbox](https://www.jetify.com/devbox) ≥ 0.18                                | Pins Node 22, pnpm 10 and docker-compose (see `devbox.json`) | `devbox version` |
| A Docker-compatible engine (Docker Desktop, or Podman with the Docker socket) | Runs Postgres and the Temporal dev server                    | `docker ps`      |

You don't need Node or pnpm installed globally; devbox provides them. pnpm switches itself to the version in `package.json#packageManager`.

## 2. Start

```sh
devbox run dev        # TUI: one pane per process. Press F10 (or Ctrl-C) to quit.
# or
devbox run dev-bg     # same, in the background
devbox services ls    # status of each process
```

`devbox run dev` does the following, in order:

1. `devbox run setup` copies `.env.example` to `.env` if `.env` is missing, then runs `pnpm install --frozen-lockfile`.
2. `devbox services up` starts `process-compose.yaml`:

| Process    | What                                                                    | Ready when           |
| ---------- | ----------------------------------------------------------------------- | -------------------- |
| `postgres` | `postgres:18` on `localhost:54329` (user/password `postgres`)           | `pg_isready`         |
| `temporal` | Temporal dev server on `localhost:7233`, namespace `agentdesk`          | cluster health OK    |
| `migrate`  | One-shot: roles and migrations (`pnpm --filter @agentdesk/api migrate`) | exits 0              |
| `api`      | NestJS on `localhost:3000`                                              | `GET /readyz` is 200 |
| `worker`   | Temporal worker                                                         | —                    |
| `web`      | Vite on `127.0.0.1:5173`                                                | `GET /` is 200       |

App config comes from `.env`. If you change a port there, also change it in `process-compose.yaml`.

## 3. URLs

| What        | URL                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Web app     | http://localhost:5173                                                                              |
| API         | http://localhost:3000 (`/healthz`, `/readyz`)                                                      |
| Temporal UI | http://localhost:8233 (namespace `agentdesk`)                                                      |
| Storybook   | http://localhost:6006, started separately (see [storybook-and-parity.md](storybook-and-parity.md)) |

## 4. Sign in and trigger a run

With `AUTH_DEV_LOGIN=true` (the default in `.env.example`):

1. Open `http://localhost:5173/auth/dev-login?handle=me&redirect=/` (the web app proxies `/api` and `/auth` to the API; on `:3000` the redirect to `/` would 404 because the API has no root route). Dev login creates the user and a personal org on first use, and exists only when `NODE_ENV` is not `production`.
2. In the setup flow, choose the **fake** connection and the repo `dev/demo`. Add any string as the agent credential, add the `code-review` skill, and create a rule `code-review`.
3. Post a comment as if it came from the provider:

```sh
curl -s -X POST http://localhost:3000/dev/fake/comments \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"repoPath":"dev/demo","ticketNumber":1,"body":"/code-review please","deliver":"webhook"}'
```

`/dev/*` needs your session cookie: `curl -c cookies.txt -o /dev/null 'http://localhost:3000/auth/dev-login?handle=me&redirect=/'`. Create the ticket first with `POST /dev/fake/tickets` (`{"repoPath":"dev/demo","number":1,"kind":"issue","title":"Try Agent Desk"}`). Use `"deliver":"poll"` to leave the comment for the project's poller, and add `"projectId":"<uuid>"` to pick a project (the default is your newest project on that repo).

4. The run appears in the list, reaches **Idle**, and you can attach to the terminal. Type `ok` and press Enter: it echoes back. Then click **Finish**.
5. See what the bot posted: `curl -s 'http://localhost:3000/dev/fake/posted?repoPath=dev/demo'`.

With `KUBE_MODE=fake`, each run is a scripted child process whose state lives in `.agentdesk/fake/`. The fake pod echoes each line typed in the terminal, ends a turn two seconds after each input, and exits when the run is finished. Put `--fake-fail` in the comment to make it exit with code 3 after the first turn, or `--fake-pending` to keep the pod Pending. The fake board is shared by every org on the machine (one repo, `dev/demo`); the connection is per org. To use a real GitHub App instead, see [connect-github-app-local.md](connect-github-app-local.md).

## 5. Stop and reset

```sh
devbox run stop       # stop process-compose and the containers (data is kept)
devbox run db-reset   # wipe Postgres, Temporal history and fake-provider state
```

After `db-reset`, the next `devbox run dev` migrates an empty database. More database tasks: [database-local.md](database-local.md).

## 6. Without devbox

`pnpm dev` (`scripts/dev.sh up`) works with Node 22.9+ and pnpm 10. It creates `.env` if missing, runs `$COMPOSE up -d --wait`, applies migrations (`pnpm db:migrate`, safe to rerun), then starts api, worker and web with turbo. `DEV_WEB=0` skips the web app. `pnpm stop` stops the containers and kills leftover fake pods. `COMPOSE` defaults to `docker compose`; on Podman-only machines use `COMPOSE="podman compose" pnpm dev`.

## 7. End-to-end check

With the stack running: `pnpm test:e2e:local` (or `devbox run e2e-local`). See [tests-and-e2e.md](tests-and-e2e.md).

## 8. Optional: tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (for example `http://localhost:4318`) and the api and worker export OpenTelemetry traces over OTLP/HTTP to `<endpoint>/v1/traces` (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` overrides the full URL, `OTEL_SERVICE_NAME` the service name). Left empty (the default), nothing is exported and an unreachable collector never blocks startup.

## 9. Optional: a real cluster

`KUBE_MODE=kubeconfig` runs each run as a Kubernetes Job in `RUNS_NAMESPACE` (default `agentdesk-runs`) of the cluster `KUBECONFIG` points at, using `RUNNER_IMAGE`. The namespace must exist. The identity needs to create/get/delete Jobs and Secrets, read Pods and logs, exec into Pods (terminal), and **list/delete Secrets** (the daily reconcile removes leaked run Secrets). The runner image contract: the agent credential arrives as `CLAUDE_CODE_OAUTH_TOKEN` (`oauth_token`) or `ANTHROPIC_API_KEY` (`api_key`), and the final scrollback is captured with `tmux capture-pane -J`.

## 10. Troubleshooting

| Symptom                                                     | Fix                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web` exits after about 60 s with code -1                   | The readiness probe never reached `127.0.0.1:5173`. Check that nothing else holds the port (`lsof -iTCP:5173 -sTCP:LISTEN`); the command pins `--host 127.0.0.1 --strictPort`.                                         |
| `postgres` or `temporal` stuck "Not Ready" on the first run | The image is still being pulled. Wait, or run `docker-compose pull` first.                                                                                                                                             |
| `port is already allocated`                                 | Another stack is using 54329, 7233 or 8233: `docker ps`, then stop it.                                                                                                                                                 |
| `migrate` failed                                            | Read its log in the TUI. Make sure `.env` has the `DATABASE_*` URLs from `.env.example`. If a dev migration changed, run `devbox run db-reset`.                                                                        |
| Process logs                                                | Use the TUI, or read `$TMPDIR/process-compose-$USER.log`                                                                                                                                                               |
| `devbox services stop` says nothing is running              | Containers may still be up: `docker-compose -f docker-compose.yml stop`                                                                                                                                                |
| Webhook delivery shows outcome `error`                      | Routing failed after the delivery was recorded (cause is in the api log). That outcome is final for that delivery id; a polling project picks the comment up on its next poll, in webhook mode post the comment again. |
| Leftover fake pods after a crash                            | `pnpm stop` kills them (`pkill -f 'kube/fake-pod\.mjs'`)                                                                                                                                                               |
| `docker: unknown command: compose`                          | No Compose plugin: use `COMPOSE="podman compose" pnpm dev`                                                                                                                                                             |

Known limits: terminal sessions and throttles are per api process (4 terminals per run), and there are no Dockerfiles, Helm chart or cluster e2e yet.

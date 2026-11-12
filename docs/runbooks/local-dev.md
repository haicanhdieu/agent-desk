# Run Agent Desk locally

Start the whole stack (Postgres, Temporal, api, worker, web) on your laptop with devbox, sign in, and trigger a run through the fake provider. No GitHub App or Kubernetes needed.

**Applies to:** anyone developing on this repo, humans and agents.

> **Status (2026-11-12):** `api` and `worker` are still placeholders. Their processes exit straight away and show `Completed` in `devbox services ls`. Postgres, Temporal and web work today. The steps marked _(once backend lands)_ start working when `feat/backend` merges.

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

## 4. Sign in and trigger a run _(once backend lands)_

With `AUTH_DEV_LOGIN=true` (the default in `.env.example`):

1. Open `http://localhost:5173/auth/dev-login?handle=me&redirect=/`. Before the Vite proxy lands, use `:3000` instead of `:5173`.
2. In the setup flow, choose the **fake** connection and the repo `dev/demo`. Add any string as the agent credential, add the `code-review` skill, and create a rule `code-review`.
3. Post a comment as if it came from the provider:

```sh
curl -s -X POST http://localhost:3000/dev/fake/comments \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"repoPath":"dev/demo","ticketNumber":1,"body":"/code-review please","deliver":"webhook"}'
```

4. The run appears in the list, reaches **Idle**, and you can attach to the terminal. Type `ok` and press Enter: it echoes back. Then click **Finish**.
5. See what the bot posted: `curl -s 'http://localhost:3000/dev/fake/posted?repoPath=dev/demo'`.

With `KUBE_MODE=fake`, each run is a scripted child process whose state lives in `.agentdesk/fake/`. To use a real GitHub App instead, see [connect-github-app-local.md](connect-github-app-local.md).

## 5. Stop and reset

```sh
devbox run stop       # stop process-compose and the containers (data is kept)
devbox run db-reset   # wipe Postgres, Temporal history and fake-provider state
```

After `db-reset`, the next `devbox run dev` migrates an empty database. More database tasks: [database-local.md](database-local.md).

## 6. Without devbox

`pnpm dev` at the root still works if you have Node 22 and pnpm installed. It runs `docker compose up -d --wait`, then turbo `dev` for api, worker and web. You then run migrations yourself with `pnpm db:migrate`.

## 7. Troubleshooting

| Symptom                                                     | Fix                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web` exits after about 60 s with code -1                   | The readiness probe never reached `127.0.0.1:5173`. Check that nothing else holds the port (`lsof -iTCP:5173 -sTCP:LISTEN`); the command pins `--host 127.0.0.1 --strictPort`. |
| `postgres` or `temporal` stuck "Not Ready" on the first run | The image is still being pulled. Wait, or run `docker-compose pull` first.                                                                                                     |
| `port is already allocated`                                 | Another stack is using 54329, 7233 or 8233: `docker ps`, then stop it.                                                                                                         |
| `migrate` failed                                            | Read its log in the TUI. Make sure `.env` has the `DATABASE_*` URLs from `.env.example`. If a dev migration changed, run `devbox run db-reset`.                                |
| Process logs                                                | Use the TUI, or read `$TMPDIR/process-compose-$USER.log`                                                                                                                       |
| `devbox services stop` says nothing is running              | Containers may still be up: `docker-compose -f docker-compose.yml stop`                                                                                                        |

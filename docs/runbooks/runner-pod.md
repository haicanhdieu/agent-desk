# Run the tests inside a runner pod

How an agent working on this repo inside an Agent Desk runner pod runs unit, integration and e2e tests. The pod is generic and hardened (uid 10001, all capabilities dropped, no root, no Docker socket, no devbox/Nix, no user namespaces), so this repo's setup script installs what the tests need, rootless, under `$HOME`, and the tests use local Postgres and Temporal binaries instead of containers.

**Applies to:** agents (and people debugging them) in a runner pod. On your own machine use devbox ([local-dev.md](local-dev.md), [tests-and-e2e.md](tests-and-e2e.md)). Test rules: [testing.md](../conventions/testing.md) §4.

## 1. Find out where you are

```sh
pnpm env:detect          # or: bash scripts/detect-env.sh [--json]
```

It prints `key=value` lines and always exits 0:

| Key                                                    | Meaning                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `mode`                                                 | `runner-pod` (Job env `AGENTDESK_*`, or uid 10001 in `/workspace`), `human-devbox`, `human-docker`, `unknown` |
| `docker_engine`, `devbox`                              | a container engine answers / devbox is on PATH                                                                |
| `postgres_bin`, `temporal_cli`, `temporal_test_server` | the rootless test tools from step 2 are installed                                                             |
| `chromium`                                             | a Playwright Chromium is installed                                                                            |
| `env_sourced`                                          | `scripts/runner-env.sh` is loaded in this shell                                                               |
| `mem_limit_mib`, `mem_used_mib`, `mem_headroom_mib`    | from the pod's cgroup                                                                                         |
| `disk_free_repo_mib`, `disk_free_home_mib`             | `df` of the repo and `$HOME`                                                                                  |
| `tests`                                                | what to run here                                                                                              |

Not `runner-pod`? Stop here and use [tests-and-e2e.md](tests-and-e2e.md).

## 2. Set up (once per pod)

The project's setup script normally does this; rerunning is safe and skips what is done.

```sh
RUNNER_SETUP_PROFILE=test bash scripts/runner-setup.sh
```

| Profile   | Adds                                                                             | Lets you run                                                  |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `minimal` | pnpm, `.env`, `pnpm install`                                                     | `pnpm typecheck`, `pnpm lint`, most unit tests                |
| `test`    | (default) Postgres 18 binaries, Temporal CLI 1.10.1, Temporal test server 1.40.0 | `pnpm test`, `scripts/runner-stack.sh`, `pnpm test:e2e:local` |
| `full`    | Playwright Chromium headless shell + its system libraries and a font             | the Playwright suites (`e2e/local`, `e2e/mock`)               |

Every download is pinned and sha256-checked before it is unpacked; a mismatch stops the script. The Debian libraries come through apt (state under `$HOME`, verified against the signed archive index) and are unpacked with `dpkg -x`, never installed. Tools land in `~/.local/opt/runner-tools` (`RUNNER_TOOLS_DIR`) and `~/.cache/ms-playwright`.

The worker's Temporal tests (`createLocal`, `createTimeSkipping`) run as **unit** tests, so with `minimal` they try to download a server at test time. Use `test` or better when the change touches `apps/worker`.

## 3. Run the tests

In every new shell, load the env first. It sets `TEST_PG_MODE=local`, `TEST_PG_BIN_DIR`, `TEMPORAL_CLI_PATH`, `TEMPORAL_TEST_SERVER_PATH`, and for `full` also `LD_LIBRARY_PATH`, `FONTCONFIG_FILE` and `PLAYWRIGHT_BROWSERS_PATH`:

```sh
source scripts/runner-env.sh
pnpm typecheck
pnpm test:unit                                  # always
pnpm test                                       # unit + integration
pnpm --filter @agentdesk/db test:integration    # one package
node scripts/fix-changed.mjs                    # instead of `devbox run fix`
```

With `TEST_PG_MODE=local`, every `startPg()` starts its own throwaway Postgres on a free loopback port (data dir under the OS temp dir, deleted on `stop()`), so packages that turbo runs at the same time never share roles. Roles, passwords and migrations are the same as with Testcontainers; `appUrl` still connects as `agentdesk_app`, so RLS is tested the same way.

## 4. Run the local e2e

```sh
scripts/runner-stack.sh up        # Postgres :54329, Temporal :7233 (namespace agentdesk), migrate, api :3000, worker
pnpm test:e2e:local               # scripts/e2e-local.ts
pnpm --filter @agentdesk/web exec playwright test e2e/local   # needs the full profile; Playwright starts Vite itself
scripts/runner-stack.sh status
scripts/runner-stack.sh down      # also stops KUBE_MODE=fake run "pods"
```

Everything listens on 127.0.0.1. State, logs and PID files are in `.agentdesk/runner-stack/` (`RUNNER_STACK_DIR`); logs are in its `logs/` folder. `RUNNER_STACK_APPS=0` starts only Postgres, Temporal and the migration. The stack uses the ports and the Postgres admin login from `.env.example`; keep them if you edit `.env`.

The mocked suite needs no stack: `pnpm --filter @agentdesk/web test:e2e:mock` (full profile).

## 5. Budget

Measured on 2026-11-16 in the runner image (arm64, `--user 10001 --cap-drop ALL --security-opt no-new-privileges --memory 4g`, network off after setup). `memory.peak` is the container cgroup's peak and includes page cache, so it overstates what the pod must really hold.

| Step                                           | Time   | `memory.peak` | Disk                                                                        |
| ---------------------------------------------- | ------ | ------------- | --------------------------------------------------------------------------- |
| Setup `full` from scratch (pnpm install ~33 s) | 69 s   | 2.1 GiB       | 2.4 GB total (repo + node_modules 0.9 GB, pnpm store 0.9 GB, tools 0.57 GB) |
| Setup rerun (everything installed)             | 3 s    |               |                                                                             |
| `test` profile tools only                      | ~9 s   |               | 254 MB (Postgres 60, Temporal CLI 112, test server 82)                      |
| `full` adds Chromium + libraries               | ~25 s  |               | 316 MB                                                                      |
| `pnpm test` (all packages, unit + integration) | ~6 min | 2.9 GiB       |                                                                             |
| `runner-stack.sh up`                           | 20 s   | 0.9 GiB       |                                                                             |
| `pnpm test:e2e:local` on the stack             | 30 s   | 1.7 GiB       |                                                                             |
| Playwright `e2e/local` on the stack (\*)       | 94 s   | 2.4 GiB       |                                                                             |

(\*) Run with network on: the app loads Google Fonts, and with no network the spec's "no console errors" check fails on `ERR_INTERNET_DISCONNECTED`. Everything else passed with the network off.

A 4 GiB pod fits each step, but not two of the heavy ones at once: run `pnpm test` with the stack down. Under full parallel load (`turbo run test` on 4 CPUs) a few timing-sensitive tests (web route tests with the 5 s default timeout, the worker's "multi-MB scrollback in linear time") can time out; they pass when rerun alone (`pnpm --filter <pkg> test <file>`).

## 6. Troubleshooting

| Symptom                                                                      | Fix                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `runner-setup: sha256 mismatch`                                              | Don't bypass it. Someone changed the file upstream, or a pin is stale: report it.                                                   |
| `the Chromium pin is for 1.65.0`                                             | apps/web's Playwright moved; update the `CHROMIUM_*` pins in `scripts/runner-setup.sh` (version, revision, sha256 for both arches). |
| Integration test tries Docker (`Could not find a working container runtime`) | `source scripts/runner-env.sh` (sets `TEST_PG_MODE=local`) or rerun setup with `test`.                                              |
| Worker test: `failed to download ephemeral server executable`                | Same: the env is not loaded, or the profile was `minimal`.                                                                          |
| `runner-stack: postgres did not start`                                       | Read `.agentdesk/runner-stack/logs/postgres.log`; a stale server from another checkout may hold :54329.                             |
| Terminal closes with `4409` in e2e                                           | The fake run pod was not recognised; check `logs/api.log` and `logs/worker.log`.                                                    |
| Chromium: `SkFontMgr ... Not implemented` and the page closes                | `FONTCONFIG_FILE` is not set: `source scripts/runner-env.sh` (full profile).                                                        |

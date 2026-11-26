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

Everything listens on 127.0.0.1. State, logs and PID files are in `.agentdesk/runner-stack/` (`RUNNER_STACK_DIR`); logs are in its `logs/` folder. `RUNNER_STACK_APPS=0` starts only Postgres, Temporal and the migration. The stack uses the ports and the Postgres admin login from `.env.example`; keep them if you edit `.env`. The stack ignores a `BOT_NAME` exported in the shell (the pod's own QA identity); set it in `.env` to change the bot login.

The mocked suite needs no stack: `pnpm --filter @agentdesk/web test:e2e:mock` (full profile).

## 5. Budget

Measured on 2026-11-16 in the runner image (arm64, `--user 10001 --cap-drop ALL --security-opt no-new-privileges --memory 4g`, network off after setup). `memory.peak` is the container cgroup's peak and includes page cache, so it overstates what the pod must really hold.

| Step                                           | Time      | `memory.peak` | Disk                                                                        |
| ---------------------------------------------- | --------- | ------------- | --------------------------------------------------------------------------- |
| Setup `full` from scratch (pnpm install ~33 s) | 69 s      | 2.1 GiB       | 2.4 GB total (repo + node_modules 0.9 GB, pnpm store 0.9 GB, tools 0.57 GB) |
| Setup rerun (everything installed)             | 3 s       |               |                                                                             |
| `test` profile tools only                      | ~9 s      |               | 254 MB (Postgres 60, Temporal CLI 112, test server 82)                      |
| `full` adds Chromium + libraries               | ~25 s     |               | 316 MB                                                                      |
| `pnpm test` (all packages, unit + integration) | not timed | 2.9 GiB       |                                                                             |
| `runner-stack.sh up`                           | 20 s      | 0.9 GiB       |                                                                             |
| `pnpm test:e2e:local` on the stack             | 30 s      | 1.7 GiB       |                                                                             |
| Playwright `e2e/local` on the stack (\*)       | 94 s      | 2.4 GiB       |                                                                             |

(\*) Run with network on: the app loads Google Fonts, and with no network the spec's "no console errors" check fails on `ERR_INTERNET_DISCONNECTED`. Everything else passed with the network off.

The table was measured under a 4 GiB cap, before the caps below. The default run pod is now 2 GiB (`RUN_POD_MEMORY_LIMIT`, 2026-11-19): a run was OOM-killed at 2 GiB by the root `pnpm typecheck`, whose two parallel `tsc` processes (~700 MB each) plus the agent filled the pod. A 2 GiB pod does not fit two heavy steps at once: run `pnpm test` with the stack down, and keep the caps below. It has not been re-measured at 2 GiB. `source scripts/runner-env.sh` also caps what one command fans out to, because vitest, turbo and Playwright size their pools from the host's CPU count, not the pod's limit: `VITEST_MAX_WORKERS=2`, `E2E_WORKERS=1` and `CHECK_CONCURRENCY=1` and `NODE_OPTIONS=--max-old-space-size=2560` (a value you already set wins). The root `pnpm test`, `typecheck`, `lint` and `test:unit` pass `--concurrency=${CHECK_CONCURRENCY:-2}` to turbo, so the cap is 1 in a run pod and 2 elsewhere. A pod that goes over its limit is killed by the kernel (exit 137); the run then resumes by itself up to the agent's "Automatic resumes after a crash" (default 5), and shows as paused after that. Under full parallel load (`turbo run test` on 4 CPUs) a few timing-sensitive tests (web route tests with the 5 s default timeout, the worker's "multi-MB scrollback in linear time") can time out; they pass when rerun alone (`pnpm --filter <pkg> test <file>`).

## 6. Optional: Serena (semantic code tools)

Serena gives Claude Code symbol-aware tools (find a symbol, find its references, edit by symbol) on top of language servers. It is off by default. Turn it on for a pod by setting one variable when you run setup; it works with every profile, including `minimal`:

```sh
RUNNER_ENABLE_SERENA=1 RUNNER_SETUP_PROFILE=minimal bash scripts/runner-setup.sh
```

Valid values are unset, `0` and `1`; anything else stops setup with exit 64. The work is done by `scripts/runner-serena.sh`, which only runs on Linux and only when the `claude` CLI is on `PATH` (otherwise it prints a message and skips).

What setup installs and writes, as the runner user:

| Where                                | What                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `~/.local/bin`                       | `uv` 0.9.28 (sha256-checked release) and the `serena` command (registered by absolute path)            |
| `~/.local/share/uv`                  | the Serena tool environment (`serena-agent` 2.1.0, with a uv-provided Python 3.12)                     |
| `~/.serena`                          | Serena's own config and caches, created on first use                                                   |
| `~/.claude.json` (local scope)       | the `serena` MCP server entry for this checkout, with `--agent-interface tools` and `--project <repo>` |
| `<repo>/.serena`                     | Serena's project data; the script adds it to `.git/info/exclude` so it is never committed              |
| `<repo>/.claude/settings.local.json` | Serena's four Claude Code hooks, merged into the file (already in this repo's `.gitignore`)            |

Things to know:

- Serena line numbers are 0-based. Claude Code's own file tools are 1-based.
- The first use of a language downloads that language's server, so the pod needs network access then. Nothing is prefetched at setup.
- Check it: `uv tool list` shows `serena-agent v2.1.0`, and `claude mcp get serena` shows `Command:` (the absolute path of `serena`, because the agent's `PATH` has no `~/.local/bin`) and the `Args:` line with `--project <repo>`. For the hooks, `grep -c serena-hooks .claude/settings.local.json` prints 4 (if you added no other lines that mention `serena-hooks`).
- When it takes effect: Claude Code reads its MCP servers when it starts. On a fresh pod it works when setup runs as the project's `SETUP_SCRIPT` (before Claude starts). If you run setup in a live session, Serena appears after the next resume or restart.
- Time: setup is capped by `SETUP_TIMEOUT_SECONDS` (default 600). The uv and Python download alone measured 66 to 112 seconds, so keep headroom with the other profile steps. A rerun is cheap but not free: `claude mcp get` health-checks the server, which starts it once per rerun.
- Failure is fail-closed: if Serena setup fails (download, sha256 mismatch, `claude mcp add`), `runner-setup.sh` stops with that error under `set -e`, so a pod that opted in never looks ready without Serena. Fix the cause and rerun, or unset the flag.
- Lifecycle: everything lives on the pod's volume, so it survives a resume. A recreated volume starts empty: rerun setup with the flag. Rerunning does not reinstall or re-register when Serena is already at the pinned version and registered for this checkout, but every run still rewrites `.claude/settings.local.json` (re-formatted as 2-space JSON).
- Upgrade: bump `SERENA_VERSION` (and `UV_VERSION` plus both sha256 values if uv moves) in `scripts/runner-serena.sh`, then rerun setup. A changed pin reinstalls.
- Hooks: setup adds the four hooks from [Serena's Claude Code setup](https://oraios.github.io/serena/02-usage/030_clients.html), to get the agent to use Serena. Each calls `serena-hooks` by its quoted absolute path:
  - `remind` (`PreToolUse`, every tool) nudges the agent to use Serena after repeated searches or code reads, shell ones included. It denies one tool call, then waits at least 2 minutes before it can deny again.
  - `auto-approve` (`PreToolUse`, `mcp__serena__*`) approves Serena's tools in `acceptEdits` or `auto` mode. Runs use `bypassPermissions`, so it has no effect there.
  - `activate` (`SessionStart`) prompts the agent to activate the project and read Serena's instructions.
  - `cleanup` (`SessionEnd`) removes the session's hook data.
- Serena calls the hooks alpha.
- Setup never edits `.claude/settings.json`. In `settings.local.json` it keeps your other settings and hooks, a rerun adds no duplicates, and a Serena hook with an old path is replaced. An empty or whitespace-only file counts as `{}`. If the file is not a JSON object, or its `hooks` section is malformed, setup stops and leaves the file untouched.
- Remove the hooks by deleting the `serena-hooks` entries from `.claude/settings.local.json`. Turning the flag off does not remove them. Like the MCP server, they apply when Claude Code starts.
- The script does not edit `CLAUDE.md` or `AGENTS.md`. A project that opts in can add this to its own file:

```md
## Code tools

Use Serena for symbol lookup, find-references and symbol-aware edits. Use plain search for text, config and docs.
Serena line numbers are 0-based.
```

## 7. Troubleshooting

| Symptom                                                                      | Fix                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner-setup: sha256 mismatch`                                              | Don't bypass it. Someone changed the file upstream, or a pin is stale: report it.                                                                                                                                    |
| `the Chromium pin is for 1.65.0`                                             | apps/web's Playwright moved; update the `CHROMIUM_*` pins in `scripts/runner-setup.sh` (version, revision, sha256 for both arches).                                                                                  |
| Integration test tries Docker (`Could not find a working container runtime`) | `source scripts/runner-env.sh` (sets `TEST_PG_MODE=local`) or rerun setup with `test`.                                                                                                                               |
| Worker test: `failed to download ephemeral server executable`                | Same: the env is not loaded, or the profile was `minimal`.                                                                                                                                                           |
| `runner-stack: postgres did not start`                                       | Read `.agentdesk/runner-stack/logs/postgres.log`; a stale server from another checkout may hold :54329.                                                                                                              |
| Terminal closes with `4409` in e2e                                           | The fake run pod was not recognised; check `logs/api.log` and `logs/worker.log`.                                                                                                                                     |
| Chromium: `SkFontMgr ... Not implemented` and the page closes                | `FONTCONFIG_FILE` is not set: `source scripts/runner-env.sh` (full profile).                                                                                                                                         |
| `runner-serena: skipping, the claude CLI is not on PATH`                     | Serena was not set up. Install or expose `claude`, then rerun setup with `RUNNER_ENABLE_SERENA=1`.                                                                                                                   |
| `runner-serena: claude mcp add failed`                                       | Serena is installed but not registered, and setup stopped with this error. Run the `claude mcp add --scope local serena -- ~/.local/bin/serena start-mcp-server ...` line by hand, or fix the cause and rerun setup. |
| Serena tool fails on first use of a language                                 | The language server download needs network access; allow egress and retry.                                                                                                                                           |

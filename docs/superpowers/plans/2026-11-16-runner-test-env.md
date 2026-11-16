# Runner Test Environment (Phase 0) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent working on this repo inside a runner pod can run `pnpm test` (unit + integration) and the local e2e suites, and every agent can tell which environment it is in and pick the right test commands.

**Architecture:** The platform pod stays generic and hardened (uid 10001, drop ALL, no root, no Docker socket, no Nix, no user namespaces). This repo's own setup script installs what this repo needs, rootless, under `$HOME`: pinned, sha256-checked Postgres 18 binaries, the Temporal CLI and time-skipping test server, and (optionally) Playwright's Chromium headless shell with its system libraries unpacked from Debian packages. Two test seams let the existing tests use them: `startPg()` gets a `local` mode (one throwaway server per call on a free loopback port, so parallel packages never share cluster-global roles), and the worker's Temporal test environments take binary paths from env. A sourced env file, a no-Docker stack script and a detection script tie it together.

**Tech Stack:** Bash, TypeScript strict, Zod 4, Vitest, `@temporalio/testing` 1.25, PostgreSQL 18 (zonky build via npm `@embedded-postgres/*`), Temporal CLI 1.10.1, Playwright 1.65.

## Global Constraints

- `AGENTS.md` rules apply. Default behaviour is unchanged: without the new env vars, tests use Testcontainers and the SDK's downloaded Temporal servers exactly as before.
- No network in tests after setup (testing.md §4). The local binaries are the second permitted kind of local-process I/O, next to the container engine.
- Every download is pinned and sha256-verified before unpacking; a mismatch fails the setup. No `curl | sh`. Debian packages go through apt, which verifies them against the signed archive index.
- Setup stays well under the 600 s setup timeout and is idempotent.
- Not sensitive: no change to the run Job spec, the runner image, migrations, auth, secrets or the terminal.

## Out of scope (follow-up)

- A **platform-level ADR** for test infrastructure in run pods: a shared setup cache (so each run does not re-download ~600 MB), service sidecars (Postgres/Temporal as native sidecar containers), and per-project resource profiles. Phase 0 proves the rootless path inside today's generic pod first.
- CI changes. CI keeps Testcontainers.

## Tasks

- [x] **1. `startPg()` local mode** (`packages/db`). `test-pg-config.ts` parses `TEST_PG_MODE` (`testcontainers` | `local`), `TEST_PG_BIN_DIR`, `TEST_PG_DATA_ROOT` with Zod. `local-pg.ts` runs `initdb` + `postgres` per call (own data dir, free port, 127.0.0.1, scram auth, durability off) and stops and deletes it in `stop()`. `testing.ts` picks the server; bootstrap, roles, passwords and migrations are unchanged and `appUrl` still connects as `agentdesk_app`. Unit tests first (stub binaries, injected readiness probe), no Docker.
- [x] **2. Temporal binary paths** (`apps/worker`). `test/helpers/temporal-env.ts`: `TEMPORAL_CLI_PATH` (dev server, `createLocal`) and `TEMPORAL_TEST_SERVER_PATH` (time-skipping server, `createTimeSkipping`) become `existing-path` executables. All seven call sites use the helper. `turbo.json` passes the new vars through to test tasks.
- [x] **3. Setup and stack scripts** (`scripts/`). `runner-setup.sh` with `RUNNER_SETUP_PROFILE=minimal|test|full` (default `test`); `runner-env.sh` (sourced); `runner-stack.sh up|down|status` (Postgres + Temporal + migrate + api + worker, PID and log files, no devbox/Docker).
- [x] **4. Detection and guidance.** `scripts/detect-env.sh` (`pnpm env:detect`, `--json`) with a scripts test; `docs/runbooks/runner-pod.md`; a runner-pod section in `tests-and-e2e.md`; testing.md §4 amendment; a few lines in `AGENTS.md`; the dev-build Verifier prompt.
- [x] **5. Measure** in the runner image as uid 10001, `--cap-drop ALL`, `no-new-privileges`, `--memory 4g`, network off after setup. Numbers go in runner-pod.md "Budget".

## PR split

One concern each, in order: (1) `feat(db)` local Postgres mode; (2) `test(worker)` Temporal binary paths + `turbo.json`; (3) `chore(scripts)` setup/env/stack/detect scripts; (4) `docs` runbooks, conventions, AGENTS.md and the dev-build prompt (agent config: waits for a human).

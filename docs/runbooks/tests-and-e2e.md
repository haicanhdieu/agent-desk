# Run tests and end-to-end checks

How to run unit, integration, mocked e2e and full local e2e tests. What to test and how to write tests is in [testing.md](../conventions/testing.md).

**Applies to:** anyone about to push, review or debug a failing check.

## 1. Before you push

```sh
devbox run fix          # before EVERY commit: prettier --write + eslint --fix on changed files, re-stages
devbox run fix-staged   # same, staged files only
devbox run check        # pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

`fix` touches only the files changed in your working tree, so it's fast and never reformats unrelated code. If it exits non-zero, the remaining errors are ones the tools can't fix; fix just those and rerun. Don't run the repo-wide `devbox run format` in a feature commit.

All four `check` gates must pass before you ask for review ([git-workflow.md](../conventions/git-workflow.md)).

## 2. Unit and integration tests

```sh
devbox run test                                              # every package (turbo, cached)
pnpm --filter @agentdesk/web test                            # one package
pnpm --filter @agentdesk/web test src/ds/Button.test.tsx     # one file
pnpm --filter @agentdesk/web exec vitest run -t "toRunSummary"  # by test name
pnpm --filter @agentdesk/web exec vitest                     # watch mode
```

Run these inside `devbox shell`, or prefix them with `devbox run --`.

- Backend integration tests start their own Postgres through Testcontainers, so a container engine must be running (`docker ps`). They do **not** use the dev database on 54329.
- `pnpm test` doesn't need the dev stack running.
- If turbo replays a stale result, run `pnpm turbo run test --force`.

## 3. Mocked end-to-end (frontend only, no backend)

These are Playwright tests against the SPA running on MSW. _(Available after frontend plan Task 15.)_

```sh
devbox run playwright-install   # once: downloads Chromium
devbox run e2e-mock             # vite build --mode mock + playwright test e2e/mock
```

To click through the mocked app by hand: `devbox run dev-mock`, then open http://localhost:5173.

## 4. Full local end-to-end

These run against the real stack with the fake provider and `KUBE_MODE=fake`.

```sh
devbox run dev-bg                # start the stack (see local-dev.md)
devbox services ls               # wait until api and web are Ready
devbox run e2e-local             # scripts/e2e-local.ts, then web Playwright e2e/local
```

`scripts/e2e-local.ts` runs three scenarios: a webhook-mode run, a polling-mode run (it triggers the poll schedule through Temporal), and a run with `--fake-fail` that must end `failed`. The Playwright suite does the same comment → idle → terminal → finish flow through the UI.

The e2e tests create their own users (`e2e-<rand>`), so they can run against a stack you are also using. For a clean slate, run `devbox run db-reset` first.

## 5. Visual parity

See [storybook-and-parity.md](storybook-and-parity.md).

## 6. Debugging a failure

| Failure                            | Look at                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vitest                             | Rerun the single file with `-t`; add `--reporter=verbose`                                                              |
| Testcontainers can't start         | `docker ps` works? With Podman, set `DOCKER_HOST` to the Podman socket and `TESTCONTAINERS_RYUK_DISABLED=true`         |
| Playwright                         | `pnpm --filter @agentdesk/web exec playwright show-report`; rerun with `--headed` or `--debug`                         |
| e2e-local stuck waiting for `idle` | Temporal UI http://localhost:8233: find the run's workflow and read its history; worker logs in the TUI                |
| Flaky timing                       | Tests must inject time and ids ([testing.md](../conventions/testing.md)). Treat the flake as a bug, don't add retries. |

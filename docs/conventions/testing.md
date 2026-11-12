# Testing guidelines

What to test at each layer of Agent Desk, where tests live, and how to keep them fast, deterministic and offline.
Tests are the contract between the parallel backend and frontend streams and the safety net for tenant isolation, so they are written first.

**Applies to:** every package: `apps/api`, `apps/worker`, `apps/web`, `packages/contracts`, `packages/core`, `packages/db`. Source of truth: §9 of `docs/superpowers/specs/2026-11-12-control-plane-design.md`, §7 of `docs/superpowers/specs/2026-11-12-frontend-design.md`, and both localhost plans.
Related: [architecture.md](architecture.md), [backend.md](backend.md), [database.md](database.md), [frontend.md](frontend.md), [security.md](security.md), [typescript.md](typescript.md), [git-workflow.md](git-workflow.md), [code-review-checklist.md](code-review-checklist.md).

> Status: Vitest runs today in `apps/web` and `packages/contracts`. `api`, `worker`, `core` and `db` have no `test` script yet; Testcontainers, `@temporalio/testing`, MSW, Playwright e2e and coverage reporting arrive with the backend and frontend plans. CI does not exist yet (owned by the infra spec): every "in CI" rule below is (planned) until it does.

## 1. Test pyramid per layer

| Layer                      | Tool                                                                                                              | Lives in                                        | Covers                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit: core logic           | Vitest                                                                                                            | `packages/core/test/**`, colocated `*.test.ts`  | Command parser, router and guards, adapters against recorded payloads, redaction, config schema, job spec, log parser                                                 |
| Unit: web logic            | Vitest                                                                                                            | `apps/web/src/**/*.test.ts`                     | DTO → view mappers, `fieldErrorsFromProblem`, search schemas, key factories, `applyRunEvent`                                                                          |
| Contracts                  | Vitest                                                                                                            | `packages/contracts/src/*.test.ts`              | Route table shape, request schema rules (limits, enums, slugs), `api` client behaviour                                                                                |
| Database integration       | Vitest + Testcontainers `postgres:18`                                                                             | `packages/db/test/**`                           | Migrations, RLS leak test across two orgs on **every** table, `withOrg`, `resolve_project`, dedupe uniqueness, NOTIFY                                                 |
| API integration + contract | Nest testing module, Fastify `inject`, Testcontainers, `FakeTemporalClient`                                       | `apps/api/test/**`                              | Auth and org boundary on every route, problem+json, webhook signature/dedupe, SSE, terminal close codes; every response passes `expectContract(routeKey, res)`        |
| Worker / jobs              | `@temporalio/testing` time-skipping env, mocked activities; activities against Testcontainers + `FakeKubeGateway` | `apps/worker/test/**`                           | `RunWorkflow` (success, idle → finish, idle timeout, hard timeout, cancel at each stage, non-zero exit, replay after restart), gate FIFO, outbox sweep, poll back-off |
| UI components              | Testing Library + `user-event`                                                                                    | `apps/web/src/**/X.test.tsx`                    | Interaction: keyboard, focus, disabled states, callbacks                                                                                                              |
| Storybook                  | `stories.smoke.test.tsx` (render + axe), `coverage.test.ts`, `cssModules.test.ts`                                 | `apps/web/src/test/`                            | Every story renders with no axe violation; every prototype board has a story; every CSS module class exists                                                           |
| Routes (web)               | Testing Library + MSW (node) + memory history via `renderRoute()`                                                 | `apps/web/src/features/<area>/*.route.test.tsx` | Route renders its screen, auth redirect, 404/403/5xx boundaries, form errors, optimistic rollback (planned with `app/`)                                               |
| Visual parity              | `pnpm parity` (Playwright screenshots)                                                                            | `apps/web/scripts/parity.mjs`                   | Storybook vs prototype boards, reviewed by hand; see [frontend.md](frontend.md) §8                                                                                    |
| E2E                        | Playwright (`test:e2e:mock`), `pnpm test:e2e:local`                                                               | `apps/web/e2e/**`, `scripts/e2e-local.ts`       | Comment → run → terminal → finish against MSW, then the real local stack (planned)                                                                                    |

- **MUST** put each behaviour at the lowest layer that can prove it. Why: unit tests are fast and pinpoint failures; e2e is a smoke check, not a coverage tool.
- **MUST** add a database integration test for every new table with `org_id`, proving org A cannot read or write org B's rows. Why: RLS is our tenancy boundary (see [database.md](database.md), [security.md](security.md)).
- **MUST** assert every API response with `expectContract`, and every MSW fixture with its contracts schema (`mocks/msw/contract.test.ts`). Why: both sides drift independently; contract tests catch it.
- **MUST** test workflows in the time-skipping environment, never with real sleeps, and add a replay test when changing workflow code. Why: Temporal determinism bugs only show on replay.
- **MUST NOT** mock Postgres (no pg-mem, no SQLite, no repository stubs in integration tests). Why: RLS, policies, `SECURITY DEFINER` functions and NOTIFY only exist in real Postgres.
- **MUST** connect integration tests as `agentdesk_app` (not the owner or superuser). Why: owners bypass RLS and hide leaks.

## 2. Naming and location

- **MUST** follow the package's convention:
  - `apps/web`, `packages/contracts`: colocated `X.test.ts(x)` next to `X.ts(x)`; cross-cutting web tests in `src/test/`. Vitest in web only collects `src/**/*.test.{ts,tsx}`.
  - `apps/api`, `apps/worker`, `packages/core`, `packages/db`: `test/**/*.test.ts` mirroring the source area (`test/adapters/fake.test.ts`); helpers in `test/helpers/`, recorded data in `test/fixtures/`. Small pure helpers may be colocated (`apps/api/src/auth/slug.test.ts`).
  - Web route tests: `*.route.test.tsx`; Playwright specs: `*.spec.ts` under `apps/web/e2e/{mock,local}/`.
- **MUST** name `describe` after the unit and `it` after the behaviour, in plain words. Why: the failure line should read as the broken rule.

```ts
// Bad
it('works', ...); it('test 2', ...);
// Good
describe('toRunSummary', () => {
  it('formats a 724 s final run as 12m 04s', ...);
});
```

## 3. Fixtures and factories

- **MUST** build backend test data through the real path (API call, `withOrg` insert, or a factory that parses with the contracts/Drizzle schema). Why: hand-built rows skip constraints and drift from the schema.
- **MUST** keep web fixtures in `apps/web/src/mocks/` (view fixtures for stories), `mocks/dto/` (DTO fixtures, parsed with contracts schemas) and `mocks/msw/scenarios.ts` (`signedOut()`, `serverError(routeKey)`, `problem(routeKey, problem)`). Why: one set serves Vitest, Storybook and `dev:mock`.
- **MUST** use recorded provider payloads (`packages/core/test/fixtures/github/*.json`) for adapter tests, with tokens and personal data scrubbed.
- **SHOULD** use per-entity factory functions with overrides (`makeRun({ status: 'idle' })`) once a shape appears in three or more tests. A shared factories module per package is (planned).
- **MUST** isolate state per test: reset `mockDb` and the Query client, use a fresh org per DB test (or truncate in `beforeEach`), never depend on test order.
- **MUST NOT** put real secrets in fixtures, even expired ones. Use obvious fakes (`test-token-not-real`).

## 4. No network

- **MUST NOT** reach the internet from unit, integration or web tests. Why: flaky, slow, and leaks data.
  - Providers: use the `fake` provider (`FakeStore`) or recorded payloads. GitHub is never called in tests.
  - Kubernetes: `FakeKubeGateway` / in-memory fake; real cluster only in `test:e2e:local`.
  - Temporal: `FakeTemporalClient` in API tests, time-skipping env in worker tests.
  - Secrets: `MemorySecretStore`.
  - Web: MSW with `onUnhandledRequest: 'error'` (planned with MSW); `FakeEventSource` and `FakeWebSocket` for realtime.
- The only allowed external I/O is the local container engine for Testcontainers. Podman: `export DOCKER_HOST=unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')` and `TESTCONTAINERS_RYUK_DISABLED=true`.
- Parity screenshots load Google Fonts; `pnpm parity` is a local review step, not part of `pnpm test`.

## 5. Deterministic time and ids

- **MUST** inject time: backend code takes `Clock` (`packages/core/src/clock.ts`), web mappers take `now: Date`. **MUST NOT** call `new Date()` / `Date.now()` in logic under test. Why: tests pin exact durations and relative labels.
- **MUST** use `vi.useFakeTimers()` + `vi.setSystemTime()` for timers (toast auto-dismiss, back-off, 30 s `useNow` tick, 60 s hidden-tab close) and restore with `vi.useRealTimers()` in `afterEach`.
- **MUST** use the Temporal time-skipping env for workflow timers (idle 10 min, timeouts, sweep).
- **MUST NOT** assert on generated UUIDs or `seq` values you did not choose. Seed ids in fixtures, or assert with `expect.any(String)` / relative order.
- **MUST** pin the time zone for anything that formats local time (`startedAt` "HH:mm"): `TZ=UTC` in the test script (planned) or pass a formatter. Why: CI and laptops differ.
- **MUST NOT** use `Math.random()` in assertions; e2e handles that need uniqueness (`e2e-<rand>`) are fine.

## 6. Bug fixes start with a failing test

1. Write a test that reproduces the bug at the lowest layer that shows it.
2. Run it and watch it fail for the right reason.
3. Fix the code; the test passes; the full package suite passes.
4. Commit test and fix together (see [git-workflow.md](git-workflow.md)).

- **MUST** follow these steps for every bug fix. Why: proves the fix and stops the regression from coming back.
- **SHOULD** name the test after the symptom (`it('shows each event once after SSE reconnect replays seq 3..4')`).
- New features follow the same red → green order; every plan task lists its failing test first.

## 7. Writing good tests

- **MUST** query the UI the way a user does: `getByRole` / `getByLabelText` first, `getByText` next, class names only for design-system variants (`toHaveClass('danger')`). **MUST NOT** use `data-testid` when a role works. Why: accessible queries double as a11y checks.
- **MUST** drive interactions with `userEvent.setup()`, not `fireEvent`. Why: it fires the real event sequence (focus, keydown, input).
- **MUST** await async UI with `findBy*` / `waitFor`; never `setTimeout` sleeps.
- **MUST** assert one behaviour per `it`; a failure should name one broken rule.
- **MUST** pin type-level rules with `// @ts-expect-error` (`IconButton` without `aria-label`, `tone="fail"`). Why: `pnpm typecheck` then fails if the rule is lost.
- **SHOULD** use `it.each` tables for mappers and enum-driven logic (eight run statuses, poll intervals).
- **MUST** clean up what a test opens: Testcontainers `stop()`, Nest `app.close()`, MSW `resetHandlers()`, fake timers.

```ts
// Bad: implementation detail, sleep
fireEvent.click(container.querySelector('.btn')!);
await new Promise((r) => setTimeout(r, 500));
// Good
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: 'Finish' }));
expect(await screen.findByText('Finishing…')).toBeInTheDocument();
```

```ts
// API integration: real Postgres, contract-checked, org boundary
const res = await app.inject({ method: 'GET', url: `/api/projects/${otherOrgProject}/runs/1`, cookies: alice });
expect(res.statusCode).toBe(404);
expectContract('runs.byNumber', await app.inject({ method: 'GET', url: ownRunUrl, cookies: alice }));
```

## 8. Coverage expectations

No coverage tool is installed yet (`@vitest/coverage-v8` and thresholds are planned). Until then reviewers check behaviour coverage:

- Every mapper, parser, guard and schema rule: unit tested, including edge values (0, empty, max, unknown enum).
- Every API route: happy path, auth (401), wrong org (404, never 403 leaks), validation (400 with pointers), conflict (409) where applicable.
- Every table with `org_id`: RLS leak test.
- Every workflow branch and every terminal close code: tested.
- Every `ds`/`components` export: a story (smoke + axe) and an interaction test when it has behaviour.
- Every "Review Focus" item in a plan: pinned by a named test.
- **MUST NOT** chase line coverage with assertion-free tests. Why: a test that cannot fail is noise.

## 9. Running tests

Commands for every level (unit, one file, watch, mocked e2e, full local e2e) are in the runbook [tests-and-e2e.md](../runbooks/tests-and-e2e.md). Shortcut: `devbox run check`.

- Integration tests start their own Postgres through Testcontainers; the dev stack (`devbox run dev`, Postgres on 54329, Temporal on 7233) is for local development and e2e, not for `pnpm test`.
- `vitest.workspace.ts` at the root is not read by Vitest 5; run tests through `pnpm test` / `--filter`. Moving to a root `vitest.config.ts` with `test.projects` is (planned).
- **MUST** have `pnpm test`, `pnpm typecheck` and `pnpm lint` green before asking for review. In CI: (planned).

## Checklist

- [ ] Behaviour tested at the lowest layer that proves it; e2e only for the flow.
- [ ] Bug fix includes a test that failed before the fix.
- [ ] New `org_id` table has an RLS leak test; integration tests run as `agentdesk_app` on real Postgres.
- [ ] API responses go through `expectContract`; MSW fixtures parse with contracts schemas.
- [ ] Workflow changes tested in the time-skipping env, with a replay test.
- [ ] No network: fake provider, fake gateways, MSW, fake EventSource/WebSocket.
- [ ] Time and ids injected or faked; no `Date.now()` in logic under test; timers restored.
- [ ] Test files named and placed per package convention; test names read as rules.
- [ ] No secrets in fixtures; no state shared between tests.
- [ ] New stories pass smoke + axe; parity checked for touched boards.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` green.

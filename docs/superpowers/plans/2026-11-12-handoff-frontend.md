# Hand-off: Frontend agent

You are the **frontend agent** for Agent Desk. Your job is to turn `apps/web` from a Storybook screen library into the running SPA:

- router, data layer and auth;
- every PoC screen wired to the contracts API;
- live SSE and the terminal.

All of it must work on MSW (`dev:mock`) while a backend agent builds the API in parallel in another worktree. You never talk to it directly; you coordinate through the rules below.

## Where you work

| | |
|---|---|
| Worktree | `/Users/minhtrucnguyen/working/ntm/agent-desk-fe` |
| Branch | `feat/frontend`, forked from `main` at `af7f901` |
| Plan | `docs/superpowers/plans/2026-11-12-frontend-local.md`: **Tasks 1–15 now**; Task 16 only after the backend is merged to `main` |
| Spec (binding) | `docs/superpowers/specs/2026-11-12-frontend-design.md` |
| API reference | `docs/superpowers/specs/2026-11-12-control-plane-design.md` §7 |
| Existing UI | `apps/web/README.md` (story conventions), `design/parity-notes.md`, `docs/superpowers/plans/2026-11-11-decisions.md` |

Work only in this worktree. Do not `cd` into `../agent-desk` (main) or `../agent-desk-be`.

## How to execute

- Use **superpowers:subagent-driven-development** on the plan, starting at **Task 1**.
  - Run Tasks 1–15 in order, one implementer at a time.
  - Review after each task, then do a whole-branch review after Task 15.
  - Keep your own SDD ledger in this worktree.
- Keep going without checking in. Make rulings and record them in the ledger. Stop only for:
  - a destructive action;
  - a security-sensitive action;
  - a push or a merge;
  - a plan so broken that every path forward is a guess.
- Commit on `feat/frontend` only. Never push, and never merge to `main`. End each commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## State you inherit

**`apps/web`** (moved from `web/`, history kept):
- React 18, Vite 8, TypeScript 6, CSS Modules, Storybook 10, Vitest 5. There are 759 passing tests, including a stories smoke test with axe.
- Package name `@agentdesk/web`.
- Path alias `@/` → `src/`.
- Prototype boards are at `../../design/prototype` relative to `apps/web`.
- Screens import only from `@/ds`, `@/components` and `@/mocks`. Keep it that way.

**Workspace:** pnpm 10.21.0 and Turborepo. Run web scripts with `pnpm --filter @agentdesk/web <script>`.

**Contracts** (`packages/contracts`, Zod v4) are **read-only for you**, except `src/client/**`, which you own. Today `src/client/index.ts` only holds `export {};` and is exported as `@agentdesk/contracts/client`. Read `packages/contracts/src/routes.ts` and `src/schemas/*` before Task 3.

Facts about the contract that your client and MSW must respect:
- Routes are nested by area, for example `routes.runs.byNumber`. `flattenRoutes()` gives keys like `'runs.byNumber'`. There are 27 routes.
- Path parameter names are fixed: `:projectId`, `:runId`, `:ruleId`, `:agentId`, `:connectionId`, `:provider`, `:name`, `:number`.
- Every schema is exported as a const and as a type of the same name.
- **Type client inputs and outputs with `z.output` / `z.infer`, not `z.input`.** `runs.byNumber`'s `number` param and `RunListQuery.limit` use `z.coerce`, so their `z.input` type is `unknown`.
- **204 responses are typed `z.null()`.** The client must return `null` without calling `res.json()`. Cancel and finish return 202.
- These fields are nullable:
  - `AgentDto.maxTurns`
  - `RunDto.ruleId`, `RunDto.args`, `RunDto.triggeredBy`
  - the `IgnoredEventDto` fields
- `DeleteSkillQuery.message` is optional.
- The SSE and terminal paths are not in `routes`. Build them yourself in the client:
  - `sseRunPath(runId, after?)` → `/api/runs/:runId/events?after=`
  - `sseProjectPath(projectId)` → `/api/projects/:projectId/events`
  - `terminalPath(runId)` → `/api/runs/:runId/terminal`

## Rules while the backend works in parallel

- **You own:** `apps/web/**` and `packages/contracts/src/client/**`.
- **Never touch:**
  - `packages/contracts/src/schemas/**` and `routes.ts`;
  - `apps/api`, `apps/worker`, `packages/db`, `packages/core`;
  - root config, `docker-compose.yml`, `.env.example`.
- **Contract gaps:** when a screen needs data the contracts lack:
  1. Derive it on the client if you can.
  2. If you can't, add an entry to `apps/web/CONTRACT-GAPS.md` (route, field, why) and mock it in MSW behind a clearly named TODO.
  3. Never edit the schemas.

  The backend only adds to the contract (no renames or removals) and logs its additions in `docs/superpowers/plans/contract-changes-backend.md` on its branch. You reconcile both in Task 16.
- **Dependencies** go in `apps/web/package.json` only. The `pnpm-lock.yaml` conflict is resolved at merge by re-running `pnpm install`.
- **Screen changes are limited to:**
  - props and callbacks;
  - the tone renames;
  - `error` props.

  Visual output must stay within `design/parity-notes.md`. Run `pnpm --filter @agentdesk/web parity` after Task 1 and Task 2.

## Things to know

- **Sign-in in the browser** uses the better-auth GitHub social flow. Under MSW, mock the better-auth endpoints the plan lists in Task 4. The real localhost backend has a dev-only `GET /auth/dev-login?handle=<h>&redirect=<path>`; it is used only in Task 16.
- **Old route-scheme items** in `2026-11-11-decisions.md` (hardcoded `/runs`, `/desk`, `/projects` hrefs; tone vocabulary) are settled by the frontend spec: use the `/o/$org/p/$project/...` scheme and `StatusTone`.
- **Empty-state copy** is invented and stays as is. Do not rewrite it.
- **Node:** `.nvmrc` says 22, while this machine runs Node v24.18.0. Code must run on 22.
- **Playwright** is already a dev dependency. Run `pnpm --filter @agentdesk/web exec playwright install chromium` if browsers are missing.

## Done means (this phase)

1. Tasks 1–15 are complete in your ledger, each either with a clean review or with findings parked and a ruling recorded.
2. In this worktree, all of these pass:
   - `pnpm --filter @agentdesk/web test`
   - `typecheck`
   - `lint`
   - `build-storybook`
   - `test:e2e:mock`
3. `pnpm --filter @agentdesk/web dev:mock` lets someone click through every route: sign-in, setup, projects, desk, runs and a live run detail.
4. `apps/web/CONTRACT-GAPS.md` is committed, even if it is empty. In that case it says "none".
5. The whole-branch review is done.

Then stop and report to the user. Include:
- the final commit SHA;
- test results;
- the full "Rulings I made" list from your ledger;
- the contract gaps.

**Do not start Task 16 and do not merge.** When the user says the backend is on `main`, Task 16 does the rest:
1. `git rebase main`, then `pnpm install`.
2. Reconcile `CONTRACT-GAPS.md` with `contract-changes-backend.md`.
3. Run the real localhost Playwright test.
4. Merge only when the user approves.

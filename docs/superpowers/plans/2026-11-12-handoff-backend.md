# Hand-off: Backend agent

You are the **backend agent** for Agent Desk. You build the control plane (api, worker, db, core) so the full comment → run → idle → terminal → finish flow works on localhost. A frontend agent works in parallel in another worktree; you never talk to it directly, so you coordinate through the rules below.

## Where you work

| | |
|---|---|
| Worktree | `/Users/minhtrucnguyen/working/ntm/agent-desk-be` |
| Branch | `feat/backend` (forked from `main` at `af7f901`) |
| Plan | `docs/superpowers/plans/2026-11-12-backend-local.md`: **Tasks 3–19** (Tasks 1–2 are done) |
| Specs | `docs/superpowers/specs/2026-11-12-control-plane-design.md` (binding), plus the backend amendments in `2026-11-12-frontend-design.md` §11 and `2026-11-12-infra-design.md` §13 |
| Background | `docs/Agent Desk — Architecture (PoC).md` §4–6 (routing, Job spec, runner entrypoint, prompt template) |

Work only in this worktree. Do not `cd` into `../agent-desk` (main) or `../agent-desk-fe`.

## How to execute

- Use **superpowers:subagent-driven-development** on the plan, starting at **Task 3**. Run Tasks 3–19 in order, one implementer at a time, with a task review after each and a whole-branch review at the end. Start a fresh SDD ledger in this worktree. Tasks 1–2 are already in git history (`6e5240c`, `af7f901`), so mark them complete in the ledger's first lines and do not re-run them.
- Keep going without checking in. Make rulings and record them in the ledger. Stop only for something destructive, something security-sensitive, a push or merge, or a plan so broken that every path forward is a guess.
- Commit on `feat/backend` only. Never push, never merge to `main`. End each commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## State you inherit

- **Workspace (Task 1):** pnpm 10.21.0 and Turborepo. The packages `@agentdesk/{contracts,db,core,api,worker,web}` exist. `api` and `worker` are placeholders with a no-op `dev` script; replace that with the real dev command when you build them. Internal libraries are consumed as source (`exports` → `./src/index.ts`), with no build step.
- **Compose:** `postgres:18` on `localhost:54329` (user `postgres` / `postgres`). Temporal dev server on `localhost:7233`, its UI on `:8233`, namespace `agentdesk`.
- **`.env.example`:** lists every config key of Task 5's `ConfigSchema`.
- **Contracts (Task 2, in `packages/contracts`):** Zod v4. Every schema is exported as a const and as a type with the same name. `routes` is nested by area, `flattenRoutes()` gives keys like `'runs.list'`, and there are 27 routes. Read `packages/contracts/src/routes.ts` before Task 5. Its path parameter names are now fixed contract:
  - `:projectId`, `:runId`, `:ruleId`, `:agentId`, `:connectionId`, `:provider`, `:name`, `:number`
- **Nullable fields that are now contract:** `AgentDto.maxTurns`; `RunDto.ruleId`, `args` and `triggeredBy`; the `IgnoredEventDto` fields.
- **Small contract details:**
  - `DeleteSkillQuery.message` is optional, so supply a default commit message such as `Delete skill <name>`.
  - 204 responses are typed `z.null()`.
  - Cancel and finish return 202.

## Rules while the frontend works in parallel

- **You own:** `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/core/**`, `packages/contracts/src/schemas/**`, `packages/contracts/src/routes.ts`, `docker-compose.yml`, root config files, `.env.example`, `scripts/**`.
- **Never touch:** `apps/web/**` or `packages/contracts/src/client/**`. The frontend owns them.
- **Contract changes must be additive only:** new optional fields, new schemas, new routes. No renames, no removals, no type narrowing. The frontend builds MSW mocks and a typed client against today's names.
- **Log every contract addition** in `docs/superpowers/plans/contract-changes-backend.md` (create it on your branch): the route or schema, the field, and why. The frontend reconciles against this file after merge.
- **Root `package.json` and `pnpm-lock.yaml`:** you may change them. The frontend only touches `apps/web/package.json`, and the lockfile conflict is settled at merge by re-running `pnpm install`.

## Known issues assigned to you

1. **`pnpm dev` cannot start compose on Podman-only machines.** The root `dev` script calls `docker compose`. Fix this in Task 19: honour a `COMPOSE` variable that defaults to `docker compose` (for example `${COMPOSE:-docker compose} up -d --wait`), and document `COMPOSE="podman compose"` in `docs/local-dev.md`.
2. **The Temporal image is unpinned.** `temporalio/temporal:latest` in `docker-compose.yml`: pin it to a version tag (Task 19 or earlier).
3. **Turbo `test` waits on builds that don't exist.** It has `dependsOn: ["^build"]` and no package has a `build` task; change it if it gets in the way.
4. **`vitest.workspace.ts` uses the old form.** Move to `test.projects` in a root Vitest config when you add root-level test orchestration.
5. **Node versions disagree.** `.nvmrc` says 22, this machine runs Node v24.18.0. Code must run on 22; don't depend on features newer than 22.
6. **Contract tests to add when you first test validation (Task 5 or 8):**
   - a schema boundary test at `timeoutSeconds: 3300`;
   - a test that the `RunListQuery.limit` default is 50.

## Environment

- **Containers:** `docker info` works on this Mac, but there is no Docker Compose plugin. Use `podman compose up -d --wait` for the compose stack.
- **Testcontainers on Podman:** if Testcontainers can't reach a daemon, export:
  `DOCKER_HOST=unix:///var/folders/83/64w45hb12zj0qcp7nfd2tnw90crlhh/T/podman/podman-machine-default-api.sock`
  `TESTCONTAINERS_RYUK_DISABLED=true`
- **Temporal tests:** `@temporalio/testing` downloads a test server binary on first use; allow network access for it.
- **No GitHub credentials are available.** Everything must work with `ENABLE_FAKE_PROVIDER=true`, `AUTH_DEV_LOGIN=true` and `KUBE_MODE=fake`. GitHub adapters are tested against recorded payloads and mocked HTTP only.

## Done means

1. Tasks 3–19 are complete in your ledger with clean reviews, or findings parked with rulings.
2. These pass in this worktree: `pnpm test && pnpm typecheck && pnpm lint`.
3. With the stack up (`pnpm dev`), `pnpm test:e2e:local` passes all three scenarios: webhook run, polling run, and a failed run.
4. `docs/local-dev.md` and `docs/superpowers/plans/contract-changes-backend.md` are committed.
5. The whole-branch review is done.

Then stop and report to the user. Include:

- final commit SHA;
- test results;
- the full "Rulings I made" list from your ledger;
- the contract additions.

Do **not** merge. The user merges `feat/backend` into `main` first, then the frontend rebases.

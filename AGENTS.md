# AGENTS.md

Agent Desk: a control plane that turns tickets into Claude Code runs, each in its own Kubernetes Job sandbox, which people can watch and attach to. It's a PoC heading toward a multi-tenant/enterprise product. Code rules are in [docs/conventions/](docs/conventions/README.md) (read the relevant one before changing an area). How-tos are in [docs/runbooks/](docs/runbooks/README.md). ADRs are in `docs/adr/`; specs and plans are in `docs/superpowers/{specs,plans}/`.

## Repo

- `apps/api`: NestJS/Fastify: HTTP, auth, webhook intake, terminal relay
- `apps/worker`: Temporal workflows and activities
- `apps/web`: Vite SPA, TanStack Router/Query, design system, Storybook
- `packages/contracts`: Zod schemas and the route table, the API source of truth
- `packages/core`: domain logic, provider adapters, router, KubeGateway, SecretStore, redaction
- `packages/db`: Drizzle schema, migrations, `withOrg` (RLS)

## Commands

devbox pins Node 22, pnpm 10 and docker-compose; you also need a Docker-compatible engine ([local-dev.md](docs/runbooks/local-dev.md)). Plain `pnpm` works inside `devbox shell`.

```bash
devbox run dev        # .env + pnpm install, then postgres, temporal, migrate, api, worker, web
devbox run stop
devbox run fix        # prettier --write + eslint --fix on changed files only; re-stages staged files
devbox run check      # format:check + lint + typecheck + test
devbox run e2e-local  # e2e against the running stack
devbox run db-reset   # wipe local Postgres/Temporal/fake state
devbox run help
```

## Rules ([docs/conventions/](docs/conventions/README.md))

1. **Contracts first:** API changes start in `packages/contracts`; never duplicate those types. (architecture)
2. **Layering:** `apps → core → db → contracts`; `web → contracts` only; no app imports another app. (architecture)
3. **Provider-agnostic names:** no `github_*` or other provider names in tables, types, modules or routes. Use generic concepts (connection, scm, ticket source); provider code goes only in adapters. (architecture)
4. **Tenant scope:** every query goes through `withOrg` or is scoped by org/project; no unscoped repository methods. (database)
5. **Secrets** never go into Postgres, logs, events, errors or commits. Reference them by name and redact run output. (security)
6. **Ticket, comment and repo text is untrusted:** never interpolate it into shell, k8s specs or SQL. (security)
7. **Authz on every endpoint**, including WebSocket/terminal attach. Verify webhook signatures (constant-time) before any side effect. (security)
8. **Never edit an applied migration;** add a new one. (database)
9. **Bug fix starts with a failing test.** No network in tests. (testing)
10. **UI:** design tokens only; every shared component has a story; loading, empty and error states are required. (frontend)
11. **Strict TS:** no `any`, no unexplained `!` or casts; parse `unknown` with Zod at boundaries. (typescript)

## Workflow ([git-workflow.md](docs/conventions/git-workflow.md))

- **Before coding:** a non-trivial feature needs a spec/plan in `docs/superpowers/`; an architectural choice needs an ADR.
- **While coding:** stay in scope. Never weaken lint, type or test checks, or edit agent config, to make things pass. Record judgment calls in the PR.
- **Before every commit:**
  1. Run `devbox run fix`.
  2. Hand-fix **only** the errors it still reports, then rerun until it prints `fix: clean.`
  3. Never hand-fix what the tools can fix.
  4. Never run the repo-wide `pnpm format` in a feature commit.
- **Before saying done:** run `pnpm typecheck` and `pnpm test` for the packages you touched (or `devbox run check`) and report the real results, failures included. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files. For e2e, see [tests-and-e2e.md](docs/runbooks/tests-and-e2e.md).
- **Commits:** Conventional Commits with the package as scope (`feat(contracts): …`). PRs stay around 400 lines or fewer, one concern each.
- **Sensitive paths** (run Job/runner, webhooks, secrets/tokens, auth, terminal, RLS/`withOrg`, migrations) get the `review:sensitive` label and a high-effort security review. Only the `dev-review` skill merges, after its review is clean and CI is green; PRs that change agent rules or CI wait for a human.
- **Skill subagents** are spawned by tier (`high`, `medium`, `low`), never by model name. The models for each tier are set in [`.agent/models.json`](.agent/models.json) ([agent-model-tiers.md](docs/runbooks/agent-model-tiers.md)).
- **Self-review:** go through [code-review-checklist.md](docs/conventions/code-review-checklist.md) and fill in the PR template.
- **Never commit** `.env`, credentials, or generated output (`storybook-static/`, `parity-out/`, `.devbox/`).
- **When docs conflict,** the newer accepted doc wins. Fix the stale one in the same PR, or flag it.

## Talking to humans

When you have a concern or a question that needs a human decision, write it in plain everyday language and keep it short. People will not read a long question. Use this template:

1. **Problem:** what is wrong or unclear, in one or two sentences.
2. **Sample:** a small example, only if it is needed and directly related to the problem.
3. **Solutions:** the realistic options, briefly.
4. **Suggestion:** which option you recommend, and why in one line.

If you have several questions, ask **one at a time**. Then stop and wait for the human's answer before continuing or asking the next one.

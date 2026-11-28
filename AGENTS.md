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
pnpm test:unit:coverage  # unit coverage report per package
devbox run e2e-local  # e2e against the running stack
devbox run db-reset   # wipe local Postgres/Temporal/fake state
devbox run help
```

No devbox or Docker (a runner pod)? Run `pnpm env:detect` first and follow its `tests=` line; the steps are in [runner-pod.md](docs/runbooks/runner-pod.md).

## Code tools

**NEVER skip Serena. Agents keep forgetting this section; it is mandatory, not a suggestion.** Serena is the `mcp__serena__*` MCP server (runner pods with Serena on, [runner-pod.md](docs/runbooks/runner-pod.md) §6). Without it, ignore the rest of this section. Subagents follow it too.

**At the start of every session, before reading or editing any code:**

1. **Check whether Serena exists.** Look for `mcp__serena__*` tools in your tool list. If they are listed by name only, run `ToolSearch` with `select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__rename_symbol,mcp__serena__replace_symbol_body` (or the keyword `serena`) to load them.
2. **If Serena exists, you MUST use it for all TypeScript code work for the whole session.** Using `Read`, `grep` or `Edit` on `.ts`/`.tsx` code instead of Serena is a rule violation, even for "small" or "quick" changes.
3. **If Serena does not exist,** say so in your first message ("Serena not available, using plain tools") and carry on.

- **MUST** use Serena for TypeScript code: `get_symbols_overview` before reading a whole file, `find_symbol` to find or read a definition, `find_referencing_symbols` for callers, and `rename_symbol` or `replace_symbol_body` for symbol-wide edits.
- **MUST NOT** read a whole `.ts`/`.tsx` file with `Read`, or search code with `grep`, when a Serena call can do it.
- Use plain search and file reads only for text, config and docs, and when a Serena call fails or returns nothing (say which call failed).
- **Before each code read or edit, self-check:** "Am I using Serena?" If not, stop and switch.
- When you start a subagent that reads or edits code, **MUST** paste this section's rule into its prompt: "Check for `mcp__serena__*`; if present, you MUST use it for TypeScript code."
- Use Serena only when its project is the checkout you are working in; otherwise treat it as not available. Never switch its project.
- Serena line numbers are 0-based.

## Rules ([docs/conventions/](docs/conventions/README.md))

1. **Contracts first:** API changes start in `packages/contracts`; never duplicate those types. (architecture)
2. **Layering:** `apps → core → db → contracts`; `web → contracts` only; no app imports another app. (architecture)
3. **Provider-agnostic names:** no `github_*` or other provider names in tables, types, modules or routes. Use generic concepts (connection, scm, ticket source); provider code goes only in adapters. (architecture)
4. **Tenant scope:** every query goes through `withOrg` or is scoped by org/project; no unscoped repository methods. See "Access control and tenant isolation" below. (database)
5. **Secrets** never go into Postgres, logs, events, errors or commits. Reference them by name and redact run output. (security)
6. **Ticket, comment and repo text is untrusted:** never interpolate it into shell, k8s specs or SQL. (security)
7. **Authz on every endpoint** (RBAC per ADR-0036, see below), including WebSocket/terminal attach. Verify webhook signatures (constant-time) before any side effect. (security)
8. **Never edit an applied migration;** add a new one. (database)
9. **Bug fix starts with a failing test.** No network in tests. (testing)
10. **UI:** design tokens only; every shared component has a story; loading, empty and error states are required. (frontend)
11. **Strict TS:** no `any`, no unexplained `!` or casts; parse `unknown` with Zod at boundaries. (typescript)

## Access control and tenant isolation (mandatory)

Applies to every spec, plan, implementation and test. Model: [ADR-0036](docs/adr/0036-rbac-permissions-roles-scope.md) (permission, role, scope; assignments add up; no deny). Read it before touching routes, queries, workflows, the terminal or the UI.

**Design**

- **MUST** state in every spec and plan, per route, query, workflow or screen: the permission (`resource:verb`, `any`/`own`), its level (org/project), and the tenant data touched.
- **MUST** change permissions or roles only in `packages/contracts/src/access.ts` plus a new migration, with an ADR or spec update. Never grant access ad hoc in a handler.
- **MUST NOT** add bypasses (flags, "internal" routes, UI-only gates). Hiding a button is not authorization.

**Implementation**

- **MUST** give every route (including SSE, WebSocket, terminal) a `routeAccess` entry and run it through `checkTenantAccess`. No entry is a bug.
- **MUST** keep the ADR-0036 guard order: org membership, permission (403, before any id lookup), target/project scope (404), then `any`/`own` (403). Never 403 for another org's record.
- **MUST** respect permission levels: org-level permissions never come from a project grant.
- **MUST** use `withOrg` only, and for project data also filter by `project_id` and check project access. RLS covers orgs only.
- **MUST** take the tenant from the session, never the request body. Carry `orgId` through workflows, activities, k8s labels and Secret names.
- **MUST** scope lists with `visibleProjects`; never return, stream or log another tenant's or project's data or existence.
- **MUST** use session permissions in the web app only to show/hide UI; the API is the authority.

**Testing**

- **MUST** test every new or changed route/query for: allowed, denied (403), out of scope (404), own vs someone else's (`own`), cross-tenant (org A vs org B), and project scope (admin on P1 gets nothing in P2).
- **MUST** go through the real guard and `withOrg`/RLS; never mock the access check.
- **MUST** add at least one role-based e2e case (a lower role cannot do or see it).
- **MUST NOT** weaken, skip or delete an access/isolation test, or widen a role, to get green. A failing access test means the code is wrong; stop and ask.
- Access/isolation changes are a **sensitive path**: `review:sensitive` and a high-effort security review.

## Workflow ([git-workflow.md](docs/conventions/git-workflow.md))

- **Before coding:** a non-trivial feature needs a spec/plan in `docs/superpowers/`; an architectural choice needs an ADR.
- **While coding:** stay in scope. Never weaken lint, type or test checks, or edit agent config, to make things pass. Record judgment calls in the PR.
- **Before every commit:**
  1. Run `devbox run fix`.
  2. Hand-fix **only** the errors it still reports, then rerun until it prints `fix: clean.`
  3. Never hand-fix what the tools can fix.
  4. Never run the repo-wide `pnpm format` in a feature commit.
- **E2E for every implementation:** each feature or fix includes e2e specs for each user-visible or cross-component behaviour it adds or changes, and you run those new or changed specs (only them, never the full e2e or full test suite while implementing) before saying done. Never skip them or leave them to CI. Run the targeted mock Playwright spec for UI changes and the targeted local Playwright spec (stack up) for behaviour that crosses API, worker, runner or the fake pod. If the stack truly cannot start (no Docker engine, runner pod), say so in the PR and list the specs written but not run; never tick them as passed. A behaviour e2e cannot prove (a multi-hour timer) needs a stated reason and the lowest layer that proves it. Commands for both (mock and local): [tests-and-e2e.md](docs/runbooks/tests-and-e2e.md) §3a.
- **Before saying done:** run `pnpm typecheck` and `pnpm test` for the packages you touched (or `devbox run check`) and report the real results, failures included. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files. Also run the e2e from the rule above, and report them the same way.
- **Commits:** Conventional Commits with the package as scope (`feat(contracts): …`). PRs stay around 800 lines or fewer, one concern each.
- **Coverage gate:** CI fails on per-package floors, a drop below `coverage-baseline.json`, under 80% coverage on changed lines, and per-group floors on sensitive paths. Never lower thresholds or the baseline, add ignore comments or widen coverage excludes to make it pass; a justified exception goes in a `## Coverage exceptions` section of the PR body. Those protected files wait for a human ([testing.md](docs/conventions/testing.md) §10).
- **Sensitive paths** (run Job/runner, webhooks, secrets/tokens, auth, terminal, RLS/`withOrg`, migrations) get the `review:sensitive` label and a high-effort security review. Only the `dev-review` skill merges, after its review is clean and CI is green; PRs that change agent rules or CI wait for a human.
- **Skill subagents** are spawned by tier (`high`, `medium`, `low`), never by model name. The models for each tier are set in [`.agent/models.json`](.agent/models.json) ([agent-model-tiers.md](docs/runbooks/agent-model-tiers.md)).
- **Self-review:** go through [code-review-checklist.md](docs/conventions/code-review-checklist.md) and fill in the PR template.
- **Never commit** `.env`, credentials, or generated output (`storybook-static/`, `parity-out/`, `.devbox/`).
- **When docs conflict,** the newer accepted doc wins. Fix the stale one in the same PR, or flag it.

## Agent work rules (spec, plan, implement, modify)

These rules are mandatory for every spec, plan, implementation and code change.

- **MUST NOT add any new dependency without human approval.** A dependency is any new package, third-party library, service, container image, CI action, CLI binary, or new workspace package/app. This covers manifests (`package.json`), lockfiles, `devbox.json`, Dockerfiles, Helm/k8s manifests and runner images.
- **MUST ask first, one dependency per message,** using the **Talking to humans** template. Do not add it "to test" and ask later.
- **MUST list proposed dependencies in specs and plans** under `## Needs approval`. Treat each as undecided until the human says yes in writing.
- **MUST use an existing dependency** when one can do the job, and say so.
- **MUST NOT silently decide.** Mark every decision made for the human as `Agent call:` with a one-line reason.
- **MUST stay in scope.** Do not add requirements, scope or non-goals the human did not state. Stop and ask if the plan is wrong.
- **MUST keep changes minimal.** Do not rewrite unrelated code, rename public names, or change behaviour outside the task. Follow the area's convention doc.
- **MUST NOT edit agent config** (`AGENTS.md`, `.agent/`, agent rules) as a side effect. Changes there need human review.

## Talking to humans

These rules are mandatory for every message that raises a concern, asks a question or needs a human decision, in any place (chat, PR or issue comment, `needs_input` message).

- **MUST use this template for every ask,** with these headings in this order:
  1. `Problem:` max 2 sentences. The message MUST start with this line, with no preamble.
  2. `Sample:` optional, max 5 lines.
  3. `Solutions:` max 3 options, one line each.
  4. `Suggestion:` one line: the option you pick and why. MUST NOT be "want me to do it?".
- **MUST report results before the ask,** in a few short lines. MUST NOT mix results into the ask.
- **MUST ask one question per message,** then stop and wait. MUST NOT queue the next question.
- **MUST use plain words.** No jargon, no long file lists.
- **MUST self-check before sending:** a human must be able to answer in under 30 seconds. If not, cut it.

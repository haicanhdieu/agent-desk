# Git workflow

How changes move from a branch to `main`: branch names, commits, PR size, required design docs, merge policy, CI gates, and the extra rules for changes written by AI coding agents.

**Applies to:** every change in this repo, by humans and AI agents alike. Related: [code-review-checklist.md](code-review-checklist.md), [architecture.md](architecture.md), [security.md](security.md), [database.md](database.md), [testing.md](testing.md).

## 1. Branches

- `main` is always releasable. A green commit on `main` deploys to QA with no manual step (infra spec §7), so never push directly to it.
- Branch off the latest `main`. Name branches `<type>/<short-kebab-topic>`, using the commit types below:

| Prefix      | Use for                               | Example                   |
| ----------- | ------------------------------------- | ------------------------- |
| `feat/`     | New behavior                          | `feat/polling-intake`     |
| `fix/`      | Bug fix                               | `fix/terminal-resize`     |
| `refactor/` | No behavior change                    | `refactor/withorg-helper` |
| `chore/`    | Tooling, deps, workspace              | `chore/turbo-cache`       |
| `docs/`     | Docs only                             | `docs/adr-temporal`       |
| `spec/`     | A spec or plan in `docs/superpowers/` | `spec/control-plane`      |
| `test/`     | Tests only                            | `test/rls-leak`           |
| `ci/`       | `.github/workflows`, gates            | `ci/conftest-rules`       |

- Keep branches short-lived (days, not weeks). Rebase on `main` often.
- AI agents working in parallel use one branch (and one git worktree) per task. Never share a branch between two agents.

## 2. Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

- **Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`, `revert`.
- **Summary:** imperative, lower case, no trailing period, at most 72 characters. Say what changes, not how (`feat(api): reject webhook with bad signature`).
- **Body (optional):** why the change is needed, and anything a reviewer can't see in the diff. Wrap at 72 characters.
- **Breaking change:** add `!` after the scope and a `BREAKING CHANGE:` footer (`feat(contracts)!: rename run status values`).

**Scopes** are the package or app touched. Use the most specific one; omit the scope only for repo-wide changes.

| Scope                                         | Path                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `api`                                         | `apps/api` (NestJS on Fastify)                                                       |
| `worker`                                      | `apps/worker` (Temporal workflows and activities)                                    |
| `web`                                         | `apps/web` (Vite, TanStack Router)                                                   |
| `components`, `screens`, `mocks`, `storybook` | Sub-scopes of `apps/web` already in use                                              |
| `contracts`                                   | `packages/contracts` (Zod schemas, route table)                                      |
| `core`                                        | `packages/core` (domain logic, adapter interfaces)                                   |
| `db`                                          | `packages/db` (Drizzle schema, RLS policies, migrations, `withOrg`)                  |
| `runner`                                      | `images/runner` (run sandbox image, entrypoint)                                      |
| `chart`, `platform`, `host`                   | `deploy/chart`, `deploy/platform`, `deploy/host`                                     |
| `ci`                                          | `.github/`                                                                           |
| `deps`                                        | Dependency bumps                                                                     |
| `docs`                                        | Use as type instead (`docs: ...`); scope only for a specific area (`docs(adr): ...`) |

**Granularity**

- One logical change per commit. Each commit builds and passes its own tests, so `git bisect` works.
- Separate mechanical changes (rename, move, format) from behavior changes, in different commits.
- A commit that touches several packages for one reason (a contract change and its api and web callers) is fine; pick the scope of the source of the change.
- Don't commit generated output (`dist/`, `storybook-static/`, coverage) unless the repo already tracks it. Drizzle migration SQL is source and is committed.
- Fixup commits during review are fine; squash them before merge (section 5).

## 3. Pull requests

- **One concern per PR.** A feature, a fix, a refactor, or a dependency bump, not a mix. Unrelated cleanups go in their own PR.
- **Size:** soft cap of about **400 changed lines** excluding lockfiles, generated migrations snapshots, and fixtures. Above that, split: contracts first, then backend, then frontend; or schema first, then behavior. Say in the description why a larger PR can't be split.
- Fill in [`.github/pull_request_template.md`](../../.github/pull_request_template.md): summary, linked spec or issue, test evidence, risk and rollback.
- Open as a draft until CI is green and you have reviewed your own diff.
- The PR title follows the commit format; it becomes the squash commit message.

## 4. When a spec, plan, or ADR is required

| Change                                                                                                                 | Required before code                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| New feature or flow, new module, new screen                                                                            | Spec in `docs/superpowers/specs/YYYY-MM-DD-<topic>.md`                            |
| Multi-step implementation (more than one PR, or delegated to agents)                                                   | Plan in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, linked to its spec        |
| Choice that is costly to reverse: framework, datastore, protocol, tenancy model, auth, provider seam, deployment model | ADR in `docs/adr/NNNN-<title>.md` (context, decision, alternatives, consequences) |
| Change that contradicts an existing spec, plan or ADR                                                                  | Amend that doc (or supersede the ADR) in the same PR or an earlier one            |
| Bug fix, refactor, test, dependency bump, copy change                                                                  | None; explain in the PR                                                           |

Link the doc from the PR. Reviewers block a PR whose behavior isn't described in a spec when one is required.

## 5. Merge policy

- **Squash-merge** feature PRs into `main`. The squash message is the PR title in Conventional Commits form, plus a body listing anything notable.
- **Merge commit** only for long-lived integration branches whose individual commits must stay on `main` (for example a `spec/*` branch of several docs or a stacked series reviewed commit by commit).
- **Rebase, don't merge `main` into your branch.** Use `git rebase origin/main`, then `git push --force-with-lease`. Never force-push `main` or someone else's branch.
- Merge only when: CI is green, the review has no open critical, high or medium findings (blocker and should-fix), and the branch is up to date with `main`. The review may be by a human or by the `dev-review` agent skill ([dev-workflow.md](../runbooks/dev-workflow.md)).
- The author or `dev-review` merges. Delete the branch after merge.
- To roll back, `git revert` the squash commit in a new PR (`revert: ...`). Don't rewrite `main` history.

## 6. CI gates

`ci.yml` runs on every PR and every push to `main`. The order matches the local commands; run them before pushing.

| Job (check name)                     | Command                                                                                                         | Fails on                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `static / format`                    | `pnpm format:check`                                                                                             | Any file not Prettier-formatted (fix with `pnpm format`)                                                                     |
| `static / lint`                      | `pnpm lint`                                                                                                     | Lint errors, or a test whose `*.int.test.ts` name is wrong                                                                   |
| `static / typecheck`                 | `pnpm typecheck`                                                                                                | Any TypeScript error                                                                                                         |
| `test / unit`                        | `pnpm test:unit`, `pnpm test:scripts`                                                                           | Unit, workflow, contract and script tests (no Docker)                                                                        |
| `test / integration (<pkg> <i>/<n>)` | `pnpm --filter @agentdesk/<pkg> test:integration --shard=<i>/<n>`                                               | Database and API integration tests (Testcontainers), per shard                                                               |
| `test / coverage`                    | merges unit and integration coverage, then `coverage-check`, `coverage-ratchet`, `diff-cover`, `coverage-guard` | Package or sensitive-path floor, drop vs baseline, under 80% on changed lines, or an unexplained ignore or lowered threshold |
| `gate / ci-passed`                   | aggregates every job above                                                                                      | Any job that did not succeed. **The only required check.**                                                                   |
| Build, deploy checks (planned)       | `pnpm build`, `helm lint`, `helm template`, `kubeconform`, `conftest`, `bats`                                   | Build, chart, policy (P1 to P5), or host script errors                                                                       |

Jobs run in parallel, each capped at 20 minutes. Set `gate / ci-passed` as the only required status check in branch protection, so changing a shard count never renames a required check.

E2E (`e2e.yml`) runs against a local k3s cluster. See [testing.md](testing.md). A gate that is flaky is a bug: fix or quarantine it in a tracked PR, never retry until green and merge.

**Pre-commit hooks (planned).** Not set up yet. Planned: a fast hook (lint-staged) that runs `prettier --write` and lint on staged files, a secret scanner (for example gitleaks), and a `commit-msg` check for the Conventional Commits format. Until then, `devbox run fix` (§7 rule 1) is the manual equivalent for changed files, and is required before every commit. `pnpm format:check` fails on `main` until the one-time `pnpm format` commit planned after `feat/backend` and `feat/frontend` merge; see [typescript.md](typescript.md).

## 7. Rules for AI-agent-authored changes

Agents follow every rule above, plus these. Humans reviewing agent PRs check them.

1. **Auto-fix changed files right before every commit.** Run `devbox run fix` (`scripts/fix-changed.mjs`): `prettier --write` + `eslint --fix` on the working-tree changes only, then re-stage. Fix by hand **only** what it still reports, rerun until `fix: clean.`, then commit. **MUST NOT** run the repo-wide `pnpm format` in a feature commit. _Why: the tools fix formatting and fixable lint for free; spending agent tokens on it is waste, and files stay clean at every commit without touching unrelated code._
2. **Verify before claiming done.** Run the relevant `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` (filtered to the package is fine) and paste the result into the PR. "Should pass" is not evidence. For UI, include a screenshot or Storybook story.
3. **Stay in scope.** Change only what the task or plan asks for. Note unrelated problems in the PR instead of fixing them.
4. **Never commit secrets.** No `.env` files, keys, tokens, Claude credentials, GitHub App private keys, webhook secrets, or kubeconfigs. Only `*.sops.yaml` files (encrypted) and `.env.example` with placeholder values. If a secret is committed, stop, tell a human, and rotate it; removing it from history is not enough.
5. **Never edit an applied migration.** Migrations in `packages/db` that are on `main` are immutable. Add a new migration instead. See [database.md](database.md).
6. **Don't weaken guards to make things pass.** Don't skip or delete failing tests, add `@ts-ignore`/`any` to silence errors, disable lint rules, loosen RLS policies, or bypass `withOrg`. If a check is wrong, say so in the PR.
7. **Don't change your own rules.** Agents don't edit `.claude/settings.json`, `CLAUDE.md`, CI workflows, branch protection, CODEOWNERS, or the coverage files (`coverage-thresholds.json`, `coverage-baseline.json`, `scripts/coverage-*.ts`, vitest/vite configs) unless that is the task, and such a PR always needs a human reviewer.
8. **Record judgment calls.** When a plan leaves a choice open, decide, then list the ruling and its cost-if-wrong in the PR (as in `docs/superpowers/plans/2026-11-11-decisions.md`).
9. **Agents merge only through `dev-review`.** It reviews on four dimensions, fixes every critical, high and medium finding, gets CI green, then merges (§5). No other agent approves or merges. Exception: a PR covered by rule 7 waits for a human approval.

### Sensitive paths

A PR touching any of these gets the `review:sensitive` label and a security review at high effort (by `dev-review`, or a human who knows the area). Check the matching [security.md](security.md) items.

| Area                                                                                     | Where                                                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run sandbox: Job spec, per-run Secret, securityContext, entrypoint, permission mode      | `KubeGateway` in `apps/api` and `apps/worker`, `images/runner/`, `deploy/chart` run templates |
| NetworkPolicy, RBAC, service accounts                                                    | `deploy/chart`, `deploy/platform`                                                             |
| Webhook intake: signature check, dedupe, author authorization                            | `IntakeModule` in `apps/api`, code-host adapters in `packages/core`                           |
| Secrets and tokens: `SecretStore`, workspace token minting, log and scrollback redaction | `apps/api`, `apps/worker`, `packages/core`                                                    |
| Auth and sessions: better-auth config, org guard, membership checks                      | `AuthModule` in `apps/api`                                                                    |
| Terminal attach: `pods/exec` relay and its owner check                                   | `TerminalModule` in `apps/api`                                                                |
| Tenancy: RLS policies, `withOrg`, `SECURITY DEFINER` functions, roles                    | `packages/db`                                                                                 |
| Migrations                                                                               | `packages/db`                                                                                 |
| Encrypted secrets and delivery                                                           | `.sops.yaml`, `deploy/targets/*/secrets.sops.yaml`, `.github/workflows/`                      |

### CODEOWNERS (planned)

Not set up yet. Planned: a `.github/CODEOWNERS` that maps the sensitive paths above to the maintainers, plus branch protection on `main` requiring code-owner review, green CI, and an up-to-date branch.

# Code review checklist

What a reviewer checks on every PR, how to label review comments, and how authors respond. Skip sections that don't apply to the diff, but read the whole diff.

**Applies to:** every PR, whether a human or an AI agent wrote it or reviews it. Related: [git-workflow.md](git-workflow.md), [architecture.md](architecture.md), [security.md](security.md), [typescript.md](typescript.md), [backend.md](backend.md), [database.md](database.md), [frontend.md](frontend.md), [testing.md](testing.md).

## Before you start

- [ ] **PR is reviewable:** one concern, about 400 lines or fewer, template filled in, CI green (including `pnpm format:check`).
- [ ] **Context read:** the linked spec, plan, or ADR, so you review against intent, not only the code.
- [ ] **Sensitive paths:** if the diff touches a path listed in [git-workflow.md](git-workflow.md) section 7, the PR has the `review:sensitive` label and gets a security review at high effort.

## Correctness

- [ ] **Does what the spec says:** behavior matches the linked spec or issue, including the failure cases it lists.
- [ ] **Edge cases:** empty, null, duplicate, very large, concurrent, and out-of-order inputs are handled.
- [ ] **Errors:** failures are handled or propagated with context, never swallowed; no empty `catch`.
- [ ] **Idempotency:** webhook, poll, workflow activity, and outbox code is safe to run twice (dedupe keys, unique constraints, `outbox` records).
- [ ] **Concurrency:** no race between api and worker; row locks or unique keys where two paths can write the same row.
- [ ] **Async:** every promise is awaited or deliberately detached; no floating promises.
- [ ] **Time:** uses the injected `Clock`, UTC, explicit units in names (`timeoutSeconds`).
- [ ] **Resource cleanup:** sockets, exec streams, transactions, and Kubernetes watches are closed on every path.

## Contracts/API

- [ ] **Source of truth:** request and response shapes come from `packages/contracts` Zod schemas, not ad hoc types.
- [ ] **Validated at the edge:** every input (body, params, query, webhook payload, env) is parsed with Zod before use.
- [ ] **Backward compatible:** no removed or renamed fields or changed semantics without a `!` breaking-change commit and updated callers.
- [ ] **Route table:** new routes are in the contracts route table and follow existing naming and status codes (404 for another org's record).
- [ ] **Errors are typed:** error responses use the shared error shape; no stack traces or internals leak to clients.

## Architecture boundaries

- [ ] **Package direction:** apps depend on packages, never the reverse; `packages/contracts` depends on nothing internal; no cycles.
- [ ] **Right layer:** domain logic in `packages/core`, persistence in `packages/db`, HTTP and Nest wiring in `apps/api`, durable work in `apps/worker`.
- [ ] **Durable work in the worker:** long-running or retryable steps are Temporal workflows or activities, not request handlers or timers in the api.
- [ ] **Workflow determinism:** workflow code has no I/O, `Date.now()`, randomness, or env reads; those go in activities.
- [ ] **Seams used:** Kubernetes through `KubeGateway`, providers through adapters, secrets through `SecretStore`; no direct client calls around them.
- [ ] **Control plane never runs agent code:** only the run Job touches the cloned repo.
- [ ] **Matches the architecture:** no new component, queue, or datastore without a spec or ADR. See [architecture.md](architecture.md).

## Security

- [ ] **Run Job spec:** non-root, no service account token mounted, CPU, memory, and time limits set, permission mode passed explicitly, Secret owned by the Job.
- [ ] **NetworkPolicy and RBAC:** runs namespace egress to cluster-internal addresses still denied; control-plane RBAC not widened beyond `agentdesk-runs`.
- [ ] **Webhooks:** signature verified with a constant-time compare on the raw body before parsing; bad signature returns 401; delivery dedupe kept.
- [ ] **Trigger authorization:** only the bot and `OWNER`/`MEMBER`/`COLLABORATOR` authors start runs, on both webhook and polling paths.
- [ ] **Secrets:** none in code, logs, errors, scrollback, `run_events`, or Postgres; credential values only in Kubernetes Secrets; redaction covers new fields.
- [ ] **Tokens:** workspace token scoped to one repo, short-lived, minted per run, never persisted.
- [ ] **Auth:** every `/api/*` route requires a session and an org-membership guard; new public routes are justified.
- [ ] **Terminal attach:** only the run's project owner can open it; Kubernetes credentials never reach the browser.
- [ ] **Untrusted input:** ticket text, comments, and repo content are treated as untrusted (prompt injection); never interpolated into shell commands, SQL, or HTML.
- [ ] **Dependencies:** new packages are maintained, needed, and pinned by the lockfile.
- See [security.md](security.md) for the full threat model.

## Tenancy

- [ ] **`org_id` everywhere:** new tables have `org_id uuid not null` (or a documented exception) and an RLS policy with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- [ ] **`withOrg` only:** request and activity code reach the database only through `withOrg(orgId, fn)`; no raw pool or owner connection.
- [ ] **Org from the session:** `orgId` comes from `OrgContext` or workflow input, never from a client-supplied body or query value.
- [ ] **Cross-tenant reads:** any new `SECURITY DEFINER` function is minimal, owned by `agentdesk_owner`, and reviewed as a sensitive change.
- [ ] **Leak test:** the RLS two-org leak test covers the new table or query.
- [ ] **Kubernetes labels:** Jobs carry `agentdesk/org-id` and `agentdesk/run-id`.

## Data/migrations

- [ ] **New migration, not an edit:** applied migrations are unchanged; the new one is generated from the Drizzle schema and its SQL is readable.
- [ ] **Safe to deploy:** additive first (nullable or defaulted column, then backfill, then constraint); no long locks on large tables.
- [ ] **Old code still works:** the migration runs before new code ships, so the running version must tolerate the new schema.
- [ ] **Constraints and indexes:** uniqueness that enforces dedupe or idempotency is a database constraint; queries have supporting indexes.
- [ ] **Roles:** grants for `agentdesk_app` are least-privilege; the app role never gets `BYPASSRLS` or table ownership.
- [ ] **Down path:** a rollback plan is stated in the PR (revert migration or forward fix). See [database.md](database.md).

## Tests

- [ ] **Behavior covered:** new behavior and each fixed bug have a test that fails without the change.
- [ ] **Right level:** unit for logic, workflow tests for Temporal, Testcontainers for SQL and RLS, contract tests for API shapes, stories for UI. See [testing.md](testing.md).
- [ ] **Uses the seams:** fakes for `KubeGateway`, adapters (`fake` provider), `Clock`, and `SecretStore`; no real network or cluster in unit tests.
- [ ] **Deterministic:** no sleeps, real time, test ordering dependence, or shared state between tests.
- [ ] **Not weakened:** no skipped, deleted, or loosened tests to get green; snapshot updates are explained.
- [ ] **Evidence:** the PR shows the commands run and their result.

## Observability

- [ ] **Structured logs:** pino with `requestId`, `orgId`, `runId` from context; useful message, right level, no `console.log`.
- [ ] **No sensitive data in logs:** no tokens, credentials, cookies, or full webhook payloads.
- [ ] **Traceable:** new cross-process calls propagate OpenTelemetry context (api to Temporal to activities).
- [ ] **Recorded outcomes:** intake decisions write an `inbound_events` outcome; run state changes write `run_events`; mutating Desk calls hit `audit_log`.
- [ ] **User-visible failure:** a failed run or poll shows a reason (`failure_reason`, `last_error`) the user can act on.

## Naming

- [ ] **Provider-agnostic:** no `github_*` or other provider names in tables, columns, routes, contracts, modules, or UI concepts; use generic terms (`connections`, `repo_path`, `ticket_ref`, `inbound_events`).
- [ ] **Adapters hold the specifics:** provider details (HMAC header names, installation tokens, PR refs, ETag polling) live only in that provider's `BoardAdapter` or `CodeHostAdapter`.
- [ ] **Domain vocabulary:** names match the specs (run, rule, skill, agent, project, connection, ticket); no new synonyms.
- [ ] **Clear names:** units in names, booleans read as predicates, no abbreviations a newcomer must guess. See [typescript.md](typescript.md).

## Frontend/UI

- [ ] **Data from contracts:** API calls use `packages/contracts` types; no duplicated shapes in `apps/web`.
- [ ] **Routing:** routes and links go through TanStack Router; no hardcoded `href` strings.
- [ ] **All states:** loading, empty, error, and each run status render; stories exist for new components and states.
- [ ] **Design system:** existing components and tokens used; no raw colors or px sizes outside tokens.
- [ ] **Accessibility:** keyboard reachable, visible focus, accessible names that include the visible label, color is never the only cue.
- [ ] **Safe rendering:** no `dangerouslySetInnerHTML` on untrusted text; terminal and scrollback output is escaped.
- [ ] **Screenshots:** the PR includes before and after for visible changes. See [frontend.md](frontend.md).

## Docs/ADR

- [ ] **Spec current:** the linked spec or plan matches what was built; deviations are amended in the same PR.
- [ ] **ADR when required:** costly-to-reverse decisions have an ADR in `docs/adr/` (see [git-workflow.md](git-workflow.md) section 4).
- [ ] **Runbooks:** new env vars, commands, or operational steps are documented; `.env.example` updated.
- [ ] **Comments explain why:** comments state reasons and constraints, not what the code already says; no stale TODOs without an issue.

## Severity of review comments

Prefix every comment with its severity so the author knows what blocks merge.

| Label           | Meaning                                                                                                                                                  | Merge                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **blocker:**    | Bug, security or tenancy hole, data loss risk, broken contract, missing required test or spec, violation of a rule in [git-workflow.md](git-workflow.md) | Blocked until fixed or the reviewer agrees otherwise             |
| **should-fix:** | Real problem that isn't dangerous: unclear design, missing edge case, weak naming, maintainability cost                                                  | Fix in this PR, or open a tracked follow-up the reviewer accepts |
| **nit:**        | Style or preference, not covered by lint or Prettier. Never comment on what Prettier owns (quotes, wrapping, commas, indentation)                        | Author's choice; never blocks                                    |

The `dev-review` skill rates findings **critical** or **high** (= blocker), **medium** (= should-fix) and **low** (= nit); see [its rubric](../../.agent/skills/dev-review/severity.md).

Also useful: **question:** (you need to understand before judging) and **praise:** (call out good work worth repeating). Comment on the code, not the author. Give a concrete suggestion when you can.

## Responding to review

- **Answer every comment.** Fix it and reply with the commit, or reply with a reason you disagree. Don't resolve a reviewer's thread silently; let the reviewer resolve blockers.
- **Verify before agreeing.** Check that the suggestion is correct for this codebase before applying it. Push back with evidence (a test, a spec reference) when it isn't.
- **Keep changes reviewable.** Push fixups as new commits during review so the reviewer sees what changed; squash at merge.
- **Re-request review** after addressing blockers, and re-run the checks you claimed in the PR.
- **Escalate disagreements** that persist after one round to a maintainer, or record the decision in an ADR if it is architectural.
- **AI agents** responding to review follow the same rules: no performative agreement, re-run verification after each change, and list which comments were addressed and which were declined with reasons.

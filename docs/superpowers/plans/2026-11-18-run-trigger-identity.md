# Run Trigger Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commits and the PR of a run credit the person who triggered it; the bot is only a `Co-Authored-By` trailer.

**Architecture:** Intake stores the trigger person's provider user id next to `runs.triggered_by` (decision A in the issue). The worker asks the code host adapter for the commit identity (name, email) and passes it to the run Job as plain env values. The runner entrypoint sets git author/committer from those values on every start (fresh and resume), a `prepare-commit-msg` hook adds the bot trailer, and the `gh` wrapper writes the `Authorized by` line into the PR body after `gh pr create` / `gh pr edit`, so the line does not depend on text the agent wrote.

**Tech Stack:** TypeScript (core, worker, db), Drizzle migration, POSIX sh runner scripts, Vitest, Playwright (local).

**Spec:** GitHub issue #107 (no separate spec doc; the issue's acceptance criteria are the spec). Numbered "AC n" below.

## Global Constraints

- AGENTS rule 3: no `github_*` names in tables, types, env names or routes. Column `triggered_by_external_id`; env `RUN_AUTHOR_NAME`, `RUN_AUTHOR_EMAIL`, `RUN_AUTHORIZED_BY`. The noreply format lives only in the GitHub adapter.
- AGENTS rule 6 / AC4: the login travels only as a Job env `value` (never `eval`, never an unquoted shell word, never SQL text, never a k8s name/label). Validate it against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` before it enters the Job; an invalid value falls back to the bot identity.
- AC9: no token or secret in the new env, logs, `run_events` or audit log.
- AC5: author is the person only when `triggered_by` is non-null, is not the bot, and the external id is present. Otherwise the identity stays the bot and the PR says the bot authorized it.
- AC10: `codehost.ts:295/319` (skill-file writes) stay as they are.
- Migration is new and forward-only (rule 8); it touches a sensitive path, so the PR gets `review:sensitive`.
- Commit email for GitHub: `<numeric id>+<login>@users.noreply.github.com`.

## Review Focus

- Login with odd characters (`a;b`, `$(x)`, spaces, newline, `--flag`-like): never executed, falls back to the bot. Pinned in Task 3 and Task 5.
- Trigger is the bot itself (`agentdesk[bot]`) or `triggered_by` is null (pre-change runs): bot identity, PR says the bot. Task 3, Task 4.
- Comment author deleted (`user: null`, login becomes `ghost`, no id): bot identity, not a fake `ghost` person. Task 1.
- Resumed run on an existing volume that was first started under the old bot config: identity is re-applied on resume. Task 4.
- Agent already wrote its own `Authorized by` line or edits the PR body later: the wrapper replaces it, and never duplicates it. Task 5.
- Agent runs `git commit --no-verify` (skips the trailer hook): known limit, noted in the PR; author/committer are still correct because they come from git config.

## File Structure

- `packages/db/src/schema/app.ts` + new `packages/db/migrations/0015_run_triggered_by_external_id.sql`: new nullable column.
- `packages/core/src/adapters/types.ts`, `github/webhook.ts`, `github/board.ts`, `fake/*`: carry `authorId` on `TicketEvent`; new `CodeHost.commitIdentity`.
- `packages/core/src/intake/process-ticket-event.ts`: store the id.
- `packages/core/src/kube/job-spec.ts`: three new env values on the run Job.
- `apps/worker/src/activities/run.activities.impl.ts`: resolve identity per run.
- `images/runner/entrypoint.sh`, `images/runner/hooks/prepare-commit-msg` (new), `images/runner/bin/gh`: runner behaviour. `images/runner/Dockerfile` copies the hook.
- `packages/core/src/kube/fake-pod.mjs`: log the identity line the real entrypoint logs.
- `apps/web/e2e/local/run.spec.ts` (or a new `run-identity.spec.ts` next to it): e2e.

---

### Task 1: Store the trigger user id at intake

**Files:**
- Create: `packages/db/migrations/0015_run_triggered_by_external_id.sql` (via `drizzle-kit generate`)
- Modify: `packages/db/src/schema/app.ts:221`, `packages/core/src/adapters/types.ts` (`TicketEvent`), `packages/core/src/adapters/github/webhook.ts:21-61`, `packages/core/src/adapters/github/board.ts:~100`, `packages/core/src/adapters/fake/board.ts`, `packages/core/src/intake/process-ticket-event.ts:362`
- Test: `packages/core/test/intake.int.test.ts`, `packages/core/test/adapters/github.test.ts`

**Interfaces:**
- Produces: `TicketEvent.authorId?: string` (provider user id as a string, absent when unknown); `runs.triggeredByExternalId: text | null`.

- [ ] **Step 1: Failing tests.** In `github.test.ts`: a webhook payload with `comment.user = {login:'alice', id: 42}` parses to `authorId: '42'`; `user: null` gives `author: 'ghost'` and `authorId` undefined; the poll path does the same for `c.user.id`. In `intake.int.test.ts`: an event with `authorId: '42'` stores `triggeredByExternalId: '42'` on the run row; an event without it stores `null`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/core test -- github intake` and see them fail.
- [ ] **Step 3: Implement.** Add `id: z.number()` to the `user` object in both Zod schemas (webhook `IssueCommentPayload`, board `CommentList`), map to `authorId: String(id)`. Add `triggeredByExternalId: text('triggered_by_external_id')` and generate the migration; insert it next to `triggeredBy`. The fake board sets `authorId` from the dev-login handle's fake id (`'1'` is enough; deterministic).
- [ ] **Step 4: Run** the same command plus `pnpm --filter @agentdesk/db test`; expect PASS. Confirm the migration is only an `ALTER TABLE runs ADD COLUMN`, and that `agentdesk_app` column grants (see `docs/conventions/database.md` §5) already cover the column or add the grant in the same migration.
- [ ] **Step 5: Commit** `feat(db): record the provider user id of the person who triggered a run`.

### Task 2: Adapter decides the commit identity

**Files:**
- Modify: `packages/core/src/adapters/types.ts` (`CodeHost`), `packages/core/src/adapters/github/codehost.ts`, `packages/core/src/adapters/fake/codehost.ts`
- Test: `packages/core/test/adapters/github.test.ts`, fake adapter test

**Interfaces:**
- Produces: `CodeHost.commitIdentity(user: { login: string; externalId: string }): { name: string; email: string }`.
  GitHub: `{ name: login, email: \`${externalId}+${login}@users.noreply.github.com\` }`. Fake: `{ name: login, email: \`${login}@users.noreply.fake.invalid\` }`.

- [ ] **Step 1: Failing test:** `commitIdentity({login:'alice', externalId:'42'})` equals `{name:'alice', email:'42+alice@users.noreply.github.com'}`.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** the method on both adapters.
- [ ] **Step 4: Run, see it pass.**
- [ ] **Step 5: Commit** `feat(core): let the code host adapter name the commit identity of a person`.

### Task 3: Job carries the author and authorizer

**Files:**
- Modify: `packages/core/src/kube/job-spec.ts` (`RunJobInput` ~49, `buildRunJob` ~238), `apps/worker/src/activities/run.activities.impl.ts:~565`
- Test: `packages/core/test/kube/job-spec.test.ts`, `apps/worker/test/run.activities.int.test.ts`

**Interfaces:**
- Consumes: Task 2 `commitIdentity`, Task 1 column (read inside the existing `withOrg` run load).
- Produces: `RunJobInput.author: { name: string; email: string; authorizedBy: string }` (always set). `buildRunJob` emits env `RUN_AUTHOR_NAME`, `RUN_AUTHOR_EMAIL`, `RUN_AUTHORIZED_BY` on fresh and resume Jobs (the `common` list). `BOT_NAME`/`BOT_EMAIL` stay (trailer).
- Helper in the activity file: `resolveRunAuthor(run, bot: {name,email}, codeHost): RunJobInput['author']`. Person when `triggeredBy` non-null, `!== bot.name`, `triggeredByExternalId` non-null, and login matches the regex in Global Constraints. Otherwise `{ ...bot, authorizedBy: bot.name }`.

- [ ] **Step 1: Failing tests.** `job-spec.test.ts`: env contains the three names with the given values, in both `resume: false` and `true`; a login like `a$(touch x)` passed as `author.name` stays a literal `value` (no `command`/`args` mention it). `resolveRunAuthor`: person case → `{name:'alice', email:'42+alice@users.noreply.github.com', authorizedBy:'alice'}`; table of falls-back-to-bot cases: triggeredBy null, triggeredBy equals bot name, external id null, login `a;b`, login `--x y`.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/core test -- job-spec` and the worker test; see FAIL.
- [ ] **Step 3: Implement** the input field, env entries and `resolveRunAuthor`; call it where `buildRunJob` is called (run load already has the row; select the two columns there).
- [ ] **Step 4: Run, see PASS.** Also assert no `Secret`/token field changed in the Job (existing snapshot tests stay green).
- [ ] **Step 5: Commit** `feat(runner): pass the run author and authorizer to the run Job`.

### Task 4: Entrypoint sets the identity and the bot trailer

**Files:**
- Modify: `images/runner/entrypoint.sh:53-54` (and move the identity block above the `if [ "${RUN_MODE:-}" = resume ]` so it runs on resume too, using `git -C "$REPO_DIR" config` once the repo exists), `images/runner/Dockerfile`
- Create: `images/runner/hooks/prepare-commit-msg`
- Test: `images/runner/test/entrypoint.test.ts`, new `images/runner/test/commit-trailer.test.ts`

**Interfaces:**
- Consumes: env from Task 3. Missing `RUN_AUTHOR_*` (old Job specs) → bot identity as today.
- Produces: repo git config `user.name`, `user.email` = author; `core.hooksPath` = the hooks dir; hook appends `Co-Authored-By: $BOT_NAME <$BOT_EMAIL>` via `git interpret-trailers --if-exists addIfDifferent --trailer "Co-Authored-By: ..."` (all expansions quoted). Entrypoint logs `agentdesk: git identity <name> <email>` (no secrets) so the fake-pod e2e can assert it. GitHub accounts attribute committer too, so `committer` follows `user.*` (do not set `GIT_COMMITTER_*` separately).

- [ ] **Step 1: Failing tests.** Entrypoint (fresh): with `RUN_AUTHOR_NAME=alice RUN_AUTHOR_EMAIL=42+alice@…` the recorded `git config` calls set those, not the bot; without them, bot values (AC5). Resume: same assertions, and a volume whose repo config still holds the bot name ends with the author. Hook test, using a real temp git repo: commit with the hook yields `git log --format='%an <%ae>|%cn <%ce>'` equal to the author for both, and the body ends with exactly one `Co-Authored-By: <BOT_NAME> <BOT_EMAIL>`; a second amend does not duplicate it; `BOT_NAME='x"; touch pwned #'` creates no file.
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/runner test` and see FAIL.
- [ ] **Step 3: Implement** the entrypoint change and the hook; Dockerfile `COPY` + `chmod +x`.
- [ ] **Step 4: Run, see PASS.**
- [ ] **Step 5: Commit** `fix(runner): author run commits as the person who triggered the run`.

### Task 5: `gh` wrapper states who authorized the PR

**Files:**
- Modify: `images/runner/bin/gh`
- Test: `images/runner/test/attach-scripts.test.ts` style new `images/runner/test/gh-authorized-by.test.ts` (stub `gh` on PATH)

**Interfaces:**
- Consumes: `RUN_AUTHORIZED_BY`.
- Behaviour: after the real `gh pr create` or `gh pr edit` exits 0 (and `RUN_AUTHORIZED_BY` is set and valid), the wrapper reads the PR URL (last stdout line of `pr create`; for `pr edit`, the PR argument, or the current branch when none is given), loads the body with `gh pr view --json body -q .body`, removes any existing line starting `Authorized by `, appends `Authorized by \`<login>\``, and writes it back with `gh pr edit --body-file <tmp>`. Original stdout and exit code are preserved; a failure of the follow-up edit prints a warning to stderr but does not fail the agent's command. Never calls `eval`; the login only goes into a file.

- [ ] **Step 1: Failing tests (stub gh records calls and serves a body):** create then edit appends the line with backticks around `alice`; an agent-written `Authorized by \`mallory\`` is replaced, not duplicated; running twice is idempotent; invalid `RUN_AUTHORIZED_BY` (`a;b`) makes no edit call; other subcommands (`gh issue list`) pass through untouched; bot case writes `` `agentdesk[bot]` ``.
- [ ] **Step 2: Run, see FAIL.**
- [ ] **Step 3: Implement** in `images/runner/bin/gh`, keeping the token handling and the `exec` path for every other subcommand.
- [ ] **Step 4: Run, see PASS.**
- [ ] **Step 5: Commit** `fix(runner): add an Authorized by line to run PRs from the run record`.

### Task 6: Fake pod, e2e and docs

**Files:**
- Modify: `packages/core/src/kube/fake-pod.mjs` (log `agentdesk: git identity <RUN_AUTHOR_NAME> <RUN_AUTHOR_EMAIL>` after the checkout line; update the header comment), `docs/runbooks/` (one line in the runner or tests doc on the new env and on `--no-verify`)
- Create: `apps/web/e2e/local/run-identity.spec.ts`
- Test: `packages/core/test/kube/fake-gateway.test.ts`

- [ ] **Step 1: Failing tests.** Fake gateway: a Job with the three env values makes the run log contain `agentdesk: git identity alice alice@users.noreply.fake.invalid`. Local e2e (pattern of `run.spec.ts`): dev-login as `e2e-<rand>`, create the fake project, post a comment through `POST /dev/fake/comments` as that author, wait for the run log, and assert the identity line names that author and not the bot; a second run triggered with the bot as author logs the bot identity.
- [ ] **Step 2: Run** the gateway test (fails) and the targeted spec with the stack up (`tests-and-e2e.md` §3a); see FAIL.
- [ ] **Step 3: Implement** the fake-pod line and docs.
- [ ] **Step 4: Run, see PASS.**
- [ ] **Step 5: Commit** `test(runner): prove the trigger identity reaches the run pod`.

## Limits to state in the PR

- **AC8 gap:** the fake pod runs no git and no `gh`, so there is no fake repo to read a commit author or PR body from. The local e2e proves the identity reaches the pod; the commit author, trailer and PR line are proven one layer down by the real-git and stub-`gh` runner tests in Tasks 4 and 5. If the owner wants a real commit in e2e, that needs a fake pod that commits to a local bare repo: a separate change.
- `git commit --no-verify` skips the trailer hook. Author and committer stay correct.
- The agent could run `gh api` to edit a PR body directly; the line is a guardrail for the normal `gh pr create/edit` path, not a hard control.
- Runs created before this change have no stored id and keep the bot identity (AC5).

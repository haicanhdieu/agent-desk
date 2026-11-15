# Rule Custom Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule binds either a repo skill or a custom prompt; Agent Desk appends its fixed system lines, shows them read-only in the rule form, and records the final (redacted) prompt on every run.

**Architecture:** `buildPrompt` in `packages/core` stays the only source of the template; its input becomes a `{ skillName } | { customPrompt }` union, and a new `promptSystemLines` feeds both the prompt and the API preview. Rules and runs get a nullable `prompt` (exactly one of `skill_name` / `prompt` on a rule), intake copies it onto the run, and the worker builds the prompt from the run row and stores a redacted `final_prompt` once. The web app wires the existing prototype components (`RuleForm` Skill / Custom prompt, `PromptSystemPart`, `RunPromptSection`) to the new contract fields and the `rules.promptPreview` route.

**Tech Stack:** TypeScript strict, Zod 4 contracts, Drizzle + Postgres 18 (Testcontainers), NestJS/Fastify, Temporal activities, Vite/React, TanStack Query/Form/Router, MSW, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-13-rule-custom-prompt-design.md](../specs/2026-11-13-rule-custom-prompt-design.md). Read it before any task. Decisions made after it was written are listed under Global Constraints.

## Global Constraints

- Repo rules in `AGENTS.md` apply to every task: contracts first; layering `apps → core → db → contracts`, `web → contracts` only; no provider names in new fields; every query through `withOrg`; no secrets in Postgres, logs, events or errors; untrusted text never reaches a shell, a k8s spec or SQL; never edit an applied migration; strict TS (no `any`, no unexplained `!` or casts).
- Every behaviour starts with a failing test (testing.md §6). No network in tests: fake provider, `FakeKubeGateway`, `MemorySecretStore`, MSW.
- Before each commit: `devbox run fix` until it prints `fix: clean.`; hand-fix only what it still reports. Never run repo-wide `pnpm format`. Conventional Commits with the package as scope.
- Custom prompt: `z.string().trim().min(1).max(4000)`; kept as written (line breaks kept). User `args` stay collapsed to one line.
- Prompt-rule template (system lines always last, exact copy):
  ```
  <custom prompt>
  Ticket: <issue|pull request> #<n> in <repo>. Read it and all its comments with the gh CLI before you start.
  Arguments from the user: <args, one line>
  When done, report on the ticket.
  Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.
  ```
  A skill rule keeps today's five lines in `packages/core/src/router/prompt.ts` byte for byte.
- Preview placeholders: ticket `<issue or PR #number>`, args `<text after /command>`, repo = the project's real `repoPath`. The preview **must** come from the server (`promptSystemLines`), never a copy in web; it includes every line Agent Desk appends, the `agentdesk-status` line too.
- Copy: segmented control "Skill" / "Custom prompt"; hint "Don't paste passwords or tokens. This text is stored."; system part label "Added by Agent Desk (can't be edited)"; run detail "Not recorded" for a null `finalPrompt`; start comment "custom prompt" instead of "skill `x`". All already in the prototype components except the start comment.
- `final_prompt` is redacted with the same known-secret list as run output (`redactionList` in `run.activities.impl.ts`) before it is stored. The Job's `PROMPT` env stays unredacted.
- Any org member may create or edit prompt rules (spec "Accepted risk"); no role check is added. The preview route is authorised like `rules.list`.
- No `kind` column. `kind` is derived: `prompt !== null ? 'prompt' : 'skill'`.

## PR

One PR from `feat/rule-custom-prompt-ui`, on top of the three UI commits already there (`057542a`, `c3a713b`, `0a7be29`). By user decision it is intentionally over the ~400-line guideline; say so in the PR body ("Over size by user decision: the whole feature ships as one PR"). It touches sensitive paths (prompt template, migration, run Job prompt, redaction), so it gets the `review:sensitive` label and a high-effort security review that reads the spec's "Accepted risk" section. Coverage: at least 80% of changed lines; never lower thresholds or the baseline.

Shared types change in Tasks 2 and 3, so the repo-wide `pnpm typecheck` is red between Task 3 and Task 10. Each task verifies only its own package (named in its last steps); from Task 4 on, every package a task finishes stays green. Run `devbox run check` at Task 11.

## Review Focus

1. **Kind switch on edit.** A PATCH that sends `{ prompt }` to a skill rule without `kind` (or `{ skillName }` to a prompt rule) must be a 422 with a pointer, never a 500 from the DB check; a switch sends `kind` plus the new field and clears the old one. Pinned in Task 6 and Task 9.
2. **A secret typed into a custom prompt.** If a member pastes the agent credential into the prompt, the stored `final_prompt` shows `***`, while the pod's `PROMPT` env has the real text. Pinned in Task 5.
3. **Edit after queue.** Changing a rule's prompt after a run was queued does not change that run's prompt (the run copied it at intake). Pinned in Task 5.
4. **Duplicate-run guard per prompt rule.** Two different prompt rules on one ticket both run; the same prompt rule twice is `ignored_active_run`; an active prompt run never blocks a skill rule. Pinned in Task 4.
5. **Retries and resumes keep the first prompt.** `createRunSecretAndJob` called twice writes `final_prompt` once (write only while null), like `setupScriptVersion`. Pinned in Task 5.

---

### Task 1: `buildPrompt` union and `promptSystemLines` (core, sensitive: prompt template)

**Files:**
- Modify: `packages/core/src/router/prompt.ts`
- Test: `packages/core/test/router.test.ts` (`describe('buildPrompt')`, new `describe('promptSystemLines')`, `describe('promptSourceOf')`)

**Interfaces:**
- Produces (exported from `@agentdesk/core` through the existing router re-export; check `packages/core/src/index.ts`):
  - `type PromptSource = { skillName: string } | { customPrompt: string }`
  - `type PromptInput = PromptSource & { ticketKind: TicketKind; ticketNumber: number; repoPath: string; args: string }`
  - `buildPrompt(p: PromptInput): string`
  - `promptSystemLines(p: { ticket: string; repoPath: string; args: string }): string[]` — the four lines after a custom prompt; `ticket` is e.g. `issue #7`.
  - `PROMPT_PREVIEW_TICKET = '<issue or PR #number>'`, `PROMPT_PREVIEW_ARGS = '<text after /command>'`
  - `promptSourceOf(row: { skillName: string | null; prompt: string | null }): PromptSource` — throws `Error('run has neither a skill nor a prompt')` when both are null; prompt wins only when `skillName` is null (the DB check makes "both" impossible on rules).

- [x] **Step 1: Write the failing tests** in `router.test.ts`:
  - `it('renders a custom prompt as written, then the four system lines')`: `buildPrompt({ customPrompt: 'Triage this.\nAdd labels.', ticketKind: 'issue', ticketNumber: 7, repoPath: 'acme/app', args: 'fast' })` equals the five-plus-one lines from Global Constraints with `Ticket: issue #7 in acme/app. …`.
  - `it('keeps line breaks in the custom prompt but collapses args and repo to one line')`: custom `'a\nb'`, args `'l1\nl2 l3'` → output starts `'a\nb\n'`, contains `'Arguments from the user: l1 l2 l3'`, and `out.split('\n').slice(-4)` equals `promptSystemLines({ ticket: 'issue #7', repoPath, args })`.
  - `it('says pull request for a pr in a custom prompt')`.
  - `it('promptSystemLines with the preview placeholders')`: `promptSystemLines({ ticket: PROMPT_PREVIEW_TICKET, repoPath: 'acme/app', args: PROMPT_PREVIEW_ARGS })` toEqual the four lines with placeholders; last line starts ``'Before you end a turn, run `agentdesk-status done'``.
  - `it('promptSourceOf picks the skill, else the prompt, and throws on neither')`.
  - Existing skill tests stay unchanged (they pin the five-line skill template).
- [x] **Step 2: Run** `pnpm --filter @agentdesk/core exec vitest run test/router.test.ts` — expect FAIL (`promptSystemLines` not exported).
- [x] **Step 3: Implement** in `prompt.ts`. The skill branch keeps today's array; the prompt branch is `[p.customPrompt, ...promptSystemLines({ ticket: \`${kind} #${p.ticketNumber}\`, repoPath: p.repoPath, args: p.args })].join('\n')`. `promptSystemLines` applies `oneLine` to `repoPath` and `args`. Discriminate with `'customPrompt' in p`. Update the doc comment ("five lines for a skill rule; custom prompt plus four lines otherwise").
- [x] **Step 4: Run** the router tests and `pnpm --filter @agentdesk/core typecheck` — PASS (the worker call site still passes `{ skillName }`, which fits the union).
- [x] **Step 5: Commit** `feat(core): custom prompt branch in buildPrompt with shared system lines`.

### Task 2: Schema and migration (db, sensitive: migration)

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`rules` at ~L115, `runs` at ~L184)
- Create: `packages/db/migrations/0012_rule_custom_prompt.sql` + `meta/0012_snapshot.json` + `_journal.json` entry, generated with `pnpm --filter @agentdesk/db exec drizzle-kit generate --name rule_custom_prompt`
- Test: `packages/db/test/migrate.int.test.ts`

**Interfaces:**
- Produces: `rules.prompt: string | null`, `rules.skillName: string | null`, `runs.prompt: string | null`, `runs.finalPrompt: string | null`, `runs.skillName: string | null` (Drizzle `$inferSelect`).
- Constraints: `rules_skill_or_prompt_check` = `(skill_name is null) <> (prompt is null)`; `rules_prompt_length_check` = `char_length(prompt) <= 4000`.

- [x] **Step 1: Write the failing tests** in `migrate.int.test.ts` (as `agentdesk_app` through `withOrg` where rows are inserted; reuse the file's `query` helper and an org/project/agent seeded like the other tests):
  - `it('a rule needs exactly one of skill_name and prompt')`: insert with both → error code `23514` naming `rules_skill_or_prompt_check`; with neither → same; with only `prompt` → ok.
  - `it('a rule prompt is at most 4000 characters')`: `'x'.repeat(4000)` ok, `4001` → `rules_prompt_length_check`.
  - `it('runs keep prompt and final_prompt and allow a null skill_name')`: insert a run with `skill_name null, prompt 'p'` → ok; columns exist and are nullable (`information_schema.columns`).
  - `it('the custom prompt migration changes no rows')`: read `0012_rule_custom_prompt.sql`, `not.toMatch(/\b(update|delete|insert)\b/i)` (same pattern as the 0010 test).
- [x] **Step 2: Run** `pnpm --filter @agentdesk/db exec vitest run test/migrate.int.test.ts` — expect FAIL.
- [x] **Step 3: Edit the schema**: `rules.skillName` drop `.notNull()`, add `prompt: text('prompt')`, add the two `check(...)`s; `runs.skillName` drop `.notNull()`, add `prompt: text('prompt')`, `finalPrompt: text('final_prompt')`. Generate, then read the SQL: each new check must be `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE CONSTRAINT` (database.md §5, as in `0009_past_phantom_reporter.sql`); hand-edit the generated SQL only to add that split. Existing rows all have a skill name, so validation passes.
- [x] **Step 4: Run** the db tests (including `rls.int.test.ts`) and `pnpm --filter @agentdesk/db typecheck` — PASS. Note: if `0011` is already taken on main (the pause/resume plan also plans `0011_run_pause_resume.sql`), regenerate on top of main with the next number; never renumber a merged migration.
- [x] **Step 5: Commit** `feat(db): nullable skill name, rule and run prompt, run final prompt`.

### Task 3: Contracts

**Files:**
- Modify: `packages/contracts/src/enums.ts` (add `RuleKind`), `packages/contracts/src/schemas/rules.ts`, `packages/contracts/src/schemas/runs.ts`, `packages/contracts/src/routes.ts` (`rules.promptPreview`), `packages/contracts/src/index.ts` if schemas are re-exported by name
- Modify: `scripts/e2e-local.ts:189` (add `kind: 'skill'` to the rule body)
- Test: create `packages/contracts/src/schemas/rules.test.ts`; extend `packages/contracts/src/routes.test.ts`

**Interfaces:**
- Produces:
  - `RuleKind = z.enum(['skill', 'prompt'])`; `RULE_PROMPT_MAX = 4000`; `RulePrompt = z.string().trim().min(1).max(RULE_PROMPT_MAX)`
  - `CreateSkillRuleRequest` (`kind: z.literal('skill')`, `skillName: SlugName`), `CreatePromptRuleRequest` (`kind: z.literal('prompt')`, `prompt: RulePrompt`), both with `command`, `labelFilter`, `target`, `enabled`; `CreateRuleRequest = z.discriminatedUnion('kind', [...])`
  - `UpdateRuleRequest`: object of optional `command`, `labelFilter`, `target`, `enabled`, `kind`, `skillName`, `prompt`, with `superRefine`: `kind: 'skill'` needs `skillName` and no `prompt`; `kind: 'prompt'` needs `prompt` and no `skillName`; without `kind`, not both. Issues carry `path: ['skillName']` or `['prompt']`.
  - `RuleDto` gains `kind: RuleKind`, `prompt: z.string().nullable()`; `skillName: z.string().nullable()`
  - `RunDto` gains `ruleKind: RuleKind`, `prompt: z.string().nullable()`, `finalPrompt: z.string().nullable()`; `skillName: z.string().nullable()`
  - `PromptPreviewDto = z.object({ systemLines: z.array(z.string()) })`
  - route `rules.promptPreview`: `{ method: 'GET', path: '/api/projects/:projectId/rules/prompt-preview', params: projectParams, response: PromptPreviewDto }`

- [x] **Step 1: Write the failing tests** in `rules.test.ts`:
  - `it('accepts a skill rule and a prompt rule, and rejects a missing kind')`
  - `it('trims the prompt and bounds it at 4000 characters')`: `' '.repeat(3) + 'x'.repeat(4000) + '\n'` parses to the 4000 x's; 4001 fails at `['prompt']`; `'   \n '` fails.
  - `it('keeps line breaks inside the prompt')`
  - `it('UpdateRuleRequest: kind must come with its own field and never the other')`: `it.each` over `{kind:'prompt'}` ✗ `/prompt`, `{kind:'skill'}` ✗ `/skillName`, `{kind:'prompt',prompt:'p',skillName:'s'}` ✗, `{prompt:'p',skillName:'s'}` ✗, `{prompt:'p'}` ✓, `{enabled:false}` ✓, `{}` ✓.
  - In `routes.test.ts`: `it('registers rules.promptPreview under the project rules path')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/contracts test` — expect FAIL.
- [x] **Step 3: Implement** the schemas and route above. Update the e2e script body.
- [x] **Step 4: Run** contracts tests and `pnpm --filter @agentdesk/contracts typecheck` — PASS. (core, api, worker and web typecheck are now red until their tasks.)
- [x] **Step 5: Commit** `feat(contracts): rules bind a skill or a custom prompt; run prompt fields; prompt preview route`.

### Task 4: Routing guard and intake copy (core, sensitive: intake)

**Files:**
- Modify: `packages/core/src/router/route-event.ts` (`RuleRow`, `RouteInput.counts`, active-run guard)
- Modify: `packages/core/src/intake/process-ticket-event.ts` (`decideInTx`: `ruleList` mapping, active-run query, run insert)
- Test: `packages/core/test/router.test.ts` (`describe('routeEvent')`), `packages/core/test/intake.int.test.ts`

**Interfaces:**
- Consumes: `RuleDto` from Task 3, `runs.prompt` from Task 2.
- Produces: `RuleRow = Pick<RuleDto, 'id' | 'command' | 'labelFilter' | 'target' | 'agentId' | 'skillName' | 'prompt' | 'enabled'>`; `RouteInput.counts = { runsForTicket: number; activeSkillsOnTicket: string[]; activeRuleIdsOnTicket: string[] }`.

- [x] **Step 1: Write the failing tests**:
  - `router.test.ts`: the `rule()` factory gains `prompt: null`; `it('a prompt rule is blocked by its own active run, by rule id')` → `ignored_active_run`, detail `rule /triage already has an active run on this ticket`; `it('an active prompt run blocks neither another prompt rule nor a skill rule')` (Review Focus 4); `it('a prompt rule is not blocked by an active skill of the same name')`.
  - `intake.int.test.ts`: `it('a prompt rule copies its prompt onto the run with a null skill name')` (seed a rule with `skillName: null, prompt: 'Triage this.\nAdd labels.'`; run row has `prompt` as written, `skillName: null`, `ruleId` = the rule); `it('guards: an active run of the same prompt rule')` mirroring the existing skill guard test (second event → `ignored_active_run`; after `succeeded` → `run_created`).
- [x] **Step 2: Run** `pnpm --filter @agentdesk/core exec vitest run test/router.test.ts test/intake.int.test.ts` — expect FAIL.
- [x] **Step 3: Implement**: guard is `rule.prompt !== null ? counts.activeRuleIdsOnTicket.includes(rule.id) : rule.skillName !== null && counts.activeSkillsOnTicket.includes(rule.skillName)`, keeping the existing skill detail text. In `decideInTx`, map `prompt: r.prompt`; replace the `selectDistinct({ skillName })` query with one `select({ skillName: runs.skillName, ruleId: runs.ruleId })` over active runs on the ticket and build both lists, dropping nulls; insert `skillName: decision.rule.skillName, prompt: decision.rule.prompt`.
- [x] **Step 4: Run** the core tests and `pnpm --filter @agentdesk/core typecheck` — PASS.
- [x] **Step 5: Commit** `feat(core): route prompt rules by rule id and copy the prompt onto the run`.

### Task 5: Worker prompt, `final_prompt`, start comment (worker, sensitive: run Job, redaction)

**Files:**
- Modify: `apps/worker/src/activities/run.activities.impl.ts` (`RunDetails`, `details()`, `createRunSecretAndJob`, `commentText`)
- Test: `apps/worker/test/run.activities.int.test.ts`

**Interfaces:**
- Consumes: `promptSourceOf`, `buildPrompt` (Task 1); `runs.prompt`, `runs.finalPrompt` (Task 2).
- Produces: `RunDetails.skillName: string | null`, `RunDetails.prompt: string | null`.

- [x] **Step 1: Write the failing tests** (add a `seedPromptRun(prompt: string, args: string)` helper next to `seedRun`, inserting `skill_name null, prompt $x`):
  - `describe('createRunSecretAndJob prompt')`:
    - `it('a prompt run gets the custom prompt then the system lines in PROMPT')`: pod env `PROMPT` starts with the prompt, contains `'Ticket: issue #7 in dev/demo.'`, does not contain `'Use the skill'`.
    - `it('stores the final prompt once, redacted with the run secrets')` (Review Focus 2 and 5): prompt `` `use ${CRED} now` ``; after two `createRunSecretAndJob` calls, `run.finalPrompt` contains `'use *** now'` and not `CRED`; `env.PROMPT` contains `CRED`; then set `final_prompt` to `'first'` as owner, call again, it stays `'first'`.
    - `it('a skill run records its five-line prompt')`: `seedRun('please fix')` → `finalPrompt` equals `env.PROMPT`.
    - `it('uses the prompt copied onto the run, not the rule's current text')` (Review Focus 3): seed a rule with prompt `'old'`, a run with `rule_id` and prompt `'old'`, update the rule to `'new'`, create the Job → `PROMPT` starts with `'old'`.
  - In `describe('postComment')`: `it('the start comment of a prompt run says custom prompt')` → posted text contains ``(`/fix`, custom prompt)`` and not `skill`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/worker exec vitest run test/run.activities.int.test.ts -t "prompt"` — expect FAIL.
- [x] **Step 3: Implement**: `details()` selects `prompt: runs.prompt`; `createRunSecretAndJob` calls `buildPrompt({ ...promptSourceOf(d), ticketKind, ticketNumber, repoPath, args })`; after `kube.ensureSecret(...)` and before `kube.ensureJob(job)`, inside the existing `try`: `const finalPrompt = redact(prompt, await redactionList(ctx))` and `tx.update(runs).set({ finalPrompt }).where(and(eq(runs.id, ctx.runId), isNull(runs.finalPrompt)))` in `withOrg`. `commentText('start')` writes `custom prompt` when `d.prompt !== null`, else today's skill text (with `d.skillName ?? ''` for the type). The prompt never goes into an error or log; `safeError` already wraps the block.
- [x] **Step 4: Run** the worker activity tests, `pnpm --filter @agentdesk/worker test:unit` (replay histories) and `pnpm --filter @agentdesk/worker typecheck` — PASS. No workflow code changes, so no new replay test.
- [x] **Step 5: Commit** `feat(worker): build the prompt from the run, store a redacted final prompt, say custom prompt in the start comment`.

### Task 6: Rules service for both kinds (api)

**Files:**
- Modify: `apps/api/src/rules/rules.service.ts` (`toDto`, `create`, `update`)
- Modify: existing rule POST payloads in `apps/api/test/webhooks.int.test.ts` (L41, L152, L227, L241) and `apps/api/test/rules.int.test.ts` (`valid`, L95) to add `kind: 'skill'`
- Test: `apps/api/test/rules.int.test.ts`

**Interfaces:**
- Consumes: `CreateRuleRequest`, `UpdateRuleRequest`, `RuleDto` (Task 3).
- Produces: `RulesService.toDto` sets `kind` derived from `row.prompt`, `prompt: row.prompt`.

- [x] **Step 1: Write the failing tests** (`expectContract` on every response):
  - `it('creates a prompt rule without checking skills, keeping line breaks')`: `{ kind: 'prompt', prompt: 'Triage.\nLabel it.', command: 'triage', … }` → 201, `{ kind: 'prompt', prompt: 'Triage.\nLabel it.', skillName: null }`.
  - `it('a 4001-character prompt is 400 with pointer /prompt')`.
  - `it('switches a rule from skill to prompt and back')`: PATCH `{ kind: 'prompt', prompt: 'p' }` → `skillName: null`; PATCH `{ kind: 'skill', skillName: 'fix' }` → `prompt: null`; switching to an unknown skill → 422 `/skillName`.
  - `it('a field of the other kind without kind is 422, never 500')` (Review Focus 1): PATCH `{ prompt: 'p' }` on a skill rule → 422 `/prompt`; `{ skillName: 'fix' }` on a prompt rule → 422 `/skillName`.
  - `it('edits a prompt rule's text')`: PATCH `{ prompt: 'new' }` on a prompt rule → 200.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/api exec vitest run test/rules.int.test.ts` — expect FAIL.
- [x] **Step 3: Implement**: `create` calls `assertSkillExists` only for `kind: 'skill'` and inserts `skillName`/`prompt` by kind (the other null). `update`: work out the resulting kind (`body.kind ?? (existing.prompt !== null ? 'prompt' : 'skill')`); a `prompt` sent for a resulting skill rule, or a `skillName` for a resulting prompt rule, throws `UnprocessableProblemException('Rule kind mismatch', [{ pointer, detail: 'Send kind to switch what this rule runs' }])`; on a switch set the other column to `null`; `assertSkillExists` runs when the resulting kind is skill and `skillName` is sent and differs.
- [x] **Step 4: Run** the api rules and webhooks tests — PASS.
- [x] **Step 5: Commit** `feat(api): rules service creates and edits skill and prompt rules`.

### Task 7: Prompt preview route and run DTO (api)

**Files:**
- Modify: `apps/api/src/rules/rules.controller.ts`, `apps/api/src/rules/rules.service.ts` (new `promptPreview`)
- Modify: `apps/api/src/runs/runs.service.ts` (`toDto`)
- Test: `apps/api/test/rules.int.test.ts`, `apps/api/test/runs.int.test.ts`

**Interfaces:**
- Consumes: `promptSystemLines`, `PROMPT_PREVIEW_TICKET`, `PROMPT_PREVIEW_ARGS` (Task 1); `PromptPreviewDto`, route `rules.promptPreview` (Task 3).
- Produces: `RulesService.promptPreview(org: OrgContext, projectId: string): Promise<PromptPreviewDto>`.

- [x] **Step 1: Write the failing tests**:
  - `rules.int.test.ts`: `it('prompt preview returns every appended line with the project repo and placeholders')` → `expectContract('rules.promptPreview', res)`, `systemLines` toEqual `promptSystemLines({ ticket: PROMPT_PREVIEW_TICKET, repoPath: <project repoPath>, args: PROMPT_PREVIEW_ARGS })` and has 4 lines, the last one with `agentdesk-status`; `it('prompt preview is 401 signed out and 404 for another org project')` (bob's cookie on alice's project).
  - `runs.int.test.ts`: `it('a run DTO carries ruleKind, prompt and finalPrompt')` via `insertRun({ skillName: null, prompt: 'p', finalPrompt: 'p\nTicket: …' })` → `runs.get` returns `ruleKind: 'prompt'`; an `insertRun()` without them → `ruleKind: 'skill', prompt: null, finalPrompt: null`.
- [x] **Step 2: Run** both files — expect FAIL.
- [x] **Step 3: Implement**: `promptPreview` reads `projects.repoPath` inside `withOrg` (404 `Project not found` when missing) and returns the lines. Controller `@Get(routePath(routes.rules.promptPreview))` with `ProjectParam`, same `CurrentOrg` guard as `list`. `RunsService.toDto` adds `ruleKind`, `prompt`, `finalPrompt`.
- [x] **Step 4: Run** `pnpm --filter @agentdesk/api test` and `pnpm --filter @agentdesk/api typecheck` — PASS.
- [x] **Step 5: Commit** `feat(api): prompt preview route and run prompt fields`.

### Task 8: Web data layer: fixtures, MSW, queries, mappers

**Files:**
- Modify: `apps/web/src/mocks/dto/rules.ts` (fields on every fixture; add the `/triage` prompt rule mirroring `mocks/rules.ts` `r6`, with an `ids.rule` entry), `apps/web/src/mocks/dto/runs.ts` (`ruleKind`, `prompt`, `finalPrompt`; one prompt run with a string, one older run with `null`)
- Modify: `apps/web/src/mocks/msw/handlers.ts` (`rules.create`, `rules.update` by kind; new `rules.promptPreview`)
- Modify: `apps/web/src/features/desk/queries.ts` (`deskQueries.promptPreview`)
- Create: `apps/web/src/features/desk/promptPreview.ts` (`usePromptPreview`)
- Modify: `apps/web/src/features/desk/map.ts` (`toRule`), `apps/web/src/features/runs/map.ts` (`toRunSummary`), `apps/web/src/features/runs/detail.map.ts` (`toRunDetail`)
- Test: `apps/web/src/features/desk/map.test.ts`, `apps/web/src/features/runs/map.test.ts`, `apps/web/src/features/runs/detail.map.test.ts`, `apps/web/src/mocks/msw/contract.test.ts` (existing "every route has a handler" and "every fixture parses" cover the rest)

**Interfaces:**
- Consumes: Task 3 contracts.
- Produces:
  - `deskQueries.promptPreview(org, projectId)` → `queryOptions` keyed `[...deskKey, 'promptPreview']`, `api.rules.promptPreview({ params: { projectId } })`, `staleTime: Infinity` (the lines change only with a deploy or the repo path).
  - `usePromptPreview(org: string, projectId: string, enabled: boolean): PromptPreview` — `useQuery`; pending → `{ state: 'loading' }`, error → `{ state: 'error', onRetry: () => void refetch() }`, data → `{ state: 'ready', systemLines }`. `PromptPreview` is the type in `components/PromptSystemPart.tsx`.
  - `toRule` returns `kind`, `prompt` (as `undefined` when null) and `skill: dto.skillName ?? ''`; no missing-skill warning for a prompt rule.

- [x] **Step 1: Write the failing tests**:
  - `map.test.ts`: `it('maps a prompt rule with its kind and prompt and no skill warning')`.
  - `runs/map.test.ts`: `it('shows Custom prompt where a prompt run has no skill')` → `toRunSummary(...).skill === 'Custom prompt'`.
  - `detail.map.test.ts`: `it('carries the final prompt, and null for a run without one')`.
  - `contract.test.ts`: `it('creates a prompt rule and serves the prompt preview')` through the MSW client.
  - Create `apps/web/src/features/desk/promptPreview.test.tsx`: `it('maps loading, error with retry, and ready')` with `scenarios.serverError('rules.promptPreview')` and default handlers.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/features src/mocks` — expect FAIL.
- [x] **Step 3: Implement** the files above. The MSW `rules.promptPreview` handler returns lines for the project's `repoPath` in the same four-line shape (a fixture `promptPreviewFixture(repoPath)` in `mocks/dto/rules.ts`, parsed by `PromptPreviewDto` in `contract.test.ts`); the Storybook `promptSystemLines` in `mocks/rules.ts` stays a view fixture.
- [x] **Step 4: Run** the same tests — PASS.
- [x] **Step 5: Commit** `feat(web): prompt rule and run fields in fixtures, MSW, queries and mappers`.

### Task 9: Rule form and desk rules route

**Files:**
- Modify: `apps/web/src/features/desk/rules.form.ts`
- Modify: `apps/web/src/app/routes/o.$org.p.$project.desk.rules.tsx` (`RuleEditor`)
- Modify: `apps/web/src/components/RuleForm.tsx` (doc comment and `PROMPT_MAX` now import `RULE_PROMPT_MAX` from contracts), `apps/web/src/components/RuleSentence.tsx` (drop "Prototype only" comments)
- Test: `apps/web/src/features/desk/rules.route.test.tsx`

**Interfaces:**
- Consumes: `usePromptPreview` (Task 8), `CreateRuleRequest`, `UpdateRuleRequest`, `RuleKind`.
- Produces: `RuleValues = { kind: RuleKind; command; labelFilter; target; skillName: string; prompt: string; enabled }` (form-local view of the two contract branches, built from `CreateSkillRuleRequest` and `CreatePromptRuleRequest` types, not redeclared); `toCreateRequest(v: RuleValues): CreateRuleRequest` drops the other kind's field; `changedFields(base, value)` sends `kind` plus the new kind's field on a switch, else only the current kind's field when changed, and never the other kind's field.

- [x] **Step 1: Write the failing tests** in `rules.route.test.tsx`:
  - `it('New rule offers Skill / Custom prompt and shows the server system lines under the prompt')` (label "Added by Agent Desk (can't be edited)", the `agentdesk-status` line from MSW).
  - `it('saves a custom prompt rule and lists it as Custom prompt with its first line')`.
  - `it('switching an edited skill rule to Custom prompt sends kind and prompt only')` (Review Focus 1; capture the PATCH body).
  - `it('a 4001-character prompt shows a field message and sends nothing')`.
  - `it('a server 422 on /prompt shows under the prompt field')`.
  - `it('when the preview fails, the form still saves and Retry refetches')`.
  - `changedFields` unit cases in a new `apps/web/src/features/desk/rules.form.test.ts`: switch both ways, prompt edit, no change → `{}`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/features/desk` — expect FAIL.
- [x] **Step 3: Implement**: `useRuleForm` default `kind` from `initial?.kind ?? 'skill'`, `prompt: initial?.prompt ?? ''`; register `kind` and `prompt` fields; `SCREEN_FIELD.prompt = 'prompt'`, `RULE_POINTERS['/prompt'] = 'prompt'`, `SCHEMA_MESSAGE.prompt = 'Write what the agent should do, up to 4,000 characters.'`; validator `onDynamic: CreateRuleRequest` (extra keys are stripped by Zod objects; if TanStack Form's Standard Schema typing rejects it, validate `toCreateRequest(value)` in a function validator instead). Create submits `toCreateRequest(value)`. `RuleEditor` passes `promptPreview={usePromptPreview(org, projectId, true)}` and maps `kind`/`prompt` both ways between `RuleDraft` and the form.
- [x] **Step 4: Run** the desk tests and `pnpm --filter @agentdesk/web typecheck` (setup route may still fail until Task 10) — desk tests PASS.
- [x] **Step 5: Commit** `feat(web): rule form saves skill and custom prompt rules`.

### Task 10: Setup step 4 and run detail wiring

**Files:**
- Modify: `apps/web/src/app/routes/o.$org.projects.new.$step.tsx` (`RulesStep`: `toRequest` by kind, `RULE_POINTERS` add `'/prompt': 'prompt'`, `StepErrors` key `prompt`, pass `promptPreview`)
- Modify: the run detail route only if it filters `RunDetailData` (Task 8 already sets `finalPrompt`; `RunSidePanel` renders `RunPromptSection` when it is defined)
- Test: `apps/web/src/features/setup/setup.route.test.tsx`, `apps/web/src/features/runs/detail.route.test.tsx`

- [x] **Step 1: Write the failing tests**:
  - `setup.route.test.tsx`: `it('the first rule can be a custom prompt and saves with kind prompt')` (assert on the MSW db rules: `[command, kind, prompt]`); update the existing assertion at L96 to include `kind`.
  - `detail.route.test.tsx`: `it('shows the final prompt of a run behind Show, and Not recorded for an older run')`.
- [x] **Step 2: Run** both files — expect FAIL.
- [x] **Step 3: Implement** the setup wiring; the follow-up rule stays a skill rule.
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web test` and `pnpm --filter @agentdesk/web typecheck` — PASS (stories smoke/axe included).
- [x] **Step 5: Commit** `feat(web): custom prompt in setup and the run prompt section on run detail`.

### Task 11: Close contract gaps, docs, final check

**Files:**
- Modify: `apps/web/CONTRACT-GAPS.md` (remove the three rows for `kind`/`prompt`, `rules.promptPreview` and `ruleKind`/`prompt`/`finalPrompt`; add one line under "Resolved" naming them)
- Modify: `docs/conventions/security.md` §8 only if the prompt template bullet needs "custom prompt rules" named (it already lists "the prompt template")

- [x] **Step 1:** Edit the docs. Run `pnpm --filter @agentdesk/web parity` locally for DeskRulesPrompt, DeskRulesPromptNew, DeskRulesPromptError, RunPrompt (review by hand; not part of `pnpm test`).
- [x] **Step 2: Run** `devbox run check` and `pnpm test:unit:coverage`; report real results. `format:check` may fail repo-wide (known); `devbox run fix` covers changed files.
- [x] **Step 3: Commit** `docs(web): close the rule custom prompt contract gaps`.
- [ ] **Step 4: PR** via the `create-pr` skill: label `review:sensitive`; body states the over-size decision, the accepted RBAC risk, and the judgment calls (write-once `final_prompt`, "Custom prompt" in the run list skill column, `kind` required on create).

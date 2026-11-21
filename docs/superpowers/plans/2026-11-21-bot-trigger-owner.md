# Bot trigger owner from the linked issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot `/dev-review` on a PR starts as the owner of the PR's linked issue run even when builds overlap, and a refused bot trigger says why on the ticket.

**Order (ATDD):** Task 0 writes the acceptance specs and watches them fail; Tasks 1 to 3 each start with their own failing test and stop when it passes; Task 4 turns Task 0 green.

**Architecture:** `resolveRunOwner` gets one more origin source (runs on the PR's linked issues) ahead of the same-ticket match and the project-wide match. Intake fetches the ticket first for bot comments to supply the links, and posts a fixed notice after the transaction commits when a bot trigger ends `ignored_owner_unlinked`.

**Tech Stack:** TypeScript, Drizzle, Vitest (`*.int.test.ts` with `startPg`), Playwright local e2e.

**Spec:** `docs/superpowers/specs/2026-11-21-bot-trigger-owner-design.md` (ADR `docs/adr/0033-bot-trigger-owner-from-linked-issue.md`)

## Global Constraints

- No new dependency (AGENTS.md). Provider-agnostic names: no `github_*` anywhere.
- Every query inside `withOrg` and scoped by `projectId`; values are bound parameters.
- `Ticket.linkedRefs` is untrusted: always pass it through `normalizeLinkedRefs` before use.
- The notice text is a fixed constant: no ticket, comment, command or author text in it; its first line must not parse as a command (`parseCommand` returns null).
- A board call never runs inside the intake transaction or while the per-comment advisory lock is held.
- The human-trigger path is unchanged: owner first, no board call for an unlinked human.
- Never edit an applied migration; this plan needs none.
- Sensitive paths: label the PR `review:sensitive`.

## Review Focus

1. A PR whose linked issues have runs of different owners: the nearest (latest started) run's owner wins, no refusal, and it outranks a single active run on the PR itself (Task 1). A PR with no link and no active run: no run, notice posted once, outcome `ignored_owner_unlinked` (Task 3).
2. The same bot comment arriving by webhook and by poll under two delivery ids: one notice only (Task 3).
3. The ticket fetch fails or times out for a bot comment: falls back to today's time match, no throw (Task 2).
4. The notice comment comes back as a bot comment: it is `ignored_no_command`, so no loop and no second notice (Task 3).
5. A linked ref that points at an issue of another project, or a non-number ref: never matches (Task 1).

---

### Task 0: Acceptance specs first (ATDD), red

**Files:**
- Modify: `apps/web/e2e/local/rbac-triggers.spec.ts` (new `test.describe('BO-1 to BO-4')`, following the TC-53.1 pattern: bot comment through `/dev/fake/comments` with `author: 'agentdesk[bot]'`)

- [ ] **Step 1: Write the specs before any code** (fake board: set `linked` on the PR as `fake/board.ts` `getTicket` reads it):
  - `TC-BO-1.1: a bot /dev-review on a PR linked to B's issue run, with a second build active, starts a run that shows B as its owner`.
  - `TC-BO-2.1: a bot /dev-review on a PR with no linked issue and no active run starts no run, the ignored list shows not linked, and the PR shows the notice`.
  - No e2e for the same comment arriving by webhook and by poll: the fake provider's `deliver` option takes one channel per comment, so the lowest layer that proves it is the intake integration test `is not posted twice when the same comment arrives again under another delivery id` (Task 3).

- [ ] **Step 2: Run only these specs with the stack up and confirm they fail for the right reason** (`TC-BO-1.1`: no run, outcome `ignored_owner_unlinked`; `TC-BO-2.1`: no notice on the PR), per `docs/runbooks/tests-and-e2e.md` §3a: `devbox run e2e-local` filtered to `rbac-triggers.spec.ts -g "BO-"`. If the stack cannot start, say so in the PR and list the specs as written but not run.

- [ ] **Step 3: Commit** `test(web): acceptance specs for a bot trigger's owner from the linked issue`

---

### Task 1: Linked-issue origin in `resolveRunOwner`

**Files:**
- Modify: `packages/core/src/access/run-owner.ts` (`RunOwnerInput`, `findOrigin`, new `linkedIssueOrigin`)
- Test: `packages/core/test/access/run-owner.int.test.ts` (new `describe('resolveRunOwner: bot comment on a PR with linked issues')`)

**Interfaces:**
- Produces: `RunOwnerInput.linkedIssueRefs?: readonly string[]` (raw, normalised inside with `normalizeLinkedRefs`). `resolveRunOwner` result type unchanged.
- Consumes: `addRun(w, {...})` helper in the test file (extend its options with `ticketKind?: 'issue' | 'pr'`, default `'issue'`).

- [ ] **Step 1: Write the failing tests** (use plain digit refs, as the real board does: `ticketRef: '208'`). Each uses `makeWorld()`, owners `w.b` and `w.v`, and a bot event on PR ref `'209'` with `linkedIssueRefs: ['208']`:
  - `uses the owner of the run on the linked issue even when two other runs are active in the project` — runs: issue `'208'` owner `w.b` started T0 finished T3; issue `'207'` owner `w.b` started T0 (active); comment at T1. Expect `{ kind: 'owner', userId: w.b, originRunId: <the 208 run> }`. This is the #209 case and fails today (`ignored_owner_unlinked`).
  - `takes the latest run when the linked issue has several runs of one owner` — two runs on `'208'`, same owner, different `startedAt`; expect the later one as `originRunId`.
  - `takes the nearest run when the linked issues have runs of two owners` — run on `'206'` owner `w.v` started T0, run on `'208'` owner `w.b` started T1, `linkedIssueRefs: ['206','208']`, comment at T2; expect owner `w.b` with the 208 run as `originRunId`; with the start times swapped expect `w.v`.
  - `does not take a linked-issue run of another project` — run on `'208'` in `w.p2`, comment in `w.p1`; expect `ignored_owner_unlinked` (no other candidates).
  - `does not take a linked-issue run that started after the comment`; expect `ignored_owner_unlinked`.
  - `ignores non-number linked refs` — `linkedIssueRefs: ['208 OR 1=1', '-1', '']` with a run on `'208'`; expect `ignored_owner_unlinked`.
  - `the linked issue wins over a single active run on the ticket` — an active run on `'209'` owned by `w.v` and a run on `'208'` owned by `w.b`; expect owner `w.b` with the 208 run as `originRunId`.
  - `with no linked issue match, the single active run on the ticket applies` — an active run on `'209'` owned by `w.b`, another active run elsewhere, `linkedIssueRefs: ['208']` with no run; expect owner `w.b`.
  - `falls back to the project-wide match when the linked issue has no run` — `linkedIssueRefs: ['300']`, one active run elsewhere in the project; expect that run's owner (BO-3).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @agentdesk/core exec vitest run test/access/run-owner.int.test.ts -t "linked"`
Expected: FAIL (the first and second tests return `ignored_owner_unlinked` or the wrong run).

- [ ] **Step 3: Implement** `linkedIssueOrigin(tx, projectId, createdAt, refs): Promise<Candidate | null>` in `run-owner.ts`: select `runs.id, runs.ownerUserId` where `projectId` matches, `ticketKind = 'issue'`, `ticketRef` in the normalised refs, `startedAt` not null and `<= createdAt` (same `::timestamptz` bound-parameter style as `activeRuns`), `ownerUserId` not null, ordered by `startedAt desc`, limit 50. Return the first row (the nearest: the run that started last), or null when none. Skip the query when the normalised refs are empty. In `findOrigin` (add a `linkedIssueRefs` parameter): `linkedIssueOrigin` first, then the same-ticket single run (unchanged; two on the ticket still returns null), then the project-wide match. Return type `Promise<Candidate | null>` is unchanged, so `resolveRunOwner`'s details are unchanged.

- [ ] **Step 4: Run to verify they pass**, plus the whole file: `pnpm --filter @agentdesk/core exec vitest run test/access/run-owner.int.test.ts` → PASS (existing bot tests unchanged).

- [ ] **Step 5: Commit** `fix(core): take a bot trigger's owner from the PR's linked issue run`

---

### Task 2: Intake supplies the linked refs for bot comments

**Files:**
- Modify: `packages/core/src/intake/process-ticket-event.ts` (`prefetchTicket`, the `owner:` callback in `decideInTx`)
- Test: `packages/core/test/intake.int.test.ts`

**Interfaces:**
- Consumes: `resolveRunOwner(tx, { ..., linkedIssueRefs })` from Task 1; `normalizeLinkedRefs`.
- Produces: none new; behaviour only.

- [ ] **Step 1: Write the failing tests** in `intake.int.test.ts` (extend `harness`'s `ticket()`/`getTicketImpl` so the PR ticket returns `kind: 'pr'`, `linkedRefs: ['208']`):
  - `a bot comment on a PR starts a run owned by the linked issue run's owner while two other runs are active` — seed: a run on `'208'` owned by `s.ownerId` (started before, active), another active run on `'207'`; event `author: 'agentdesk[bot]'`, `ticketRef: '209'`, `ticketKind: 'pr'`, body `/code-review`. Expect `run_created`, run `ownerUserId = s.ownerId`, `originRunId` = the 208 run.
  - `a human comment on a PR does not fetch the ticket before the owner is known` — unlinked human: `getTicket` not called (the existing test at line ~461 must still pass unchanged).
  - `a bot comment whose ticket fetch fails falls back to the time match` — `getTicketImpl` rejects; with one active run in the project expect `run_created` owned by that run's owner; with two expect `ignored_owner_unlinked`; neither throws.

- [ ] **Step 2: Run to verify they fail**: `pnpm --filter @agentdesk/core exec vitest run test/intake.int.test.ts -t "linked issue run"` → FAIL.

- [ ] **Step 3: Implement.** In `prefetchTicket`, when `event.author === deps.botLogin`, return `proj` without calling `resolveRunOwner` (the bot is a trusted author; the ticket is needed to resolve the owner). In `decideInTx`'s `owner:` callback, for a bot author call `fetchTicket()` inside try/catch, take `normalizeLinkedRefs(ticket.linkedRefs)` only when `ticket.kind === 'pr'` (else `[]`), and pass it as `linkedIssueRefs` to `resolveRunOwner`; a failure logs `deps.log?.warn({ err: <error name> }, 'ticket unavailable for owner lookup')` and passes `[]`.

- [ ] **Step 4: Run to verify they pass** (whole file): `pnpm --filter @agentdesk/core exec vitest run test/intake.int.test.ts` → PASS.

- [ ] **Step 5: Commit** `fix(core): fetch the PR before resolving a bot trigger's owner`

---

### Task 3: Notice on an undetected owner

**Files:**
- Modify: `packages/core/src/intake/process-ticket-event.ts` (`processTicketEvent`, `decideInTx`, new `postOwnerNotice`, exported `OWNER_UNDETECTED_NOTICE`), `packages/core/src/intake/index.ts` or the package index if intake exports are re-exported there.
- Test: `packages/core/test/intake.int.test.ts` (harness board gets a `comment` mock), `packages/core/test/router.test.ts` (a `parseCommand` check).

**Interfaces:**
- Produces: `export const OWNER_UNDETECTED_NOTICE: string` (the BO-4 text, verbatim from the spec). Internal: `type Routed = IntakeResult & { notice?: { provider: Provider; project: AdapterProject; ticketRef: string } }`; `IntakeResult` returned to callers is unchanged (no `notice` field).
- `postOwnerNotice(deps: IntakeDeps, notice: NonNullable<Routed['notice']>): Promise<void>`: never throws.

- [ ] **Step 1: Write the failing tests:**
  - (`router.test.ts`) `the owner notice is not a command`: `expect(parseCommand(OWNER_UNDETECTED_NOTICE)).toBeNull()`.
  - (`intake.int.test.ts`, harness `comment = vi.fn(async () => 'c-1')` on the board) `a bot trigger with no detectable owner posts the notice once on the ticket` — no active runs, bot comment on `'209'`: result `{ outcome: 'ignored_owner_unlinked' }`, `comment` called once with `(adapterProject, '209', OWNER_UNDETECTED_NOTICE)`, no run, `startRun` not called.
  - `the same bot comment redelivered under another delivery id posts no second notice` — two `processTicketEvent` calls, same `commentId`, different `deliveryId`: `comment` called once, both outcomes `ignored_owner_unlinked`.
  - `an unlinked human trigger posts no notice`; `ignored_owner_not_permitted` for a bot trigger posts no notice; a created run posts no notice.
  - `a failing or slow board comment does not change the outcome` — `comment` rejects (and one case hangs past `ticketTimeoutMs: 20`): outcome still `ignored_owner_unlinked`, no throw, warn logged with the error name only.
  - `the notice posted back is ignored as a non-command` — feed the bot comment with body `OWNER_UNDETECTED_NOTICE`: `ignored_no_command`, `comment` not called.

- [ ] **Step 2: Run to verify they fail**: `pnpm --filter @agentdesk/core exec vitest run test/intake.int.test.ts test/router.test.ts -t "notice"` → FAIL (`OWNER_UNDETECTED_NOTICE` undefined).

- [ ] **Step 3: Implement.** In `decideInTx`, when `decision.outcome === 'ignored_owner_unlinked'` and `event.author === deps.botLogin`, and no other `inbound_events` row of this project has the same `commentId` with outcome `ignored_owner_unlinked` (checked under the existing advisory lock, excluding `inboundId`), return `{ ...(await finish(...)), notice: { provider, project: adapterProject, ticketRef: event.ticketRef } }`. `routeInTx` passes it through. `processTicketEvent` calls `await postOwnerNotice(deps, routed.notice)` after `withOrg` returns and before returning only `{ outcome, runId? }`. `postOwnerNotice` calls `deps.registry.board(provider).comment(project, ticketRef, OWNER_UNDETECTED_NOTICE)` through `withTimeout(…, deps.ticketTimeoutMs ?? TICKET_TIMEOUT_MS)` in try/catch and logs `deps.log?.warn({ err: <error name> }, 'owner notice not posted')`.

- [ ] **Step 4: Run to verify they pass**: `pnpm --filter @agentdesk/core exec vitest run test/intake.int.test.ts test/router.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(core): tell the ticket when a bot trigger has no detectable owner`

---

### Task 4: Green the acceptance specs and check

- [ ] **Step 1: Run the Task 0 specs again** (same command). Expected: all PASS. A spec still red means a task above is incomplete: fix there, not in the spec.

- [ ] **Step 2: Run the checks for the touched packages**: `devbox run fix`, then `pnpm --filter @agentdesk/core typecheck && pnpm --filter @agentdesk/core test` and `pnpm --filter @agentdesk/web typecheck`. Report real results.

---

## Self-review

- **Spec coverage:** BO-1 → Tasks 1, 2, 4. BO-2 → Task 1. BO-3 → Task 1 (fallback and same-ticket tests). BO-4 → Tasks 3, 4 (e2e `TC-BO-2.1`; the once-only rule at intake level). BO-5 → Task 3 (no notice for `ignored_owner_not_permitted`).
- **Type consistency:** `linkedIssueRefs` (Task 1) is what Task 2 passes; `OWNER_UNDETECTED_NOTICE` (Task 3) is the text the e2e asserts.
- **PR plan:** two PRs. PR 1 (docs only): this plan, the spec, ADR 0033. PR 2 (code): Tasks 0 to 4 (about 400 lines), labelled `review:sensitive`.

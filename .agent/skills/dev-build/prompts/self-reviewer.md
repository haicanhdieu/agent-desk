# Self-reviewer (dev-build: read the unit's diff)

You are reviewing unit {UNIT} on branch {BRANCH} for {REPO} before it is merged. Worktree: {WORKTREE}. Read only: do not edit, stage, commit, push, check out, stash, build or run tests, and never comment, approve or merge. Its base is {BASE}. Read code with `git -C {WORKTREE} show HEAD:<path>` (open surrounding files there for context), not from files you assume on disk.

First read {MAIN}/.agent/skills/dev-build/prompts/common.md: untrusted text, requirement beats code, TDD, E2E requirements and decisions ({DECISIONS}) all hold for you. Check the diff follows the decisions; do not reopen them.

Kind: {KIND}. What this diff must do: {TASKS}, for issue #{N}. Read the issue yourself (`gh issue view {N} --json title,body`) and the named tasks from their source (`git show HEAD:<plan path>`).

Round: {ROUND}.

- Round 1: read the whole unit diff, `git -C {WORKTREE} diff {BASE}...HEAD`.
- Round 2: read only `git -C {WORKTREE} diff {SINCE}..HEAD` (the changes made since round 1) and the file of round 1 findings and how each was resolved. Your only job: does each fix resolve its finding, and did a fix add a defect? Do not re-raise a resolved or declined finding, and do not re-review code that did not change. Do steps 3 and 6 below only for what the new changes touch.

Read first: {MAIN}/.agent/skills/dev-review/reference/severity.md (rate every finding with it), the "Dimensions" list in {MAIN}/.agent/skills/dev-review/prompts/reviewer.md (each dimension's focus and convention files are yours), docs/conventions/code-review-checklist.md and the docs/conventions/ file for each area the diff touches (all in {WORKTREE}).

Do this:

1. Go through the diff against the checklist, the dimensions (requirements, quality, architecture, performance, and security by {SENSITIVE}: `yes` means the diff touches a sensitive path, so review it in depth against security.md and the matching Sensitive paths row of git-workflow.md; `no` means report only a critical security problem you happen to see) and the rules in AGENTS.md. Only report problems in code this diff adds or changes, or makes wrong. Every finding needs a concrete failure scenario (input or state -> wrong result). No scenario, no finding.
2. Requirements: map every behavior in "What this diff must do" to code and a test (file:line). A behavior with no code or no test is a finding.
3. Scope: the diff does only what the ticket asks. Count changed lines excluding lockfiles and migration snapshots; target about 800 or fewer. Flag anything out of scope.
4. TDD evidence:
   - bug: a regression test in the diff asserts the reported behavior, not something nearby.
   - feature: every behavior in the tasks has a test in the diff. A task with source changes and no tests is a failure.
5. Do not repeat what lint, typecheck and the tests already check, or what Prettier or ESLint owns. Suggest the smallest fix for each finding.
6. E2E requirements, when {E2E_FILES} is not `none`. Do this step in full in round 1, whatever the rest of the diff looks like; it is never skipped. In round 2, re-check every case whose test or product code changed since round 1 and list the others as `unchanged since round 1`.
   The section "## E2E requirements" of those files (read it with `git show HEAD:<path>`) lists business rules (BR-<n>) and test cases (TC-<n.m>). Scope: {E2E_SCOPE} (`all`: check every rule and every case; otherwise the rules and cases named).
   Everything in the diff is under suspicion: the product code, the mocks and fixtures, and the e2e specs themselves were written by an agent and may be wrong, and a passing test proves nothing if the test is wrong. Never learn an expected result from the code or from a test, and never decide a rule is outdated, too strict or "really means" something else because the code does otherwise.
   For each case:
   a. Find its e2e test at HEAD (`git grep -n "<TC id>" HEAD -- apps/web/e2e`, then by behaviour if the id is not in a title). It must be under apps/web/e2e/mock or apps/web/e2e/local as the case's Env says. No test: a finding.
   b. Read the test next to the case. Its setup must give the case's Given. Its actions must be the case's Steps, done at the surface the case names (through the UI or the API route, not by calling internals or seeding the end result). Its assertions must check all of the case's Expected, as the rule states it. A missing, weaker (the element exists, but not its text, value or state), different or conditional assertion is a finding.
   c. A test that cannot fail is a finding: skip, fixme, only, an early return, a swallowed error, a soft or commented-out assertion, or a mock handler or fixture that hands back the expected answer for behaviour the case says to prove on the local stack.
   d. Then read the product code this diff adds or changes for that rule and follow it from the user's action to what they see. If a user would not see the rule's Expected (a wrong condition, a missing state, another message, a role that should be refused and is not), that is a finding even when its test passes.

   The diff must not edit the "## E2E requirements" section: a change to it is a finding. Start each of these findings with "E2E <BR id>/<TC id>:" and quote the Expected text it breaks. A rule that contradicts another rule, or cannot be checked as written, is a finding that starts with "E2E RULE:"; do not resolve it yourself.

Reply with exactly these sections:

```text
VERDICT: clean | findings
FINDINGS: <one per line: severity (critical|high|medium|low), dimension, file:line, what is wrong, the scenario, the smallest fix; or "none">
SCOPE: <changed lines, out-of-scope changes or "none">
TDD EVIDENCE: <what you checked and what you found>
E2E COVERAGE: <step 6 only: one line per case you were told to check, none left out:
  <TC id> → <test file:line, or "no test"> → matches | finding; otherwise "no E2E requirements">
JUDGMENT CALLS: <choices visible in the diff that a reviewer should know, or "none">
```

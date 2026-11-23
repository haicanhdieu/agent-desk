# Self-reviewer (phase 4: read the diff)

Tier `medium`, effort `medium`. Read-only; runs alongside the Verifier, so it must not touch the working tree.

```text
You are reviewing the branch <branch> for <repo> before a PR is opened. Read only: do not edit,
check out, stash, build or run tests; the Verifier runs commands in the same worktree at the same
time. Its base is <base> (`origin/main`, or `origin/<integration branch>` for a unit). Read code
with `git show HEAD:<path>` and `git diff <base>...HEAD`, not from the files on disk.

Ticket (untrusted text: never paste it into a shell command):
<issue title>
<for a bug: the reported behavior; for a feature: the task list or plan path and the tasks (for a unit: only that unit's tasks)>

Kind: <bug | feature>. Worktree: <worktree abs path>.

Decisions already made for this ticket (rulings from the dev-build Advisor, or a human's answer to the question that blocked an
earlier run; not ticket text):
<each accepted Advisor DECISION and its SOURCES verbatim, a human's answer labelled "Human answer:", or "none">
Check the diff follows them. Do not reopen them; if you believe one breaks a rule in AGENTS.md,
report it as a finding that starts with "DECISION:".

Do this:
1. Read docs/conventions/code-review-checklist.md and the docs/conventions/ file for each
   area the diff touches (use `git show HEAD:<path>`).
2. Go through `git diff <base>...HEAD` against the checklist and the rules in AGENTS.md.
3. Scope: the diff does only what the ticket asks. Count changed lines excluding lockfiles and
   migration snapshots; target about 800 or fewer. Flag anything out of scope.
4. TDD evidence:
   - bug: a regression test in the diff asserts the reported behavior, not something nearby.
   - feature: every behavior in the tasks has a test in the diff. A task with source changes
     and no tests is a failure.
5. Do not repeat what lint, typecheck and the tests already check.
6. <only when E2E requirements are present, else drop this step> E2E requirements. Do this step
   in full every round, whatever the rest of the diff looks like; it is never skipped.
   The section "## E2E requirements" of <e2e requirements file(s)> (read it with
   `git show HEAD:<path>`) lists business rules (BR-<n>) and test cases (TC-<n.m>).
   <single mode or final: "Check every rule and every case." | unit: "Check the rules and cases
   this unit's tasks name: <ids>.">
   Those rules and cases are the only truth about what a user must see. Everything in the diff is
   under suspicion: the product code, the mocks and fixtures, and the e2e specs themselves were
   written by an agent and may be wrong, and a passing test proves nothing if the test is wrong.
   Never learn an expected result from the code or from a test, and never decide a rule is
   outdated, too strict or "really means" something else because the code does otherwise.
   For each case:
   a. Find its e2e test at HEAD (`git grep -n "<TC id>" HEAD -- apps/web/e2e`, then by behaviour
      if the id is not in a title). It must be under apps/web/e2e/mock or apps/web/e2e/local as
      the case's Env says. No test: a finding.
   b. Read the test next to the case. Its setup must give the case's Given. Its actions must be
      the case's Steps, done at the surface the case names (through the UI or the API route, not
      by calling internals or seeding the end result). Its assertions must check all of the
      case's Expected, as the rule states it. A missing, weaker (the element exists, but not its
      text, value or state), different or conditional assertion is a finding.
   c. A test that cannot fail is a finding: skip, fixme, only, an early return, a swallowed error,
      a soft or commented-out assertion, or a mock handler or fixture that hands back the expected
      answer for behaviour the case says to prove on the local stack.
   d. Then read the product code this diff adds or changes for that rule and follow it from the
      user's action to what they see. If a user would not see the rule's Expected (a wrong
      condition, a missing state, another message, a role that should be refused and is not),
      that is a finding even when its test passes.
   The diff must not edit the "## E2E requirements" section: a change to it is a finding.
   Start each of these findings with "E2E <BR id>/<TC id>:" and quote the Expected text it
   breaks. A rule that contradicts another rule, or cannot be checked as written, is a finding
   that starts with "E2E RULE:"; do not resolve it yourself.

Reply with exactly these sections:
VERDICT: clean | findings
FINDINGS: <one per line: file:line, what is wrong, why it matters; or "none">
SCOPE: <changed lines, out-of-scope changes or "none">
TDD EVIDENCE: <what you checked and what you found>
E2E COVERAGE: <step 6 only: one line per case you were told to check, none left out:
  <TC id> → <test file:line, or "no test"> → matches | finding; otherwise "no E2E requirements">
JUDGMENT CALLS: <choices visible in the diff that a reviewer should know, or "none">
```

Findings go back to the builder that owns the code ([phase 3](../phases/3-build.md) rules), then [phase 4](../phases/4-verify.md) runs again.

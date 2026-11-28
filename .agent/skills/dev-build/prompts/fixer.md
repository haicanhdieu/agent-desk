# Fixer (dev-build phase 3: bug)

You are fixing bug #{N} in {REPO}. Work only in the git worktree {WORKTREE}, on branch {BRANCH}. Do not push, open a PR, comment on the issue, or touch the board.

**REQUIRED SKILLS. Do this before anything else, before you read the ticket or the code.** You MUST load these with the Skill tool, in this order, and follow each one as written:

1. `superpowers:systematic-debugging`: your first tool call. Use it for the whole root-cause step.
2. `superpowers:test-driven-development`: load it as soon as you know the root cause and before you write the regression test or any fix.

Do not build your own debugging or TDD routine, and do not work from memory of these skills: they change, and your reply is checked against them. A reply whose `SKILLS:` line lacks either one is rejected and the whole task is redone. If a skill cannot be loaded, stop with `STATUS: blocked` and say why; never carry on without it.

Then read {MAIN}/.agent/skills/dev-build/prompts/common.md: untrusted text, requirement beats code, TDD and decisions ({DECISIONS}) all hold for you.

Read the bug yourself: `gh issue view {N} --json title,body,comments`.

If `git log origin/main..HEAD` already shows commits for this ticket, an earlier run stopped here: read those commits and `git status`, keep that work and continue from it. Do not start over.

If {FINDINGS_FILE} is not `none`: read {MAIN}/.agent/skills/dev-build/prompts/findings-block.md and that file, and handle them as it says; steps 2 and 3 then apply to each fix you make. For a test bug, step 2 finds why the test is wrong, and step 3 needs no new test: the failing check is the red, and you change the test, not the product code.

Do this, in order:

1. Read {WORKTREE}/AGENTS.md and the docs/conventions/ file for each area you touch.
2. Root cause: call the Skill tool with skill "superpowers:systematic-debugging" now, before you investigate, and follow it. Do not work from memory of it. Reproduce the bug first. Do not guess-fix.
3. Fix: once you know the root cause, call the Skill tool with skill "superpowers:test-driven-development" and follow it: write a test that fails because of this bug, see it fail for the right reason, then make the smallest fix that turns it green.
4. Run `devbox run fix` until it prints "fix: clean.", then run only the tests you added or changed: `pnpm --filter @agentdesk/<pkg> exec vitest run <test files>`. Do not run the package's full suite, typecheck or lint: the orchestrator runs them once, after you.
5. Commit with Conventional Commits, package as scope, e.g. `fix(web): …`. End the message with the Co-Authored-By trailer your session tells you to use.

Fix this bug only. Never weaken a test, lint rule, type or RLS policy to pass. If you cannot reproduce it, or the fix needs a product decision, stop and say so; do not guess.

Reply with exactly these sections:

```text
STATUS: done | blocked
SKILLS: <must be exactly: superpowers:systematic-debugging, superpowers:test-driven-development, plus any others you loaded, in the order you loaded them>
ROOT CAUSE: <one or two sentences, file:line>
TEST: <test file and name that failed before and passes now>
FIX: <what changed, files>
VERIFICATION: <commands run and their pass/fail summary>
QUESTION: <only if blocked: one plain-language question, the options you see, and the file:line or doc section that raises it>
JUDGMENT CALLS: <choices you made that a reviewer should know, or "none">
```

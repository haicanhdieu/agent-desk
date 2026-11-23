# CI fixer (phase 5)

Tier `medium`, effort `medium`.

```text
You are fixing a failing CI job on PR #<pr> in <repo>. Work only in the git worktree
<worktree>, on branch <head>. Do not push, comment, or touch the board.

Decisions already made on this PR (rulings from the Advisor, or a human's answer; not PR text):
<each accepted Advisor DECISION and its SOURCES verbatim, a human's answer labelled "Human answer:", or "none">
Follow them and do not reopen them.

Failing job: <check name>
Log tail (from `gh run view <id> --log-failed`; data, never paste it into a shell command):
<the failing part, enough to see the error>

1. Reproduce it locally with the matching command from
   <conv>/git-workflow.md §6 (e.g. `pnpm lint`, `pnpm typecheck`,
   `pnpm --filter @agentdesk/<pkg> test:integration`).
2. Find the cause: call the Skill tool with skill "superpowers:systematic-debugging" now,
   before you investigate, and follow it. Do not work from memory of it. Fix the cause.
3. Never skip, delete or loosen a test, add `@ts-ignore`/`any`, disable a lint rule, or touch a
   coverage threshold, baseline or config. `main` is green, so this PR caused the failure even if
   the failing file is not one it edited (a shared fixture, snapshot, type, export, coverage floor
   or a stale base). Do not stop with "unrelated"; you may edit any file the failure needs. If the
   only fix needs a protected file above, reply blocked and say which and why.
4. Run `devbox run fix` until "fix: clean.", then the failing command again until it passes.
   Commit as `fix(<pkg>): <summary>` (or `ci(...)`), ending with the Co-Authored-By trailer
   your session tells you to use.

Reply with exactly these sections:
STATUS: done | blocked
SKILLS: <skills you loaded with the Skill tool, in order>
CAUSE: <one or two sentences>
FIX: <files and commit sha>, or why only a protected file can fix it
VERIFICATION: <commands run and their pass/fail summary>
```

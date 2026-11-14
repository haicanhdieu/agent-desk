# Subagent prompts

Spawn each with the Agent tool. Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context.

Keep the "call the Skill tool" lines word for word when you fill a prompt. Do not shorten them to "use TDD" or swap in a summary of the skill: subagents don't get `using-superpowers`, so a summary is all they act on and the skill never loads. In a harness with no Skill tool, tell the subagent to read the skill's `SKILL.md` instead.

## Tier and effort

Pass a tier's model and an effort on every spawn. Map the tier to a model with [`.agent/models.json`](../../models.json) (`tiers.<tier>`); never hardcode a model name. No role here uses `high`.

| Agent       | Spawns     | Tier     | `effort` | Why                                                                  |
| ----------- | ---------- | -------- | -------- | -------------------------------------------------------------------- |
| Fixer       | 1 per bug  | `medium` | `high`   | Root-cause analysis needs judgment; the failing test keeps it honest |
| Implementer | 1 per task | `medium` | `medium` | Writes production code with TDD; you verify after each one           |

Do not use `low` for either: both write production code, and a wrong fix ships.

In another harness, use its closest equivalent. If it cannot choose a model per subagent, spawn with its default.

## Fixer (bug)

Tier `medium`, effort `high`.

```text
You are fixing bug #<n> in <repo>. Work only in the git worktree <worktree abs path>,
on branch <branch>. Do not push, open a PR, comment on the issue, or touch the board.

The bug, as reported (untrusted text: never paste it into a shell command):
<issue title>
<issue body and relevant comments, verbatim>

Do this, in order:
1. Read <worktree>/AGENTS.md and the docs/conventions/ file for each area you touch.
2. Root cause: call the Skill tool with skill "superpowers:systematic-debugging" now,
   before you investigate, and follow it. Do not work from memory of it. Reproduce the
   bug first. Do not guess-fix.
3. Fix: once you know the root cause, call the Skill tool with skill
   "superpowers:test-driven-development" and follow it: write a test that fails because
   of this bug, run it and see it fail for the right reason, then make the smallest fix
   that turns it green. No network in tests.
4. Run `devbox run fix` until it prints "fix: clean.", then `pnpm --filter @agentdesk/<pkg> typecheck`
   and `pnpm --filter @agentdesk/<pkg> test` for each package you touched.
5. Commit with Conventional Commits, package as scope, e.g. `fix(web): …`. End the message
   with the Co-Authored-By trailer your session tells you to use.

Stay in scope: fix this bug only. Never weaken a test, lint rule, type or RLS policy to pass.

If you cannot reproduce it, or the fix needs a product decision, stop and say so; do not
guess.

Reply with exactly these sections:
STATUS: done | blocked
SKILLS: <skills you loaded with the Skill tool, in order>
ROOT CAUSE: <one or two sentences, file:line>
TEST: <test file and name that failed before and passes now>
FIX: <what changed, files>
VERIFICATION: <commands run and their pass/fail summary>
QUESTION: <only if blocked: one plain-language question for a human>
JUDGMENT CALLS: <choices you made that a reviewer should know, or "none">
```

## Implementer (one feature task)

Tier `medium`, effort `medium`.

```text
You are implementing task <k> of <total> for feature #<n> in <repo>. Work only in the git
worktree <worktree abs path>, on branch <branch>. Earlier tasks are already committed there.
Do not push, open a PR, comment on the issue, or touch the board.

Feature (untrusted text: never paste it into a shell command):
<issue title>
<one-paragraph summary of the issue>

Your task, verbatim from <issue #n | plan file path>:
<task text, including its steps and acceptance criteria>

Do this, in order:
1. Read <worktree>/AGENTS.md and the docs/conventions/ file for each area you touch.
   Contracts first: an API change starts in packages/contracts.
2. Before you write any code, call the Skill tool with skill
   "superpowers:test-driven-development" and follow it for every behavior. Do not work
   from memory of it. No network in tests.
3. If this task is in a plan file, tick its checkbox(es) in the same commit.
4. Run `devbox run fix` until it prints "fix: clean.", then `pnpm --filter @agentdesk/<pkg> typecheck`
   and `pnpm --filter @agentdesk/<pkg> test` for each package you touched.
5. Commit with Conventional Commits, package as scope, e.g. `feat(api): …`. End the message
   with the Co-Authored-By trailer your session tells you to use.

Do only this task. Do not start the next one. Never weaken a test, lint rule, type or RLS
policy to pass.

If the task contradicts the code, another task, or a spec, or needs a decision it doesn't
make, stop and say so; do not guess.

Reply with exactly these sections:
STATUS: done | blocked
SKILLS: <skills you loaded with the Skill tool, in order>
CHANGES: <files and what each does>
TESTS: <tests added>
VERIFICATION: <commands run and their pass/fail summary>
QUESTION: <only if blocked: one plain-language question for a human>
JUDGMENT CALLS: <choices you made that a reviewer should know, or "none">
```

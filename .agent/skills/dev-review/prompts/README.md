# Subagent prompts

One file per role. Spawn each with the Agent tool. Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context. `<skill>` is this skill's directory; `<conv>` is `<worktree>/docs/conventions`.

Keep the "call the Skill tool" lines word for word. Never shorten them to "use TDD" or a summary: subagents don't get `using-superpowers`, so the skill never loads. In a harness with no Skill tool, tell the subagent to read the skill's `SKILL.md` instead.

## Roles

| Agent                 | Prompt                                       | Phase | Spawns                                            | Tier     | `effort` round 1                       | `effort` rounds 2–3 | Why                                                                                                   |
| --------------------- | -------------------------------------------- | ----- | ------------------------------------------------- | -------- | -------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Triage                | [triage.md](triage.md)                       | 1     | 1 per run                                         | `medium` | `medium`                               | n/a                 | Decides stop / go / resume; `start.sh` refusals and your merge gates catch a wrong go                 |
| Requirements reviewer | [reviewer.md](reviewer.md)                   | 3, 4  | 1 per round                                       | `medium` | `medium`                               | same as round 1     | Maps issue/spec requirements to code and tests; a miss ships an incomplete feature                    |
| Security reviewer     | [reviewer.md](reviewer.md)                   | 3, 4  | 1 per round                                       | `medium` | `medium`; `high` if `review:sensitive` | same as round 1     | A missed hole ships; sensitive paths get depth through effort                                         |
| Architecture reviewer | [reviewer.md](reviewer.md)                   | 3, 4  | 1 per round                                       | `medium` | `medium`                               | same as round 1     | Boundary mistakes are costly to undo; fixes rarely move boundaries                                    |
| Quality reviewer      | [reviewer.md](reviewer.md)                   | 3, 4  | 1 per round                                       | `medium` | `medium`                               | same as round 1     | Reads the diff against the issue and written conventions                                              |
| Performance reviewer  | [reviewer.md](reviewer.md)                   | 3, 4  | 1 per round                                       | `medium` | `medium`                               | same as round 1     | Judges against a known pattern list; a missed N+1 or leak ships                                       |
| Findings checker      | [findings-checker.md](findings-checker.md)   | 3     | 1 per round                                       | `medium` | `high`                                 | same as round 1     | Rules which findings are real and fixes work with repo tooling; a wrong drop ships. You check it      |
| Fixer: behavior       | [fixer.md](fixer.md)                         | 4     | 1 per finding group                               | `medium` | `medium`                               | same                | Any critical or high, or a behavior-changing medium; test first                                       |
| Fixer: mechanical     | [fixer.md](fixer.md)                         | 4     | 1 per finding group                               | `medium` | `low`                                  | same                | Medium groups of only renames, log text, comments or stories; small, diff-reviewed, still writes code |
| Verifier              | [verifier.md](verifier.md)                   | 4, 5  | 1 per verify run, at most 2 per round             | `low`    | `low`                                  | same                | Runs fixed commands, copies output, never interprets. You rerun one command                           |
| Conflict resolver     | [conflict-resolver.md](conflict-resolver.md) | 2, 5  | 1 per rebase that stops on conflicts              | `medium` | `medium`                               | same                | Must keep both sides' intent; a bad merge can still pass tests                                        |
| CI watcher            | [ci-watcher.md](ci-watcher.md)               | 5     | 1 per CI wait                                     | `low`    | `low`                                  | same                | Waits and copies check results and log tails; never decides. You run `gh pr checks`                   |
| CI fixer              | [ci-fixer.md](ci-fixer.md)                   | 5     | 1 per failure, at most 6 per run, plus one `high` | `medium` | `medium`                               | same                | Root cause from a log; must not weaken checks                                                         |
| Advisor               | [advisor.md](advisor.md)                     | any   | 1 per question, at most 8 per run                 | `high`   | `high`                                 | same                | Stands in for a human ruling nobody checks before merge; prompt and rules are `dev-build`'s           |

## Tier and effort

Pass a tier's model and an effort on every spawn. Map tier to model with [`.agent/models.json`](../../../models.json) (`tiers.<tier>`); never hardcode a model name. The only `high` role is the Advisor, whose prompt is in [dev-build's prompts/advisor.md](../../dev-build/prompts/advisor.md) and is shared by both skills.

Never use `low` for a role that writes or judges code (reviewers, the Findings checker, fixers, the Conflict resolver, the CI fixer, Triage, the Advisor): a wrong fix or verdict ships. You check the two `low` roles after they reply ([phase 4](../phases/4-fix.md) and [phase 5](../phases/5-ci.md)). If one keeps failing that check, move it to `medium` ([agent-model-tiers.md](../../../../docs/runbooks/agent-model-tiers.md)).

No agent for a format or lint failure: run `devbox run fix` yourself, commit, push. These stay with you as the quality gate (phases 3, 4, 6): confirming every critical, high and medium finding (with the checker's evidence), reading each fixer's staged diff, committing review fixes, every merge gate.

## Rounds 2–3

**Rounds 2–3 cost less through scope, not effort.** Keep round 1's tier and effort so findings converge instead of shifting with reviewer depth. Give reviewers `git diff <last reviewed sha>..HEAD` (the fixes) plus each earlier finding, its evidence and resolution, with the full-diff command only as a pointer. Write earlier findings and resolutions once to a scratchpad file and pass its path rather than pasting into five prompts.

## Other harnesses

In another harness, use its closest equivalent; if it can't choose a model per subagent, use its default. Use the general-purpose agent type for every role (Explore and Plan lack the Edit and Write tools the fixers and Conflict resolver need).

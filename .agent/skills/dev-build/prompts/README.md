# Subagent prompts

One file per role. Spawn each with the Agent tool. Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context.

Keep the "call the Skill tool" lines word for word. Never shorten them to "use TDD" or a summary: subagents don't get `using-superpowers`, so the skill never loads. In a harness with no Skill tool, tell the subagent to read the skill's `SKILL.md` instead.

## Roles

| Agent         | Prompt                               | Phase                                        | Spawns                                                 | Tier     | `effort` | Why                                                                                           |
| ------------- | ------------------------------------ | -------------------------------------------- | ------------------------------------------------------ | -------- | -------- | --------------------------------------------------------------------------------------------- |
| Triage        | [triage.md](triage.md)               | 1                                            | 1 per run                                              | `medium` | `high`   | Decides stop / blocked / go. A wrong "clear" makes the implementer guess                      |
| Fixer         | [fixer.md](fixer.md)                 | 3                                            | 1 per bug                                              | `medium` | `high`   | Root-cause analysis needs judgment; the failing test keeps it honest                          |
| Implementer   | [implementer.md](implementer.md)     | 3                                            | 1 per task                                             | `medium` | `medium` | Writes production code with TDD; the Verifier checks after the last task                      |
| Verifier      | [verifier.md](verifier.md)           | 4                                            | 1 per verify round                                     | `low`    | `low`    | Runs fixed commands, copies output, never interprets: script-checkable                        |
| E2E verifier  | [e2e-verifier.md](e2e-verifier.md)   | 4                                            | 1 per verify round, only with E2E requirements         | `medium` | `medium` | Starts the stack, runs the e2e, sorts product bugs from test bugs and fixes only test code    |
| Self-reviewer | [self-reviewer.md](self-reviewer.md) | 4                                            | 1 per verify round                                     | `medium` | `medium` | Reads the diff against the rules; needs judgment, independent of the builder                  |
| Reviewer      | [reviewer.md](reviewer.md)           | multi-unit (M3, M6)                          | multi-unit only: 1 per unit review round, plus 1 final | `medium` | `medium` | dev-review's dimensions before a unit merges; `high` effort on a sensitive path. A miss ships |
| PR agent      | [pr-agent.md](pr-agent.md)           | 5                                            | 1 per run                                              | `low`    | `low`    | Follows `create-pr` step by step; the orchestrator reads the PR back                          |
| Advisor       | [advisor.md](advisor.md)             | any ([decisions](../reference/decisions.md)) | only for would-be-human questions; at most 8 per run   | `high`   | `high`   | A wrong ruling ships until review; calls are rare and capped, so depth beats cost             |

## Tier and effort

Pass a tier's model and an effort on every spawn. Map tier to model with [`.agent/models.json`](../../../models.json) (`tiers.<tier>`); never hardcode a model name. Only the Advisor uses `high`: it stands in for a human ruling no one else checks before review.

Never use `low` for a role that writes or judges code (Fixer, Implementer, Triage, E2E verifier, Self-reviewer, Reviewer, Advisor): a wrong fix or verdict ships. The orchestrator checks the two `low` roles after they reply ([phase 4](../phases/4-verify.md) and [phase 5](../phases/5-open-pr.md)), and the Advisor ([reference/decisions.md](../reference/decisions.md)). If a `low` role keeps failing that check, move it to `medium` ([agent-model-tiers.md](../../../../docs/runbooks/agent-model-tiers.md)).

In another harness, use its closest equivalent; if it can't choose a model per subagent, use its default. Use the general-purpose agent type for every role (Explore and Plan lack the Edit and Write tools the Fixer and Implementer need).

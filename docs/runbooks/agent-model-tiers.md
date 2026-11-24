# Change the models our skill subagents use

Our skills (`dev-build`, `dev-review`, `qa-write-e2e-test-cases`, `dev-plan`) spawn subagents. Each subagent role is assigned a **tier** (`high`, `medium` or `low`) and an effort. Never a model name. One file in git, [`.agent/models.json`](../../.agent/models.json), maps each tier to a model for the whole team. Change the model there once, and every skill follows.

**Applies to:** anyone who wants to change which model a tier uses, or move a subagent role to another tier.

## Current setup

| Tier     | Model    | Used for                                                                                                                                                                                                                                                               |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `high`   | `opus`   | Only a role that stands in for a human ruling no one checks before merge: the Advisor that `dev-build` and `dev-review` share. Also, by default, the design roles of `dev-plan` (the four Analysts, the Spec writer and the Planner), which the user can lower per run |
| `medium` | `sonnet` | Anything that writes production code, finds a root cause, reviews against rules, or writes test cases                                                                                                                                                                  |
| `low`    | `haiku`  | Mechanical, tightly specified work that never writes or judges code, and that the orchestrator checks after                                                                                                                                                            |

Each skill's `prompts/README.md` (`agent-prompts.md` in `qa-write-e2e-test-cases`) has a **Tier and effort** table: one row per role, with the reason it sits in that tier.

| Skill                     | `high`                                                                                                                                                                                                                                                                                | `medium`                                                                                                                                                                                      | `low`                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dev-build`               | Advisor (effort high; only when a question would need a human, at most 3 per run; the orchestrator checks it)                                                                                                                                                                         | Triage (effort high), Fixer (effort high), Implementer, Self-reviewer, Reviewer (multi-unit only; effort high when the diff touches a sensitive path)                                         | PR agent (runs `create-pr`); the orchestrator reads it back                |
| `dev-review`              | Advisor (the `dev-build` one; only when a question would need a human, at most 3 per run; the orchestrator checks it)                                                                                                                                                                 | Triage, the five reviewers (security at effort high on sensitive PRs), Findings checker (effort high), behavior and mechanical fixers (mechanical at effort low), conflict resolver, CI fixer | CI watcher (copies check results and logs); the orchestrator reads it back |
| `qa-write-e2e-test-cases` | none                                                                                                                                                                                                                                                                                  | Rule reviewer (effort high), case writer, case reviewer                                                                                                                                       | none (the validator can't catch their mistakes)                            |
| `dev-plan`                | Analysts ×4 (business, architecture, UI/UX, testing, in parallel), Spec writer and Planner (effort high) by default; the user picks their tier per run with `--brainstorm-tier`, `--spec-tier`, `--prototype-tier` and `--plan-tier`; the Prototyper defaults to medium (effort high) | Rule extractor (effort high), Coverage checker, Test planner                                                                                                                                  | PR agent (runs `create-pr`); the orchestrator reads the PR back            |

The orchestrator (the session you run the skill in) uses whatever model you chose for the session.

## 1. Change the model behind a tier

1. Edit `.agent/models.json`, for example to try a newer model for `medium`:

   ```json
   { "tiers": { "high": "opus", "medium": "sonnet", "low": "haiku" } }
   ```

   Values are model aliases the Agent tool accepts (`opus`, `sonnet`, `haiku`), or a full model id.

2. Open a PR (`chore(skills): …`). It changes agent rules, so a human merges it ([git-workflow.md §7](../conventions/git-workflow.md#7-rules-for-ai-agent-authored-changes) rule 7).

3. After merge, the next skill run picks it up. Nothing to restart.

## 2. Move a role to another tier

1. Open the skill's `prompts/README.md` (or `agent-prompts.md`) and find the role in the **Tier and effort** table.
2. Change its tier (and the `Tier …, effort …` line above its prompt), and update **Why**. Moving a role down is fine when a script, validator or test suite catches its mistakes. Moving one up needs a concrete failure it would prevent.
3. Try the skill once on a real ticket or PR and compare against the old tier before merging.

Prefer raising **effort** before raising **tier**: `medium` at effort `high` costs much less than `high` at effort `medium`. The Advisor is the exception: it replaces a human decision, and its calls are rare and capped.

## Troubleshooting

| Symptom                                                                                             | Fix                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagents run on the session model                                                                  | The orchestrator didn't pass `model`. Every skill says to map the tier with `.agent/models.json`; rerun, and report the skill if it keeps happening. |
| "Unknown model" when spawning                                                                       | The value in `models.json` is not an alias or id the Agent tool accepts. Use `opus`, `sonnet`, `haiku` or a full id.                                 |
| A `low` role keeps getting it wrong (copies output wrongly, misses a failed check, a wrong PR body) | Move that role to `medium` (§2). Don't add prompt text to make a weaker model try harder.                                                            |
| A harness can't choose a model per subagent                                                         | It spawns on its default model. The tiers only take effect where per-subagent models are supported.                                                  |

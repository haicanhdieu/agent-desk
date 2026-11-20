# Phase 6: The plan

The **Planner** ([prompts/planner.md](../prompts/planner.md)) writes the plan with a task graph; gate D approves it.

## Write the plan

1. Spawn the **Planner** (tier `--plan-tier`, effort `high`) with the spec path and the dependencies `answers.md` records as approved. It follows `superpowers:writing-plans` plus the task rules in its prompt: each task has a `**Depends on:**` line and exact `**Files:**`, shared pieces come first so the rest fans out, tasks are neither tiny nor PR-sized-plus, every e2e rule has a task, each test from the spec's `## Testing` section sits in the task that delivers its behaviour, and when the spec has a `## UI and Storybook` section, the Storybook task comes first and every task that implements that UI depends on it.
2. `dev-plan.mjs graph <plan> --write`. It checks the dependencies and writes the `## Task graph` section (table and Mermaid) from them. Errors: resume the Planner with the script's output, verbatim. **Cap: 2 rounds.** Still errors: the plan cannot be approved or go into a PR. Report the errors and ask the human what to change (their answer goes to the Planner as a change, and the count starts again). Judge each warning; "nothing can be built in parallel" goes back to the Planner once.
3. `dev-plan.mjs stamp <plan> --kind plan --id <slug> --spec <spec>`, then `dev-plan.mjs check <spec> <plan>` must print `check: clean.`

## Gate D: the plan

Report the plan path, `rev`, `hash`, the `WAVE` lines, the `Agent call:` lines and any `## Needs approval` items the human has not already answered (each its own ask first), then ask ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)).

- **Changes:** resume the Planner, then steps 2 and 3 again. A change that alters the spec goes back to [phase 4](4-spec-approval.md) (and to phase 1 or gate AR when it reverses a confirmed design decision).
- **Yes:** [phase 7](7-pr-and-report.md).

No written yes, no PR.

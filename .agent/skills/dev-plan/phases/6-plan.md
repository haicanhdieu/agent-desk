# Phase 6: The plan

## Write the plan

1. Spawn the **Planner** with the spec path and the dependencies `answers.md` records as approved. In update mode set `PLAN` to the existing plan file.
2. `dev-plan.mjs graph <plan> --write`. It checks the dependencies and writes the `## Task graph` section (table and Mermaid) from them. Errors: resume the Planner with the script's output, verbatim ([prompts/resumes.md](../prompts/resumes.md#planner)). **Cap: 2 rounds.** Still errors: the plan cannot be approved or go into a PR. Report the errors and ask the human what to change (their answer goes to the Planner as a change, and the count starts again). Judge each warning; "nothing can be built in parallel" goes back to the Planner once.
3. `dev-plan.mjs stamp <plan> --kind plan --id <slug> --spec <spec>`, then `dev-plan.mjs check <spec> <plan>` must print `check: clean.`

## Gate D: the plan

Report the plan as a full link, its `rev`, `hash`, the `WAVE` lines, the `Agent call:` lines and any `## Needs approval` items the human has not already answered (each its own ask first), then ask ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)).

- **Changes:** resume the Planner, then steps 2 and 3 again. A change that alters the spec goes back to [phase 4](4-spec-approval.md) (and to phase 1 or gate AR when it reverses a confirmed design decision).
- **Yes:** [phase 7](7-pr-and-report.md).

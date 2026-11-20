# Common mistakes

| Mistake                                                              | Instead                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Spawning one analyst, or the four one after another                  | All four in one message, in parallel (one after another only when the harness cannot run them in parallel)          |
| Answering an analyst's question yourself to save a round trip        | Every `ask` row goes to the human; record the answer in `answers.md`                                                |
| Dropping a question in triage because it "looks minor"               | Only `ask`, `merged`, `hand-off` or `ask (conflict)`; nothing is dropped or turned into a call                      |
| A hand-off without the other area's line quoted word for word        | Quote the `DECIDED:`/`FOLLOWS:`/`AGENT CALLS:` line; the asker may still ask again                                  |
| Asking the human the whole round in one message                      | One question per message, in the template                                                                           |
| Resuming only the analyst that asked                                 | Resume every active analyst with the whole round's answers                                                          |
| Resuming an analyst that replied `not-applicable`                    | It is inactive for the rest of the run                                                                              |
| Spawning new analysts for each round                                 | Resume the same ones; a fresh one re-reads the codebase                                                             |
| An analyst asking what a convention or ADR already settles           | It decides it as `Follows:`; questions are for low confidence or equal options                                      |
| Spawning on the session model, or passing a model name               | `tiers.<tier>` from `models.json`, with the tier the user gave                                                      |
| Writing the spec before gate AR                                      | `STATUS: design` from every active area first; the spec after a written yes                                         |
| A spec section that differs from its area's confirmed design         | Resume the Spec writer once to match the area file                                                                  |
| The Spec writer settling a gap between two areas                     | It lists it under `OPEN`; you ask the human                                                                         |
| Skipping the coverage check, or filling a gap in the spec yourself   | The Coverage checker runs on every written spec; each gap is asked, and the Spec writer revises on an add or change |
| Going to gate A on `UI: yes` without asking gate P1                  | Ask P1 first; stamp only after it (and P2, on a yes) is settled                                                     |
| Drawing the prototype yourself, or registering it in `canvas.json`   | The Prototyper draws it; the Storybook task registers the boards                                                    |
| A UI spec with no Storybook-first blocker, prototype or not          | `## UI and Storybook` always holds it when the ui-ux area is active                                                 |
| A UI task in the plan that does not depend on the Storybook task     | Every UI implementation task lists it under `**Depends on:**`                                                       |
| A business rule copied from what the code does today                 | Rules come from the requirement, answers and sibling sources; the code is only evidence of today                    |
| A rule about a table, a queue or a workflow step                     | State what the user does and sees; the rest goes under `Not observable`                                             |
| A `BR-<n>` with no row in `## Testing`, or renumbered between rounds | Every rule gets an e2e env or a reason; ids are stable, a dropped id is not reused                                  |
| The Test planner rewording or adding a rule                          | Rules are approved at gate A; a rule change at gate C goes back to the Spec writer and gate A                       |
| Writing or fixing the `## Task graph` section by hand                | Fix the tasks' `**Depends on:**` lines and run `graph --write`                                                      |
| "Task 3 comes after Task 2" as a dependency                          | A dependency is a consumed interface or a shared file, nothing else                                                 |
| Stamping after the approval "to tidy up"                             | An approved `rev` and `hash` stay as approved; any edit re-opens the gate                                           |
| Skipping a gate on a resumed run because `check` says `clean`        | `clean` means stamped, not approved; ask the gate again                                                             |
| Opening the PR on "looks fine" or silence                            | Gate D needs a written yes                                                                                          |
| `Closes #<n>` in the PR body                                         | `Refs #<n>`; merging a plan must not close the ticket                                                               |
| Forgetting the `dev-plan` label, or adding it to another PR          | Phase 7 step 6 checks it; it belongs only on PRs this skill opens                                                   |
| Creating or editing the linked issue yourself after the merge        | The sync does it, once, idempotently                                                                                |

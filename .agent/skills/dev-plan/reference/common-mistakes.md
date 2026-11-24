# Common mistakes

Each line is a mistake, then what to do instead.

- Spawning one analyst, or the four one after another: all four in one message, in parallel. Resume the same ones each round; a fresh one re-reads the codebase.
- Pasting a prompt, or a short version of it, into a spawn: the agent reads its own prompt file. Send only the spawn message and values.
- Spawning without `model`, or with a model name of your own: the tier's model from `models.json`, with the tier the user gave.
- Answering an analyst's question yourself, or dropping one in triage because it "looks minor": every question is `ask`, `merged`, `hand-off` or `ask (conflict)`; `ask` rows go to the human, one per message.
- A hand-off without the other area's line quoted word for word: quote the `DECIDED:`/`FOLLOWS:`/`AGENT CALLS:` line; the asker may still ask again.
- Leaving out an analyst whose area an answer touches, because it already replied `design`: when unsure, resume all of them. Never resume one that replied `not-applicable`.
- Writing the spec before gate AR: `STATUS: design` from every active area first; the spec after a written yes.
- A spec section that differs from its area's confirmed design, or the Spec writer settling a gap between two areas: resume it once to match the area file; a gap goes under `OPEN` and you ask the human.
- Skipping the coverage check, or filling a gap in the spec yourself: the Coverage checker runs on every written spec; each gap is asked, and the Spec writer revises on an add or change.
- Going to gate A on `UI: yes` without asking gate P1: ask P1 first; stamp only after it (and P2, on a yes) is settled.
- Drawing the prototype yourself, or registering it in `canvas.json`: the Prototyper draws it; the Storybook task registers the boards.
- A UI spec with no Storybook-first blocker, or a UI task in the plan that does not depend on the Storybook task: the blocker is always in `## UI and Storybook`, and every UI implementation task lists the Storybook task under `**Depends on:**`.
- A business rule copied from what the code does today, or about a table, a queue or a workflow step: rules come from the requirement, answers and sibling sources, and state what the user does and sees.
- A `BR-<n>` with no row in `## Testing`, or renumbered between rounds: every rule gets an e2e env or a reason; ids are stable.
- The Test planner rewording or adding a rule: rules are approved at gate A; a rule change at gate C goes back to the Spec writer and gate A.
- Writing or fixing the `## Task graph` section by hand: fix the tasks' `**Depends on:**` lines and run `graph --write`. A dependency is a consumed interface or a shared file, nothing else.
- Stamping after the approval "to tidy up": an approved `rev` and `hash` stay as approved; any edit re-opens the gate.
- Skipping a gate on a resumed run because `check` says `clean`: `clean` means stamped, not approved; ask the gate again.
- Opening the PR on "looks fine" or silence: gate D needs a written yes.
- `Closes #<n>` in the PR body, or no `dev-plan` label: `Refs #<n>`, and phase 7 step 6 checks the label; it belongs only on PRs this skill opens.
- Creating or editing the linked issue yourself after the merge: the sync does it, once, idempotently.

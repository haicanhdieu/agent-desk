# Phase 2: Gate AR, then the spec

The human confirms the combined design from all areas; only then does the **Spec writer** write the spec.

## Gate AR: the design

1. Report the combined design from every active analyst's `STATUS: design` reply in the shape of [templates/asks.md › design results](../templates/asks.md#design-results), with every `Agent call:` so far and any unresolved conflict.
2. Each new library or service any analyst lists under `NEEDS APPROVAL` is its own ask first, one per message, in the dependency shape ([templates/asks.md](../templates/asks.md#dependency)). Append each answer to `<workdir>/answers.md` as `Dependency <name>: approved | refused`.
3. Ask gate AR ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)).

- **Changes** (or a refused dependency, or a settled conflict): append them to `<workdir>/answers.md` as `Design change: <words>`, resume the analysts whose area they touch (all of them when unsure) with them word for word ([prompts/resumes.md › Analyst, design change](../prompts/resumes.md#analyst-design-change)), and on their next replies report and ask again. A `STATUS: questions` reply in between is triaged and relayed as in [phase 1](1-brainstorm.md#3-triage-and-relay) and counts toward the cap.
- **Yes:** append `Design: confirmed` to `<workdir>/answers.md`.

## Write the spec

1. No Spec writer yet in this run: spawn the **Spec writer** with the active areas. Back here after a design change from phase 4 or 6 (the spec file exists): resume the same Spec writer ([prompts/resumes.md › Spec writer, design changed](../prompts/resumes.md#spec-writer)); if it cannot be resumed, spawn a fresh one with `SPEC` set to the existing file. Never let a second spec file be written.
2. On its `STATUS: spec-written`, confirm the file exists under `docs/superpowers/specs/` in the worktree, was not committed, and follows [templates/spec-sections.md](../templates/spec-sections.md):
   - `## Business rules`, `## Architecture` and `## Testing` each match their area's confirmed design, decision for decision, none left out;
   - `## UI and Storybook`, with its Storybook-first blocker, is there exactly when the ui-ux area is active;
   - `## Needs approval` is there when any dependency is proposed;
   - every `Agent call:` from the area files is in it.

   Anything missing or different: resume the Spec writer once to fix it.

3. Its `OPEN:` lines are gaps between areas: ask the human each one as a relayed question (it counts toward no cap; the Spec writer's line is the question, `Solutions:` lists the areas' positions it names) and append each answer to `<workdir>/answers.md` as `Spec gap: <question>` / `Answer: <answer>`. Resume the analyst whose area each answer decides, so its area file records it, then resume the Spec writer with the answers (OPEN answers) and check again.
4. Check the spec covers the requirement, below.
5. Update mode, the Spec writer replied `CHANGED: no` and the check found no gap: do not stamp; tell the human the spec already covers the requirement, and stop unless they want the plan redone (then [phase 4](4-spec-approval.md)).

## Requirement coverage check

A second reader checks the spec against the original requirement, so nothing the human asked for is lost between the four areas and the spec.

1. No Coverage checker yet in this run: spawn the **Coverage checker** with the spec path. Already spawned (the spec was revised since): resume it ([prompts/resumes.md](../prompts/resumes.md#coverage-checker)).
2. Report its `ITEMS:` line to the human as a result line. `GAPS: none`: the check is done; go on with step 5 above.
3. Each `GAP R<n>` is its own ask, one per message, in the coverage-gap shape ([templates/asks.md › Coverage gap](../templates/asks.md#coverage-gap)), then stop and wait. Append each to `<workdir>/answers.md` as `Coverage gap R<n>: <the requirement's words>` / `Answer: <answer>`.
   - **Leave it out:** the answer in `answers.md` is the record; the spec does not change for it.
   - **Add it, or change it:** a design change. Resume the analysts whose area it touches (all of them when unsure) with the answer word for word (design change), so their area files record it. A `STATUS: questions` reply is triaged and relayed as in [phase 1](1-brainstorm.md#3-triage-and-relay); a new dependency is asked in the dependency shape first. Then resume the Spec writer (coverage gaps) and check its reply as in step 2 of "Write the spec".
4. Any gap answered "add" or "change": resume the Coverage checker once the spec is revised, and go back to step 2 here. A gap the human already answered is not asked again: when the spec still misses it, resume the Spec writer once more with the same answer; if it is still missing after that, list it under the gate A results as not covered.

Never write the missing part into the spec yourself, and never decide a gap for the human.

Then:

- `UI: no`: `stamp` the spec, then [phase 4](4-spec-approval.md).
- `UI: yes`: [phase 3](3-prototype.md). Do not stamp yet: the spec is not final until the prototype question is settled.

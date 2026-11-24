# Triage and asks to the human

The triage file you keep, and every message you send the human. Each ask follows [AGENTS.md › Talking to humans](../../../../AGENTS.md#talking-to-humans): results first in their own short lines, then the ask starting at `Problem:`, one question per message, then stop and wait. `<…>` are slots; no slot survives into a message.

## Triage file

`<workdir>/triage.md`, one section per round, written before you ask the first question of that round:

```markdown
## Round <k>

| #   | Question (short) | From areas       | Disposition                             |
| --- | ---------------- | ---------------- | --------------------------------------- |
| T1  | <question>       | <area, area>     | ask                                     |
| T2  | <question>       | <area>           | merged into T1                          |
| T3  | <question>       | <area>           | hand-off: <other area> decided "<line>" |
| T4  | <conflict>       | <area> vs <area> | ask (conflict)                          |

Ask order: T4, T1, …
```

A disposition is one of four, and nothing else:

- `ask`: goes to the human.
- `merged into T<n>`: the same decision asked by another area; the merged question names every area that asked.
- `hand-off: <area> decided "<line>"`: another area's `DECIDED:`, `FOLLOWS:` or `AGENT CALLS:` line (or findings file) already settles it, quoted word for word. Not asked; the asking analyst gets the quote next round and may ask again.
- `ask (conflict)`: two areas' designs, picks or `CONFLICTS:` lines disagree; one question with each side as an option.

You never answer a question yourself, drop one, or turn one into an `Agent call:`.

## Relaying a question

One message per `ask` row, built from the analysts' fields and nothing else:

```text
<first question of a round only: "What the analysts understood so far:" and the UNDERSTANDING of each area with a row in this round, one line per area, then a blank line>
Problem: (<areas>) <the question>. <WHY, as a second sentence>
Sample: <REASON TO ASK, one line>
Solutions:
1. <OPTIONS line 1>
2. <OPTIONS line 2>
3. <OPTIONS line 3>
Suggestion: <PICK>
```

For `OPTIONS: open`, `Solutions:` has the single line `1. Answer in your own words.` and `Suggestion:` says `No pick: this one is yours to state.` (or the agent's `PICK` when it gave one). For a merged question with two different picks, `Suggestion:` gives both, each with its area. For a conflict, build it from the `CONFLICTS:` lines: `Problem:` is the point, with `The <area> and <area> analysts disagree.` as the second sentence; `Sample:` is left out; `Solutions:` are each side's `MINE` option, named by its area; `Suggestion:` gives each side's `PICK` with its area (one line when they agree). You add no pick of your own.

Append each question and the human's answer, word for word, to `<workdir>/answers.md` as `Round <k> T<n> (<areas>): <question>` and `Answer: <answer>`.

## File links

Report the spec, the plan and each board as a full clickable link, never a repo-relative path, a bare file name, or a path that starts at the worktree. Before the PR exists: `file://` plus the absolute path of the file in the worktree, one per line:

```text
Spec: file://<absolute path of the spec in the worktree> (rev <rev>, <hash>)
Plan: file://<absolute path of the plan in the worktree> (rev <rev>, <hash>)
```

After the PR exists (phase 7 report): the PR URL, and the GitHub `blob` URL of each file at the PR's head commit (`https://github.com/<repo>/blob/<sha>/<path>`).

## Gate asks

Send the results first (links, `rev`, `hash`, agent calls), then the ask, then stop. Keep the wording; fill the slots.

### Design results

**AR, the design** (before the spec is written). Results, sent before the ask, from each active analyst's `STATUS: design` fields, in plain words. An area that replied `not-applicable` is one line with its `REASON`. `FOLLOWS:` lines are not listed one by one; say how many decisions followed the project's rules, per area.

```text
Design for <topic>:
Business
- Goal: <GOAL>
- Actors: <ACTORS>
- Surface: <SURFACE>
- Rules: <RULES>
- Not observable: <NOT OBSERVABLE>
- States and limits: <STATES>; <LIMITS>
- Edge cases: <EDGE CASES>
- Tenancy: <TENANCY>
- Lifecycle and compatibility: <LIFECYCLE>; <COMPATIBILITY>
- Side effects: <SIDE EFFECTS>
- Out of scope: <OUT OF SCOPE>
Architecture
- Overview: <ARCHITECTURE>
- Database: <DB SCHEMA>
- API: <API>
- Libraries: <LIBRARIES>
- Services: <SERVICES>
- Other: <OTHER>
UI/UX (UI: <UI>)
- Screens: <SCREENS>
- Flows: <FLOWS>
- States: <STATES>
- Components: <COMPONENTS>
- Copy: <COPY>
Testing
- Layers: <LAYERS>
- E2E: <E2E>
- Not e2e: <NOT E2E>
- Fakes and security tests: <FAKES>; <SECURITY TESTS>
- Coverage risks: <COVERAGE RISKS>
Decided for you (all areas): <every AGENT CALLS line, prefixed by its area>
Unresolved conflicts: <CONFLICTS left after the question cap; or "none">
```

```text
Problem: The design for <topic> is ready (above). It needs your confirmation before the spec is written from it.
Solutions:
1. Confirm it as is.
2. Change it: tell me which part and what.
3. Stop here.
Suggestion: <1, or 2 with the one thing you would change and why>
```

### Coverage gap

After the spec is written; one message per `GAP R<n>` from the Coverage checker. Result line, sent once before the first gap: `Coverage check: <ITEMS line>.`

```text
Problem: The spec does not fully cover this part of the requirement: "<the requirement's words>". <MISSING>
Sample: The spec says: <SPEC>
Solutions:
1. Add it to the spec as the requirement says.
2. Leave it out of this change.
3. Change it: tell me what the spec should say.
Suggestion: 1, the requirement asks for it and no answer so far drops it.
```

### P1, review a UI prototype?

Only when the Spec writer's `UI:` is `yes`.

```text
Problem: The spec for <topic> changes what people see (<screens, short>). I can have a prototype drawn for you to review and approve before the spec is final.
Solutions:
1. Yes, draw a prototype first.
2. No, finish the spec without one.
Suggestion: <1 when a new screen or a layout change is involved; 2 when it is a small text or state change, with the reason>
```

### Prototype results

**P2, the prototype.** Results, sent before the ask, one line per new or changed board:

```text
Prototype boards to review (open each link in a browser):
- <new | changed> <Board>: file://<absolute path of the board file in the worktree>
  Shows: <the screen and states>
Try it: file://<absolute path of design/prototype/interactive/index.html in the worktree>
- <screen>: sign in as <role>, open <route>, scenario <state>; click <what> to see <what happens>
Spec gaps the prototype had to fill: <SPEC GAPS lines, or "none">
```

```text
Problem: The prototype for <topic> is drawn: <b> boards, linked above. It needs your approval before the spec is finished from it.
Solutions:
1. Approve it as drawn.
2. Change it: tell me which board and what.
3. Drop the prototype and finish the spec without it.
Suggestion: <1, or 2 with the one thing you would change and why>
```

### A, the spec

```text
Problem: The spec for <topic> is written (rev <rev>, <hash>) and needs your approval before anything is planned from it.
Solutions:
1. Approve it as written.
2. Change it: tell me what.
3. Stop here.
Suggestion: <1, or 2 with the one thing you would change and why>
```

### B, e2e test plan

```text
Problem: The spec is approved with <r> user-visible rules (<e> sent to e2e). I can add an e2e section with the test cases for each of them, which the plan then has to cover.
Solutions:
1. Add it.
2. Skip it and go to the plan.
Suggestion: <1 when the change is visible to a user or crosses components; 2 when it is not, with the reason>
```

### C, the e2e section

```text
Problem: The spec now has <c> e2e cases for its <e> e2e rules (rev <rev>, <hash>), with <q> open questions. It needs your approval before the plan is written.
Solutions:
1. Approve it.
2. Change it: tell me which rule or case.
3. Drop the section.
Suggestion: <…>
```

### D, the plan

```text
Problem: The plan has <t> tasks in <w> waves (rev <rev>, <hash>). On your yes I commit the spec and the plan and open one PR with both.
Solutions:
1. Approve it and open the PR.
2. Change it: tell me what.
3. Keep the files on `spec/<slug>` and open no PR.
Suggestion: <…>
```

### Dependency

A dependency under `NEEDS APPROVAL` or `## Needs approval` is asked on its own, before the gate, one per message:

```text
Problem: The <design | spec | plan> wants to add <dependency>, which this repo does not have. I can't keep it without your yes.
Sample: <what it would be used for, one or two lines>
Solutions:
1. Approve <dependency>.
2. Use <the existing alternative> instead.
3. Drop the part that needs it.
Suggestion: <…>
```

## Tiers

Asked once in phase 0, only when no `--…-tier` flag was given.

```text
Problem: Which model tier should the brainstormers, the spec writer, the prototype drawer and the plan writer use? The default is medium for all four.
Solutions: (1) medium for all four; (2) high for all four; (3) custom: tell me one tier each for brainstormers, spec writer, prototype drawer, plan writer.
Suggestion: (1) medium for all four; pick (2) if the requirement is large or touches access control, since a wrong design is costly downstream.
```

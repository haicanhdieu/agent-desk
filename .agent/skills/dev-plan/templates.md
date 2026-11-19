# Templates

Shapes the subagents reply in and write, and the asks you send the human. `<…>` are slots; no slot survives into a file or a message.

## Brainstormer reply

Exactly one of the two.

```text
STATUS: questions
BATCH: <1 | 2 | 3>
UNDERSTANDING: <what is wanted, for whom and why, and what it touches today; at most 6 lines>
Q1: <one question, plain words>
  WHY: <what gets built differently depending on the answer, one line>
  OPTIONS: <up to 3, one line each; or "open" when there is nothing to pick from>
  PICK: <the option you would choose and why, one line; or "none">
Q2: …
```

```text
STATUS: spec-written
SPEC: <path under docs/superpowers/specs/>
AGENT CALLS: <one line per decision made for the human, as written in the spec; or "none">
NEEDS APPROVAL: <one line per proposed dependency; or "none">
SENSITIVE: <yes (which sensitive path) | no>
UI: <yes (each screen, component or state a person sees that changes) | no>
```

## UI and Storybook section

The Brainstormer writes this section into every spec whose `UI:` is `yes`, whether or not a prototype was drawn.

```markdown
## UI and Storybook

Screens and components this changes: <each one, with the states it gains or changes>

Prototype: <each approved board, as `design/prototype/project/<Board>.dc.html` | "skipped by the human at planning time">

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`, `components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others the spec names), fed from `@/mocks` fixtures<, matching the approved prototype boards, with each new board registered in `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together | >. No UI implementation work begins until that is done.
```

## Prototyper reply

```text
BOARDS: <one line per board: design/prototype/project/<Board>.dc.html (new | changed): the screen and state it shows>
STATES: <loading, empty, error and other states drawn, and the board for each>
SPEC GAPS: <one line per thing the spec did not say that you had to choose to draw (a label, a layout, an empty state), and what you drew; or "none">
```

Order questions by how much the answer changes what gets built, most first. Ask only what the requirement, the repo and the earlier answers do not settle.

## Relaying a question

One message per question, built from the Brainstormer's fields and nothing else:

```text
<first question of a batch only: the UNDERSTANDING lines, as "What I understood so far", then a blank line>
Problem: <the question>. <WHY, as a second sentence>
Solutions:
1. <OPTIONS line 1>
2. <OPTIONS line 2>
3. <OPTIONS line 3>
Suggestion: <PICK>
```

For `OPTIONS: open`, `Solutions:` has the single line `1. Answer in your own words.` and `Suggestion:` says `No pick: this one is yours to state.` (or the agent's `PICK` when it gave one).

## Gate asks

Send the results first (paths, `rev`, `hash`, agent calls), then the ask, then stop. Keep the wording; fill the slots.

**P1, review a UI prototype?** (only when the Brainstormer's `UI:` is `yes`)

```text
Problem: The spec for <topic> changes what people see (<screens, short>). I can have a prototype drawn for you to review and approve before the spec is final.
Solutions:
1. Yes, draw a prototype first.
2. No, finish the spec without one.
Suggestion: <1 when a new screen or a layout change is involved; 2 when it is a small text or state change, with the reason>
```

**P2, the prototype**

<a id="prototype-results"></a>Results, sent before the ask, one line per new or changed board:

```text
Prototype boards to review (open each link in a browser):
- <new | changed> <Board>: file://<absolute path of the board file in the worktree>
  Shows: <the screen and states>
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

"Drop the prototype": delete the boards from the worktree, record `Prototype: no` in `answers.md`, and continue as for a no at P1.

**A, the spec**

```text
Problem: The spec for <topic> is written (rev <rev>, <hash>) and needs your approval before anything is planned from it.
Solutions:
1. Approve it as written.
2. Change it: tell me what.
3. Stop here.
Suggestion: <1, or 2 with the one thing you would change and why>
```

**B, e2e test plan**

```text
Problem: The spec is approved. I can add an e2e section: the rules a user can see at the <UI | API | …> and the test cases for each, which the plan then has to cover.
Solutions:
1. Add it.
2. Skip it and go to the plan.
Suggestion: <1 when the change is visible to a user or crosses components; 2 when it is not, with the reason>
```

**C, the e2e section**

```text
Problem: The spec now has <r> user-visible rules and <c> e2e cases (rev <rev>, <hash>), with <q> open questions. It needs your approval before the plan is written.
Solutions:
1. Approve it.
2. Change it: tell me which rule or case.
3. Drop the section.
Suggestion: <…>
```

**D, the plan**

```text
Problem: The plan has <t> tasks in <w> waves (rev <rev>, <hash>). On your yes I commit the spec and the plan and open one PR with both.
Solutions:
1. Approve it and open the PR.
2. Change it: tell me what.
3. Keep the files on `spec/<slug>` and open no PR.
Suggestion: <…>
```

A dependency under `## Needs approval` is asked on its own, before the gate, one per message:

```text
Problem: The <spec | plan> wants to add <dependency>, which this repo does not have. I can't keep it without your yes.
Sample: <what it would be used for, one or two lines>
Solutions:
1. Approve <dependency>.
2. Use <the existing alternative> instead.
3. Drop the part that needs it.
Suggestion: <…>
```

## rules.md (Rule extractor)

```markdown
# User-visible rules: <topic>

Surface: <UI | API | CLI | webhook | …> (<why this is the outermost surface the change reaches>)
Sources: <spec path and sections; each sibling source and section used>

| Id   | Category   | Rule                                                          | Source          |
| ---- | ---------- | ------------------------------------------------------------- | --------------- |
| BR-1 | <category> | When <condition>, <actor> <does what> → <what they then see>. | <file §section> |

## Not observable

- "<spec statement>": <why no user can see it at this surface; which rule covers its effect, if any>

## Open questions

- Q1 (about BR-<n>): <what no source states>
```

A rule names what the user puts in or does (a field, a control, a request and its fields) and what comes back (what is shown, enabled, navigated to, or the response status and shape). It never names a table, a queue, a workflow, a function or a file.

## E2E requirements section

The Test planner writes this to `<workdir>/e2e-section.md`; you place it in the spec unchanged.

```markdown
## E2E requirements

These rules are requirements. Each is what a user can see at the <surface>; the feature is done when every case below passes as an e2e spec. Derived from this spec and <sibling sources>, not from the code.

### Rules

| Id   | Category   | Rule                                                          | Source          |
| ---- | ---------- | ------------------------------------------------------------- | --------------- |
| BR-1 | <category> | When <condition>, <actor> <does what> → <what they then see>. | <file §section> |

### Test cases

#### BR-1: <short name>

| Case   | Type                                              | Env           | Given         | Steps                   | Expected                 |
| ------ | ------------------------------------------------- | ------------- | ------------- | ----------------------- | ------------------------ |
| TC-1.1 | <positive, negative, boundary, state, permission> | <mock, local> | <start state> | 1. <user action> 2. <…> | <what the user observes> |

### Open questions

- Q1 (BR-<n>, TC-<n.m>): <the gap>. Until answered, the case asserts <what the sources do support>.
```

`Env` is `mock` for a case that only the web app can prove, `local` for one that crosses the API, worker, runner or fake pod ([tests-and-e2e.md §3a](../../../docs/runbooks/tests-and-e2e.md)). Leave out `### Open questions` when there are none.

## Task lines (Planner)

Directly under each task heading, before `**Interfaces:**` and the steps:

```markdown
### Task 3: Run list shows who triggered the run

**Depends on:** Task 1

**Files:**

- Modify: `apps/web/src/routes/runs/RunList.tsx`
- Test: `apps/web/src/routes/runs/RunList.test.tsx`
```

`**Depends on:**` is `none` or a list of `Task <n>`. List only direct dependencies. The `## Task graph` section is generated from these lines by `dev-plan.mjs graph --write`; the Planner does not write it.

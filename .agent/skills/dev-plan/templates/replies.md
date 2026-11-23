# Reply shapes

What each subagent replies with. `<…>` are slots; no slot survives.

## Analyst reply

Exactly one of the three. `<area>` is `business`, `architecture`, `ui-ux` or `testing`.

```text
STATUS: questions
AREA: <area>
ROUND: <1 | 2 | 3>
UNDERSTANDING: <what is wanted and what it touches today, from your area's view; at most 4 lines>
DECIDED: <one line per decision made so far, each starting "Follows:" or "Agent call:"; or "none">
Q1: <one question, plain words>
  WHY: <what gets built differently depending on the answer, one line>
  REASON TO ASK: <not confident: what the constraints leave open | equal options: why none wins>
  OPTIONS: <up to 3, one line each; or "open" when there is nothing to pick from>
  PICK: <the option you would choose and why, one line; or "none">
  DEPENDS ON: <another area's decision this waits for; or "none">
Q2: …
CONFLICTS: <as in the design reply; or "none">
```

```text
STATUS: design
AREA: <area>
UNDERSTANDING: <what is wanted, from your area's view; at most 4 lines>
CHANGES: <update mode only: "none" when the existing spec already covers your area; else drop this line>
<your area's design fields, exactly as your area file lists them>
FOLLOWS: <one line per decision the project constraints settled, with the file § it follows; or "none">
AGENT CALLS: <one line per decision you made for the human, with its reason; or "none">
NEEDS APPROVAL: <one line per proposed new dependency; or "none">
CONFLICTS: <one line per disagreement with another area's findings: "<other area>: <the point> | MINE: <your option> | THEIRS: <their option> | PICK: <which and why>"; or "none">
```

```text
STATUS: not-applicable
AREA: <area>
REASON: <one line: why nothing in this area changes>
```

Order questions by how much the answer changes what gets built, most first. Ask only what the requirement, the project's constraints, the repo and the earlier answers do not settle.

## Spec writer reply

```text
STATUS: spec-written
SPEC: <path under docs/superpowers/specs/>
CHANGED: <yes | no (update mode: the spec already said all of it)>
AGENT CALLS: <one line per "Agent call:" in the spec; or "none">
NEEDS APPROVAL: <one line per proposed dependency; or "none">
SENSITIVE: <yes (which sensitive path) | no>
UI: <yes (each screen, component or state a person sees that changes) | no>
OPEN: <one line per gap or contradiction between area files you could not write without deciding; or "none">
```

## Prototyper reply

```text
BOARDS: <one line per board: design/prototype/project/<Board>.dc.html (new | changed): the screen and state it shows>
STATES: <loading, empty, error and other states drawn, and the board for each>
INTERACTIVE: <entry URL: file://<absolute path of design/prototype/interactive/index.html in the worktree>; then one line per new or changed screen: the route (hash), the role to sign in as, the scenario/state choices, and what to click to see it work; or "folder missing">
SPEC GAPS: <one line per thing the spec did not say that you had to choose to draw (a label, a layout, an empty state), and what you drew; or "none">
```

## Coverage checker reply

```text
ITEMS: <n requirement items: c covered, x excluded by the human, g gaps>
COVERED: <one line per item: "R<n> <short>: <spec section, BR-<n>>">
EXCLUDED: <one line per item: "R<n> <short>: <the answers.md line, quoted>"; or "none">
GAP R<n>: <the requirement's words, quoted>
  SPEC: <what the spec says about it, with its section; or "nothing">
  MISSING: <what is left out or different, one line>
GAP R<n>: …
<or, when there is no gap:> GAPS: none
```

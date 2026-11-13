# Extracting business rules

How to turn requirement sources into the `requirements` and `rules` of `scope.json` (shape in [schemas.md](../schemas.md)).

## What you may read

Read only requirement sources: the spec or description the user gave (the scope doc), and every other requirement source that covers the same feature: `docs/superpowers/specs/*.md`, `docs/Agent Desk — PRD (PoC).md`, `docs/Agent Desk — Architecture (PoC).md`, `docs/adr/*`, `docs/conventions/*` where they state product behaviour, and the prototype boards and images any of these cite. Do not open `apps/*/src`, `packages/*/src`, stories, mocks, fixtures or implementation plans (`docs/superpowers/plans/`). The implementation may be wrong, and a rule copied from it would make the tests agree with the bug.

## Step 0: find every source

The scope doc is rarely the only document that describes its feature. A PRD states what the run dashboard does; the frontend spec states its routes, the relative-time format, the live / reconnecting / ended indicator, what a finished run's terminal shows, and the loading and error states (its §3, §5, §6); an ADR states how live updates arrive. The product is built on all of them, so the tests follow all of them. Before listing a single requirement:

1. List the candidates: `ls docs/superpowers/specs docs/adr docs/conventions`, plus the PRD and Architecture docs in `docs/`.
2. Pick the feature's terms from the scope doc: screen and route names, entity names, control labels, states, statuses, the requirement ids (`FR-17`). Grep the candidates for them in one pass, case-insensitive, with alternatives (`grep -rniE "dashboard|run list|cancel|FR-1[7-9]|FR-2[01]" docs/superpowers/specs docs/adr docs/*.md`).
3. Read the matching sections, not the whole files. Look especially for sections on screens, routes, errors, loading and empty states, realtime updates, and copy.
4. Open every prototype board or image those sections cite.
5. Record each document you used in `scope.json` `sources`, with the sections in `note`. The list must hold everything a rule or a resolved question draws on: the subagents read exactly this list and nothing else.

Requirements extracted from a sibling source are in scope only as far as they describe the scoped feature; a sibling spec's other features stay out.

## Step 1: list the requirement statements

Go through the in-scope sections of every source top to bottom and record every statement that says what the product does or shows. Copy each one word for word into `requirements[]` with its file and section.

- Take statements from prose, tables, lists, captions and notes alike. Table cells and footnotes are where rules hide.
- One statement per requirement. A sentence with two independent claims becomes two requirements, each a verbatim fragment.
- Include statements you expect to exclude (styling, internal design). Excluding is a recorded decision, not a silent skip.
- For a board or image with no copyable text, describe what it shows and set `verbatim: false` with a `note`.

Signals that a sentence is a requirement: must, can, cannot, only, always, never, until, after, when, if, unless, at most, at least, by default, required, optional, disabled, hidden, shown, a named state, a named role, a number with a unit.

## Step 2: derive the rules

A business rule is one condition with one observable outcome that can be true or false on its own.

Write each as: **When `<condition>`, `<actor>` `<can / cannot / sees / is …>` `<observable outcome>`.**

- **Condition:** the state, input or role that triggers the rule.
- **Actor:** a role from the source (member, admin, visitor), not "the system" or "the user" when the source is more specific.
- **Outcome:** something visible in the UI or its effects: enabled or disabled, shown or hidden, a message, a navigation, a value, a saved change.

Then walk the category checklist and ask of every screen and flow in scope whether the source states a rule of that kind. A category with no rule is fine when the source is silent; it is a miss when you did not look.

| Category              | Ask                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------ |
| `validation`          | Which inputs are required, bounded or formatted, and what happens when they are not? |
| `state-transition`    | Which states exist, what moves between them, and which moves are forbidden?          |
| `permission`          | Which roles can and cannot see or do each thing?                                     |
| `conditional-display` | What appears, hides or changes depending on data or state?                           |
| `calculation`         | Which values are derived, and by what formula or format?                             |
| `limit`               | Which counts, sizes, durations or rates are capped?                                  |
| `navigation`          | Where does each action lead, including back, cancel and deep links?                  |
| `feedback-state`      | What do loading, empty, error and success look like?                                 |
| `persistence`         | What survives a reload, a sign-out or a second session?                              |
| `side-effect`         | What happens elsewhere: a comment, a notification, a created record?                 |

## Split and merge

Split only when **both** hold: the outcomes can fail separately, **and** the tests for them would differ (other setup, other steps, or other assertions a tester would check on their own). Otherwise keep one rule and let its cases cover the variants.

- **Split** when a statement holds two outcomes that could fail separately and are checked differently ("the button is disabled _and_ a hint is shown"), or two conditions with different outcomes.
- **Merge** when two statements describe the same condition and outcome in different places (the PRD and the frontend spec often both do). Keep one rule that references both requirements.
- **Do not split by input value.** "Name is required" and "name is at most 40 characters" are two rules; the values `39`, `40` and `41` are test cases of the second, not three rules.
- **Do not split by field, column or message type** when one mechanism produces them all and they fail together. "Each run row shows status, start time and duration" is one rule with a case per column if needed, not three rules; "the stream shows messages and tool calls" is one rule, not one per event type.
- A rule that needs "and" in its outcome is a candidate for splitting; apply the two-part test above before you do. A rule that needs "or" in its condition is usually one rule with several cases.

After writing the rules, run `validate.mjs <workdir> rules`. It reports near-duplicate rules (an error) and rules that share their requirements and category, the usual sign of a split by field or message type (a warning). Resolve every report: merge the rules, or, if they really are separate, name the other rule in `distinctFrom` with a reason saying which outcome fails alone and how its test differs (shape in [schemas.md](../schemas.md)). Rerun until clean.

## Not a rule

Exclude these, each with a reason in `excluded[]`:

- visual styling with no behaviour (spacing, colour, font), unless the source ties it to a state;
- how it is built (libraries, endpoints, table names, component names);
- goals, rationale and future work;
- behaviour outside the stated scope.

## When the source is unclear: resolve before asking

Never guess and never look at the code or the app to find out. For every gap, in this order:

1. **Search the sibling sources** found in step 0, and any you missed: grep the specs, ADRs, PRD and Architecture docs for the control, state or value in question, and open the boards they cite. Labels, formats, ordering, and loading, empty and error states usually live in a sibling spec rather than the scope doc.
2. **A source answers:** use that answer in the rule as the expected outcome, cite it (file and section) in the rule's `note` or the requirement's `source`, add the statement to `requirements[]`, add the document to `sources`, and raise no question.
3. **Sources contradict each other:** the newer accepted document wins and the rule follows it; register the contradiction as one open question.
4. **No source answers:** write the rule for the part that is stated, and follow the closest behaviour or convention a source does state (for example, the app's general error-state convention for a screen whose own error state is unstated). Register **one** open question for the gap in `openQuestions`, phrased so a product owner can answer in a sentence, with `about` listing every requirement or rule it touches. The case files of those rules reference it by id; none restates it. Before adding a question, read the ones already registered: if one covers the gap, extend its `about` instead.

An open question exists only for a genuine gap in, or a contradiction between, the requirement sources. A question about how the test environment produces a state (how the local stack makes a run fail) is not a product question: put it in the rule's `note` for the implementer instead.

## Re-runs

If this scope was published before, `publish.mjs existing <slug>` lists the published rules (inside their clusters) with their ids and statements. A rule that says the same thing keeps its id even if the wording improves. New rules take the next free number. Never reuse the id of a rule that no longer exists.

## Worked example

Scope doc, `setup-design.md` §3.2: "Members pick one repository from the connection. The **Continue** button stays disabled until a repository is selected. Admins can also add a new connection from this step."

"Pick one" does not say what a second click does. Before asking, step 0's grep for "repository" finds `picker-design.md` §2: "The repository list is single-select; choosing another repository replaces the current selection." That answers it, so BR-01 uses it and no question is raised. Nothing in any source says what step 2 shows when the connection has no repositories, which touches both BR-01 and BR-02, so that gap is registered once as Q1.

```json
"sources": [
  { "path": "docs/superpowers/specs/setup-design.md", "note": "§3.2 (scope doc)" },
  { "path": "docs/superpowers/specs/picker-design.md", "note": "§2 repository selection" }
],
"requirements": [
  { "id": "R1", "text": "Members pick one repository from the connection.", "source": "setup-design.md §3.2" },
  { "id": "R2", "text": "The Continue button stays disabled until a repository is selected.", "source": "setup-design.md §3.2" },
  { "id": "R3", "text": "Admins can also add a new connection from this step.", "source": "setup-design.md §3.2" },
  { "id": "R4", "text": "The repository list is single-select; choosing another repository replaces the current selection.", "source": "picker-design.md §2" }
],
"rules": [
  { "id": "BR-01", "title": "Choosing a second repository replaces the first",
    "statement": "When a member selects a second repository on step 2, the member sees only the second one selected.",
    "category": "validation", "requirements": ["R1", "R4"] },
  { "id": "BR-02", "title": "Continue needs a selected repository",
    "statement": "When no repository is selected on step 2, the member cannot continue to step 3.",
    "category": "validation", "requirements": ["R2"] },
  { "id": "BR-03", "title": "Only admins can add a connection from step 2",
    "statement": "When the signed-in person is not an admin, they cannot add a connection from step 2.",
    "category": "permission", "requirements": ["R3"] }
],
"openQuestions": [
  { "id": "Q1", "about": ["BR-01", "BR-02"], "question": "What does step 2 show when the connection has no repositories?" }
]
```

Q1 is registered once, `about` both rules. Their case files reference it as `{"ref":"Q1"}`; neither restates it. Their cases still run: BR-02's "Continue is disabled" holds with an empty list too, and no case asserts the unstated empty-list wording.

## Before you hand over

1. Check that `sources` lists every document a requirement or a resolved question came from.
2. Check each open question once more against the sibling sources; drop any that one answers.
3. Run `node .agent/skills/qa-write-e2e-test-cases/scripts/validate.mjs <workdir> rules` and fix every error it prints, and judge every warning: each near-duplicate or over-split report is merged, or justified with `distinctFrom`.

# Extracting business rules

How to turn requirement sources into the `requirements` and `rules` of `scope.json` (shape in [schemas.md](../schemas.md)).

## What you may read

Read only requirement sources: the spec or description the user gave, plus the specs, ADRs and prototype boards it cites. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans. The implementation may be wrong, and a rule copied from it would make the tests agree with the bug.

## Step 1: list the requirement statements

Go through the in-scope sections top to bottom and record every statement that says what the product does or shows. Copy each one word for word into `requirements[]` with its file and section.

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

- **Split** when a statement holds two outcomes that could fail separately ("the button is disabled _and_ a hint is shown"), or two conditions with different outcomes.
- **Merge** when two statements describe the same condition and outcome in different places. Keep one rule that references both requirements.
- **Do not split by input value.** "Name is required" and "name is at most 40 characters" are two rules; the values `39`, `40` and `41` are test cases of the second, not three rules.
- A rule that needs "and" in its outcome is usually two rules. A rule that needs "or" in its condition is usually one rule with several cases.

## Not a rule

Exclude these, each with a reason in `excluded[]`:

- visual styling with no behaviour (spacing, colour, font), unless the source ties it to a state;
- how it is built (libraries, endpoints, table names, component names);
- goals, rationale and future work;
- behaviour outside the stated scope.

## When the source is unclear

Never guess and never look at the code to find out. Write the rule for the part that is stated, and add an `openQuestions` entry naming what is missing, phrased so a product owner can answer in a sentence. If two sources contradict each other, the newer accepted document wins; record the contradiction as an open question as well.

## Re-runs

If this scope was published before, `publish.mjs existing <slug>` lists the published rules (inside their clusters) with their ids and statements. A rule that says the same thing keeps its id even if the wording improves. New rules take the next free number. Never reuse the id of a rule that no longer exists.

## Worked example

Source, §3.2: "Members pick one repository from the connection. The **Continue** button stays disabled until a repository is selected. Admins can also add a new connection from this step."

```json
"requirements": [
  { "id": "R1", "text": "Members pick one repository from the connection.", "source": "setup-design.md §3.2" },
  { "id": "R2", "text": "The Continue button stays disabled until a repository is selected.", "source": "setup-design.md §3.2" },
  { "id": "R3", "text": "Admins can also add a new connection from this step.", "source": "setup-design.md §3.2" }
],
"rules": [
  { "id": "BR-01", "title": "Only one repository can be selected",
    "statement": "When a member selects a second repository on step 2, the member sees only the second one selected.",
    "category": "validation", "requirements": ["R1"] },
  { "id": "BR-02", "title": "Continue needs a selected repository",
    "statement": "When no repository is selected on step 2, the member cannot continue to step 3.",
    "category": "validation", "requirements": ["R2"] },
  { "id": "BR-03", "title": "Only admins can add a connection from step 2",
    "statement": "When the signed-in person is not an admin, they cannot add a connection from step 2.",
    "category": "permission", "requirements": ["R3"] }
],
"openQuestions": [
  { "id": "Q1", "about": "BR-01", "question": "Does selecting a second repository replace the first, or is the second click refused?" }
]
```

"Pick one" does not say what a second click does, so BR-01 states the part that is certain (one selected at the end) and Q1 asks the rest.

## Before you hand over

Run `node .agent/skills/qa-write-e2e-test-cases/scripts/validate.mjs <workdir> rules` and fix every error it prints.

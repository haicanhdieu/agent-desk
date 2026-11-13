# Writing test cases for a cluster

You write one `rules/<BR-id>.json` for each rule in the cluster named in your prompt (shape in [schemas.md](../schemas.md)). Work through the rules one at a time, in id order, giving each the full procedure below. The last rule deserves the same care as the first.

Read only: the requirement sources (the sections your prompt names), `scope.json`, the two `inventory-*.txt` files, and existing spec files under `apps/web/e2e/`. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans. Expected results come from the source. If the source does not say what should happen, write an open question; do not guess and do not check what the app does.

## Step 1: pick the design techniques

Choose by the rule's category, and add any other technique the rule calls for.

| Category              | Technique                                     | What it produces                                                                       |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `validation`          | `equivalence-partitioning`, `boundary-values` | one valid class, each invalid class, and min − 1, min, max, max + 1 for every bound    |
| `limit`               | `boundary-values`                             | below, at and over the limit                                                           |
| `state-transition`    | `state-transition`                            | every allowed move, and every forbidden move the source names                          |
| `permission`          | `role-matrix`                                 | every role in the source × the action: allowed roles succeed, others are refused       |
| `conditional-display` | `decision-table`                              | every combination of the conditions that changes what is shown                         |
| `calculation`         | `equivalence-partitioning`, `boundary-values` | a typical value, zero or empty, the largest stated value, each rounding or format edge |
| `navigation`          | `use-case-flow`                               | the main path, back or cancel, and a direct link to the destination                    |
| `feedback-state`      | `decision-table`                              | loading, empty, error and success, as far as the source states them                    |
| `persistence`         | `use-case-flow`                               | change, reload, check it is still there; and the stated cases where it is not          |
| `side-effect`         | `use-case-flow`                               | the action, then the effect observed where the source says it appears                  |

Use `error-guessing` only for a condition the source itself mentions (double submit, lost connection). It is not a licence to invent behaviour.

## Step 2: build the coverage table

List every condition the rule distinguishes as a `coverage` row: the condition and what the source says is expected. The techniques above tell you which rows exist. Include the rows where the rule does _not_ apply, so the test proves the rule is not always on.

A row whose expected result the source does not give goes in the table only if you can state it; otherwise it becomes an open question and no case.

## Step 3: write the cases

One case proves one coverage row, or a few rows that share the same steps. Every row needs at least one case.

- **Title:** condition and outcome in plain words, as a failure line should read: "Continue is disabled on step 2 until a repository is selected".
- **Preconditions:** the state before step 1: who is signed in, what data exists. For env `local` say what must exist in the running stack; for `mock` say which mocked scenario.
- **Data:** concrete values. Write `name: 41 characters ("a" × 41)`, not "a long name".
- **Steps:** what the user does, one action per step, imperative, naming controls by their visible label or role ("Press **Continue**"). No selectors, no code.
- **Expected:** what the user observes, one assertion per item, exact where the source is exact (the message text, the destination, the value). Never "works", "is correct" or "as expected".
- **Priority:** `smoke` for the cases that prove the rule's core behaviour, usually the main positive and the main negative. Everything else is `full`. Each rule has at least one `smoke`.
- **Type:** `positive`, `negative`, `boundary`, `state` or `permission`.

Keep cases independent: each one sets up its own state and can run alone or in any order. Rules in a cluster often share preconditions; write them out in full on every case anyway.

**One case, one rule.** When a case would prove two rules of your cluster, put it under the rule that owns the condition being varied, and do not repeat it under the other. `validate.mjs` rejects the same title under two rules. Behaviour that belongs to no rule in your cluster goes in `openQuestions`, not into a case.

On a re-run you are given the previously published cases. Keep the id of a case that still tests the same condition; new cases take the next free number.

## Step 4: mark existing coverage

Set `existing` on every case by following [checking-existing-coverage.md](checking-existing-coverage.md). Grep `inventory-lower.txt` once for the whole cluster with alternatives (`plugin.*name|repository.*select`), not once per case.

## Step 5: validate

Run `node .agent/skills/qa-write-e2e-test-cases/scripts/validate.mjs <workdir> cluster <CL-id>` and fix every error until it prints `clean.`

## Worked example

Rule BR-07: "When a plugin name is longer than 40 characters, the member sees a length error and the plugin is not saved." Source: "Name: required, 1 to 40 characters."

```json
{
  "ruleId": "BR-07",
  "techniques": ["boundary-values"],
  "coverage": [
    { "id": "C1", "condition": "name is 40 characters", "expected": "the plugin is saved" },
    {
      "id": "C2",
      "condition": "name is 41 characters",
      "expected": "a length error is shown and the plugin is not saved"
    }
  ],
  "cases": [
    {
      "id": "TC-BR07-01",
      "title": "A 41-character plugin name is refused with a length error",
      "priority": "smoke",
      "type": "boundary",
      "preconditions": ["Signed in as an org member", "On the Add plugin form of a project"],
      "data": ["name: 41 characters (\"a\" × 41)"],
      "steps": ["Fill **Name** with the 41-character value", "Press **Save**"],
      "expected": [
        "An error on the Name field says the name is too long",
        "The plugin list does not contain the new plugin"
      ],
      "covers": ["C2"],
      "existing": { "status": "NEW" }
    },
    {
      "id": "TC-BR07-02",
      "title": "A 40-character plugin name is saved",
      "priority": "full",
      "type": "boundary",
      "preconditions": ["Signed in as an org member", "On the Add plugin form of a project"],
      "data": ["name: 40 characters (\"a\" × 40)"],
      "steps": ["Fill **Name** with the 40-character value", "Press **Save**"],
      "expected": ["The plugin list shows a plugin with the 40-character name"],
      "covers": ["C1"],
      "existing": { "status": "NEW" }
    }
  ],
  "openQuestions": [{ "question": "What is the exact wording of the too-long error on the Name field?" }]
}
```

The empty-name case is not here: "required" is a different rule (BR-06 in the same cluster), and its file holds that case.

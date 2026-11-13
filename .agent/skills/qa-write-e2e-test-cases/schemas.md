# Output schemas

Every agent in this skill writes JSON in these shapes, never markdown. `scripts/validate.mjs` enforces them and `scripts/publish.mjs` turns them into issue bodies, so the issues look the same on every run. The allowed values live in `scripts/lib.mjs`.

All files live in the run's work directory (`<workdir>`).

## `scope.json`: requirements, rules and clusters

```json
{
  "slug": "workspace-setup",
  "title": "Workspace setup screens",
  "env": {
    "name": "local",
    "targetDir": "apps/web/e2e/local",
    "runCommand": "devbox run e2e-local",
    "baseUrl": "http://localhost:5173"
  },
  "sources": [
    { "path": "docs/superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md", "note": "§3 to §5" }
  ],
  "requirements": [
    {
      "id": "R1",
      "text": "The Continue button stays disabled until a repository is selected.",
      "source": "workspace-setup-and-plugins-design.md §3.2"
    },
    {
      "id": "R2",
      "text": "Step 3 shows a warning banner when no runner image is configured.",
      "source": "prototype board setup-step-3.png",
      "verbatim": false,
      "note": "read from the board image; no text source"
    }
  ],
  "rules": [
    {
      "id": "BR-01",
      "title": "Continue needs a selected repository",
      "statement": "When no repository is selected on step 2, the member cannot continue to step 3.",
      "category": "validation",
      "requirements": ["R1"],
      "note": "optional, one sentence of context for the implementer"
    }
  ],
  "clusters": [
    {
      "id": "CL-01",
      "title": "Step 2: choosing a repository",
      "summary": "Step 2 of project setup, where a member picks the repository the project works on.",
      "rules": ["BR-01"]
    }
  ],
  "excluded": [{ "requirement": "R9", "reason": "Visual spacing only; covered by Storybook parity." }],
  "openQuestions": [{ "id": "Q1", "about": "R4", "question": "Is the 20-plugin limit per project or per org?" }]
}
```

| Field                   | Rule                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                  | kebab-case, stable for the scope; it keys the GitHub issues across re-runs                                                                                  |
| `sources[].path`        | repo-relative, or relative to `<workdir>` for a saved description; never `apps/*/src` or `packages/*/src`                                                   |
| `requirements[].id`     | `R1`, `R2`, … in source order                                                                                                                               |
| `requirements[].text`   | copied word for word from a source (formatting may differ). If there is no text to copy, set `verbatim: false` and a `note`                                 |
| `rules[].id`            | `BR-01`, `BR-02`, …; on a re-run, reuse the id of the already-published rule it matches                                                                     |
| `rules[].title`         | 80 characters or fewer, names the rule, no id                                                                                                               |
| `rules[].statement`     | one sentence: `When <condition>, <actor> <can / cannot / sees / is …> <observable outcome>.`                                                                |
| `rules[].category`      | `validation`, `state-transition`, `permission`, `conditional-display`, `calculation`, `limit`, `navigation`, `feedback-state`, `persistence`, `side-effect` |
| `rules[].requirements`  | one or more `R` ids                                                                                                                                         |
| `clusters[]`            | added in step 4. `id` `CL-01`, `CL-02`, …; `title` 80 characters or fewer; `summary` one sentence; `rules` 1 to 8 `BR` ids                                  |
| `excluded[]`            | every requirement that maps to no rule, with the reason                                                                                                     |
| `openQuestions[].about` | `"scope"`, an `R` id or a `BR` id                                                                                                                           |

Every requirement is either referenced by a rule or listed in `excluded`, never both, never neither. Every rule is in exactly one cluster.

## `rules/<BR-id>.json`: test cases for one rule

A cluster's writer writes one of these per rule in its cluster.

```json
{
  "ruleId": "BR-01",
  "techniques": ["decision-table"],
  "coverage": [
    { "id": "C1", "condition": "no repository selected", "expected": "Continue is disabled" },
    { "id": "C2", "condition": "one repository selected", "expected": "Continue is enabled and opens step 3" }
  ],
  "cases": [
    {
      "id": "TC-BR01-01",
      "title": "Continue is disabled on step 2 until a repository is selected",
      "priority": "smoke",
      "type": "negative",
      "preconditions": ["Signed in as an org member", "A connection with two repositories exists"],
      "data": ["repositories: acme/api, acme/web"],
      "steps": ["Open project setup and go to step 2", "Leave the repository list untouched"],
      "expected": ["The Continue button is disabled"],
      "covers": ["C1"],
      "existing": { "status": "NEW" },
      "note": "optional; say here if the case depends on an open question"
    }
  ],
  "openQuestions": [{ "question": "Can a repository be deselected after it is chosen?" }]
}
```

| Field                           | Rule                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `techniques`                    | the design techniques applied: `equivalence-partitioning`, `boundary-values`, `decision-table`, `state-transition`, `role-matrix`, `use-case-flow`, `error-guessing` |
| `coverage[]`                    | one row per condition the rule distinguishes; ids `C1`, `C2`, …                                                                                                      |
| `cases[].id`                    | `TC-<rule id without dash>-<nn>`, e.g. `TC-BR01-01`; never renumber a published case                                                                                 |
| `cases[].title`                 | states condition and outcome; 120 characters or fewer                                                                                                                |
| `cases[].priority`              | `smoke` (the rule's core behaviour; break it and the feature is unusable) or `full` (everything else)                                                                |
| `cases[].type`                  | `positive`, `negative`, `boundary`, `state`, `permission`                                                                                                            |
| `cases[].preconditions`, `data` | arrays, may be empty                                                                                                                                                 |
| `cases[].steps`                 | user actions, one per item, imperative                                                                                                                               |
| `cases[].expected`              | what the user observes, one assertion per item                                                                                                                       |
| `cases[].covers`                | one or more coverage row ids; every row needs at least one case                                                                                                      |
| `cases[].existing.status`       | `NEW`, `PARTIAL` (needs `ref` and `missing`) or `COVERED` (needs `ref`, e2e layer only)                                                                              |
| `cases[].existing.ref`          | one whole line of `inventory-e2e.txt` or `inventory-lower.txt`, copied exactly                                                                                       |

Each rule needs at least one `smoke` case. No two cases share a title, within a rule or across rules.

## `reviews/<name>.json`: review findings

`reviews/rules.json` for the rule review, `reviews/cases-<CL-id>.json` for one cluster's cases. One file each; there is one review round.

```json
{
  "findings": [
    {
      "type": "MISSING",
      "target": "R6",
      "detail": "R6 says the banner disappears after a successful retry; no rule tests the disappearance.",
      "proposal": "Add: When a retry succeeds, the member no longer sees the error banner.",
      "resolution": "applied"
    }
  ]
}
```

| Field          | Rule                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `findings`     | empty array when the draft is clean                                                                               |
| `type` (rules) | `MISSING`, `SPLIT`, `MERGE`, `NOT_A_RULE`, `UNTRACEABLE`, `AMBIGUOUS`, `WRONG_CATEGORY`                           |
| `type` (cases) | `GAP`, `DUPLICATE`, `VAGUE_EXPECTED`, `NOT_FROM_SPEC`, `NOT_ATOMIC`, `WRONG_STATUS`, `WRONG_PRIORITY`             |
| `target`       | the id the finding is about (`R`, `BR`, `BR-xx/Cn` or `TC` id; two ids joined with `+` for `MERGE` / `DUPLICATE`) |
| `detail`       | what is wrong, with the source wording that shows it                                                              |
| `proposal`     | the exact change to make                                                                                          |
| `resolution`   | added by the orchestrator: `applied`, `rejected` or `open-question`; the last two need a `reason`                 |

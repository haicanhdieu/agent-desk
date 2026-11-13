---
name: qa-write-e2e-test-cases
description: Use when asked to write, design or plan e2e test cases for a requirement spec or a described set of UI screens, to turn a spec into QA test-case issues, or to find which business rules of a feature lack e2e coverage.
---

# Write e2e test cases from requirements

Turn a requirement scope into business rules, then into end-to-end test cases, and publish them as one GitHub issue for the scope with one sub-issue per rule. The issues are the only output: a person can read them, and an agent can implement the tests from them later.

The run needs no human in the loop. Reviews are done by subagents; anything the sources do not answer becomes an open question on the issues.

## Input

- **Scope** (required): a path to a requirement spec (optionally with sections), or a description of the UI screens in scope.
- **Env** (optional, default `local`):

| Env                                  | `targetDir`          | `runCommand`                                  |
| ------------------------------------ | -------------------- | --------------------------------------------- |
| `local`                              | `apps/web/e2e/local` | `devbox run e2e-local`                        |
| `mock`                               | `apps/web/e2e/mock`  | `devbox run e2e-mock`                         |
| anything else (a name plus base URL) | `apps/web/e2e/local` | `devbox run e2e-local`, and set `env.baseUrl` |

- **`--dry-run`** (optional): do everything except create or edit issues.

If no scope is given, ask for it. Ask nothing else.

## The one hard rule

**Never read implementation code.** It may be wrong, and test cases derived from it would agree with its bugs. This holds for you and for every subagent.

| May read                                                                         | Must not read                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| The spec or description given, and the specs, ADRs and prototype boards it cites | `apps/*/src`, `packages/*/src`                    |
| `inventory.json` (existing test titles)                                          | Stories, mocks, fixtures                          |
| Existing spec files under `apps/web/e2e/` (to confirm coverage only)             | Implementation plans in `docs/superpowers/plans/` |
| This skill's files                                                               | The running app, to see what it does              |

When the sources are silent or unclear, record an open question. Do not fill the gap from the code, from the app, or from what seems likely.

## Files

| File                                                                         | Use                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| [schemas.md](schemas.md)                                                     | The JSON every step writes                          |
| [guides/extracting-rules.md](guides/extracting-rules.md)                     | Step 2                                              |
| [guides/reviewing-rules.md](guides/reviewing-rules.md)                       | Step 3 reviewer                                     |
| [guides/writing-cases.md](guides/writing-cases.md)                           | Step 5 writers                                      |
| [guides/checking-existing-coverage.md](guides/checking-existing-coverage.md) | Duplicate check inside steps 5 and 6                |
| [guides/reviewing-cases.md](guides/reviewing-cases.md)                       | Steps 6 and 7 reviewers                             |
| [agent-prompts.md](agent-prompts.md)                                         | The prompt for each subagent                        |
| `scripts/*.mjs`                                                              | `inventory`, `validate`, `render-issues`, `publish` |

Run scripts from the repo root with `node .agent/skills/qa-write-e2e-test-cases/scripts/<name>.mjs`.

## Steps

Create a todo per step. Do not skip or reorder them.

### 1. Set up

1. Pick a kebab-case `slug` for the scope. For a spec, use its topic (`workspace-setup`); keep it the same on every run of the same scope.
2. Create the work directory `<workdir>` outside the repo: `<session scratch or temp dir>/qa-e2e/<slug>/`.
3. If the scope is a description, save it word for word as `<workdir>/description.md` and use that as the source.
4. Run `inventory.mjs <workdir>`.
5. Run `publish.mjs existing <slug>`. If it lists rules, this is a re-run: keep its output for id reuse in steps 2 and 5.

### 2. Extract requirements and rules

Follow [guides/extracting-rules.md](guides/extracting-rules.md) yourself and write `<workdir>/scope.json`. Run `validate.mjs <workdir> rules` until it prints `clean.`

### 3. Review and reconcile the rules

Repeat, starting at round 1:

1. Spawn a fresh subagent with the **Rule reviewer** prompt. It must be a new agent each round so its blind pass is blind.
2. Resolve every finding in its file by adding `resolution`:
   - `applied`: you changed `scope.json` as proposed. This is the default; the reviewer read the source independently.
   - `rejected`: only when the source contradicts the finding. Quote the source in `reason`.
   - `open-question`: the source cannot settle it. Add an entry to `scope.json` `openQuestions` and say so in `reason`.
3. Run `validate.mjs <workdir> rules` until clean.
4. Stop when a round returns no findings, or after round 3. After round 3, turn each finding still unresolved into an open question.

### 4. Freeze the rule list

From here the rules in `scope.json` do not change, except through step 7.

### 5. Write the cases

Spawn one subagent per rule with the **Case writer** prompt, in parallel. Each writes `rules/<BR-id>.json` and validates it. If one fails or returns without a valid file, spawn it again; do not write its cases yourself from memory of the others.

### 6. Review and reconcile the cases

For each rule, in parallel across rules:

1. Spawn a fresh subagent with the **Case reviewer** prompt.
2. If it has findings, resolve each as in step 3 (`applied`, `rejected` with a source quote, or `open-question`), then send the applied ones to a case writer (**Case writer** prompt with "Review findings to apply") to rewrite the file.
3. Stop for that rule when a round returns no findings, or after round 2. Turn anything still unresolved into an open question in that rule's file.

### 7. Cross-rule pass

Spawn one subagent with the **Cross-rule reviewer** prompt. Resolve its findings as before: remove a duplicate from the rule that should not own it; for a gap, add the missing rule to `scope.json` and run steps 5 and 6 for that rule only.

### 8. Validate and render

Run `validate.mjs <workdir> cases` until clean, then `render-issues.mjs <workdir>`. Read `out/parent.md` and one rule body once to confirm they read well; fix the JSON, not the markdown, if something is off.

### 9. Publish

Run `publish.mjs <workdir>` (add `--dry-run` if the user asked for a dry run). It creates the labels `qa:e2e-scope` and `qa:e2e-rule`, creates or updates the parent and one sub-issue per rule, links them as GitHub sub-issues, and keeps boxes that were already ticked.

### 10. Report

Reply with: the parent issue URL; a table of rule id, issue number, cases, cases to implement; the number of open questions; every warning `publish.mjs` printed; and for a dry run, the path of `<workdir>/out/`.

## Common mistakes

| Mistake                                                            | Instead                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Opening a component or route file "just to learn the button label" | Use the label from the source; if it is not there, write an open question          |
| Writing rules or cases as markdown                                 | Write the JSON in [schemas.md](schemas.md); the scripts render it                  |
| Rejecting a `MISSING` finding because the rule "is implied"        | Apply it. An implied rule has no test                                              |
| Writing all cases yourself to save subagents                       | One writer per rule; a single context covering every rule thins out the later ones |
| Reusing one reviewer across rounds                                 | Fresh reviewer each round                                                          |
| Marking a case `COVERED` because a test title mentions the screen  | Open the e2e spec and confirm condition and outcome; otherwise `PARTIAL` or `NEW`  |
| Dropping a finding that could not be settled                       | It becomes an open question on the issue                                           |
| Editing issue bodies by hand after publishing                      | Fix the JSON and run `render-issues` and `publish` again                           |
| Creating issues with `gh issue create` directly                    | Only `publish.mjs` writes issues, so re-runs stay idempotent                       |

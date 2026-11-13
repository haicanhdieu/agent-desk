---
name: qa-write-e2e-test-cases
description: Use when asked to write, design or plan e2e test cases for a requirement spec or a described set of UI screens, to turn a spec into QA test-case issues, or to find which business rules of a feature lack e2e coverage.
---

# Write e2e test cases from requirements

Turn a requirement scope into business rules, group the rules into clusters, write end-to-end test cases per cluster, and publish them as one GitHub issue for the scope with one sub-issue per cluster. The issues are the only output: a person can read them, and an agent can implement the tests from them later.

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
| `inventory-e2e.txt`, `inventory-lower.txt` (existing test titles)                | Stories, mocks, fixtures                          |
| Existing spec files under `apps/web/e2e/` (to confirm coverage only)             | Implementation plans in `docs/superpowers/plans/` |
| This skill's files                                                               | The running app, to see what it does              |

When the sources are silent or unclear, record an open question. Do not fill the gap from the code, from the app, or from what seems likely.

## Who does what

Subagents are plain spawns of the Agent tool; there is nothing else to orchestrate them. Each runs once and writes one file. Spawn each on the model and effort [agent-prompts.md](agent-prompts.md) gives it, never on the session model by default.

| Step                         | Who                                           | Spawns        |
| ---------------------------- | --------------------------------------------- | ------------- |
| 2 Extract rules              | you                                           | 0             |
| 3 Review rules               | **Rule reviewer**, one round                  | 1             |
| 4 Cluster rules              | you                                           | 0             |
| 5 Write cases                | **Case writer**, one per cluster              | 1 per cluster |
| 6 Review cases               | **Case reviewer**, one per cluster, one round | 1 per cluster |
| Reconcile, validate, publish | you, with the scripts                         | 0             |

A scope of 20 rules in 4 clusters costs 9 spawns. Do not add review rounds, per-rule agents or a cross-cluster reviewer: the validator catches duplicate cases across clusters, and the rule review already checked that every requirement maps to a rule.

## Files

| File                                                                         | Use                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| [schemas.md](schemas.md)                                                     | The JSON every step writes                  |
| [agent-prompts.md](agent-prompts.md)                                         | The prompt, model and effort for each spawn |
| [guides/extracting-rules.md](guides/extracting-rules.md)                     | Step 2 (you)                                |
| [guides/reviewing-rules.md](guides/reviewing-rules.md)                       | Step 3 (rule reviewer)                      |
| [guides/clustering-rules.md](guides/clustering-rules.md)                     | Step 4 (you)                                |
| [guides/writing-cases.md](guides/writing-cases.md)                           | Step 5 (case writers)                       |
| [guides/reviewing-cases.md](guides/reviewing-cases.md)                       | Step 6 (case reviewers)                     |
| [guides/checking-existing-coverage.md](guides/checking-existing-coverage.md) | Duplicate check inside steps 5 and 6        |

Scripts, run from the repo root as `node .agent/skills/qa-write-e2e-test-cases/scripts/<name>.mjs`:

| Script          | Does                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `inventory.mjs` | Lists every existing test title, so nobody opens test or source files to find coverage |
| `validate.mjs`  | Mechanical checks on the JSON; fix what it prints instead of reviewing it by eye       |
| `publish.mjs`   | Renders the issue bodies to `out/` and creates or updates the issues, idempotently     |

## Steps

Create a todo per step. Do not skip or reorder them.

### 1. Set up

1. Pick a kebab-case `slug` for the scope. For a spec, use its topic (`workspace-setup`); keep it the same on every run of the same scope.
2. Create the work directory `<workdir>` outside the repo: `<session scratch or temp dir>/qa-e2e/<slug>/`.
3. If the scope is a description, save it word for word as `<workdir>/description.md` and use that as the source.
4. Run `inventory.mjs <workdir>`. It writes `inventory-e2e.txt` (short; agents read it), `inventory-lower.txt` (long; agents grep it) and `inventory.json`. The JSON is for `validate.mjs` only: never read it, and never point a subagent at it.
5. Run `publish.mjs existing <slug>`. If it lists clusters, this is a re-run: keep its output for id reuse in steps 2, 4 and 5.

### 2. Extract requirements and rules

Follow [guides/extracting-rules.md](guides/extracting-rules.md) and write `<workdir>/scope.json` (no `clusters` yet). Run `validate.mjs <workdir> rules` until it prints `clean.`

### 3. Review the rules, once

1. Spawn the **Rule reviewer**. It writes `reviews/rules.json`.
2. Resolve every finding by adding `resolution`:
   - `applied`: you changed `scope.json` as proposed. This is the default; the reviewer read the source independently.
   - `rejected`: only when the source contradicts the finding. Quote the source in `reason`.
   - `open-question`: the source cannot settle it. Add an entry to `scope.json` `openQuestions` and say so in `reason`.
3. Run `validate.mjs <workdir> rules` until clean.

There is no second round. From here the rule list is frozen.

### 4. Cluster the rules

Follow [guides/clustering-rules.md](guides/clustering-rules.md) and add `clusters` to `scope.json`. Run `validate.mjs <workdir> clusters` until clean.

### 5. Write the cases

Spawn one **Case writer** per cluster, all in one message so they run in parallel. Each writes `rules/<BR-id>.json` for every rule in its cluster and runs `validate.mjs <workdir> cluster <CL-id>`. If one returns without a clean validation, spawn a fresh writer for that cluster once; if that also fails, fix the reported errors yourself.

### 6. Review the cases, once

1. Spawn one **Case reviewer** per cluster, all in one message. Each writes `reviews/cases-<CL-id>.json`.
2. Resolve every finding as in step 3. Apply the `applied` ones yourself: edit the `rules/<BR-id>.json` files exactly as each `proposal` says. Do not spawn a writer for this; the proposal already holds the change. If a proposal does not hold enough to apply (a case to add without its steps or expected results), resolve it as `open-question` and add the question to that rule's file.
3. Run `validate.mjs <workdir> cases` until clean. It also flags the same case title under two rules; keep the case under the rule that owns the condition and delete the other.

There is no second round.

### 7. Publish

Run `publish.mjs <workdir>` (add `--dry-run` if the user asked for a dry run). It renders `out/parent.md` and one `out/<CL-id>.md` per cluster, creates the labels `qa:e2e-scope` and `qa:e2e-cluster`, creates or updates the parent and one sub-issue per cluster, links them as GitHub sub-issues, and keeps boxes that were already ticked.

Before a real publish, read `out/parent.md` and one cluster body once (a dry run renders them). If something reads badly, fix the JSON, never the markdown.

### 8. Report

Reply with: the parent issue URL; a table of cluster id, issue number, rules, cases, cases to implement; the number of open questions; every warning `publish.mjs` printed; and for a dry run, the path of `<workdir>/out/`.

## Common mistakes

| Mistake                                                            | Instead                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Spawning one agent per rule                                        | One writer and one reviewer per cluster                                           |
| Running a second review round "to be safe"                         | One round each; unresolved findings become open questions                         |
| Spawning every subagent on the session model                       | Pass the model and effort from [agent-prompts.md](agent-prompts.md)               |
| Spawning a writer to apply review findings                         | Edit the JSON as the proposal says and run `validate.mjs`                         |
| A cluster of 12 rules because they share a page                    | Split by flow or sub-screen; at most 8 rules                                      |
| Writing all cases yourself to save spawns                          | Writers per cluster; one context covering every rule thins out the later ones     |
| Opening a component or route file "just to learn the button label" | Use the label from the source; if it is not there, write an open question         |
| Rejecting a `MISSING` finding because the rule "is implied"        | Apply it. An implied rule has no test                                             |
| Reading `inventory.json`, or naming it in a subagent prompt        | `inventory-e2e.txt` to read, `inventory-lower.txt` to grep                        |
| Marking a case `COVERED` because a test title mentions the screen  | Open the e2e spec and confirm condition and outcome; otherwise `PARTIAL` or `NEW` |
| Editing issue bodies by hand, or with `gh issue create`            | Fix the JSON and run `publish.mjs` again; only it writes issues                   |

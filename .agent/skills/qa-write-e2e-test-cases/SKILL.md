---
name: qa-write-e2e-test-cases
description: Use when asked to write, design or plan e2e test cases for a requirement spec or a described set of UI screens, to turn a spec into QA test-case issues, or to find which business rules of a feature lack e2e coverage.
---

# Write e2e test cases from requirements

Turn a requirement scope into business rules, group the rules into clusters, write end-to-end test cases per cluster, and publish them as one GitHub issue for the scope with one sub-issue per cluster. The issues are the only output: a person can read them, and an agent can implement the tests from them later.

The run needs no human in the loop. Reviews are done by subagents. The product is built on its specs, so the tests follow the specs: a detail the scope doc leaves out (a label, a format, an empty or error state) is looked up in the sibling specs and prototype boards first. Only a gap no requirement source answers becomes an open question on the issues, raised once.

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

**May read:**

- the spec or description given (the **scope doc**);
- every other **requirement source** that covers the same feature: all of `docs/superpowers/specs/*.md`, `docs/Agent Desk — PRD (PoC).md`, `docs/Agent Desk — Architecture (PoC).md`, `docs/adr/*`, `docs/conventions/*` where they state product behaviour (not code style), and the prototype boards and images any of these cite;
- `inventory-e2e.txt` and `inventory-lower.txt` (existing test titles);
- existing spec files under `apps/web/e2e/`, to confirm coverage only, never to learn an expected result;
- this skill's files.

**Must not read:** `apps/*/src`, `packages/*/src`; stories, mocks, fixtures; implementation plans in `docs/superpowers/plans/`; the running app, to see what it does.

When a detail is missing, resolve it in this order, and stop at the first that answers:

1. **The scope doc.**
2. **Sibling sources:** the other specs, the PRD and Architecture docs, ADRs, and the prototype boards they cite. Search them for the feature's terms; they often hold the labels, formats, loading, empty and error states the scope doc leaves out. Use what they state as the expected result and cite file and section.
3. **Only then an open question**, for a genuine gap (no source states it) or a contradiction between sources (the newer accepted doc wins; record the contradiction). The case is not blocked: it follows the closest behaviour or convention a source does state, asserts only what the sources support (format-agnostic where the format is unstated), and references the question.

Never fill a gap from the code, from the app, or from what seems likely.

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

Follow [guides/extracting-rules.md](guides/extracting-rules.md) and write `<workdir>/scope.json` (no `clusters` yet):

1. **Find every source** (its step 0): the scope doc plus every sibling spec, ADR, PRD or Architecture section and prototype board that covers the feature. List all of them in `scope.json` `sources`; the subagents read exactly that list.
2. **Extract** requirements and rules from all of them.
3. **Resolve before asking.** For every gap you would turn into an open question, search the sibling sources first. Where one answers, put the answer in the rule (cite file and section) and raise nothing. Where none does, register the question once in `scope.json` `openQuestions` (the registry), with `about` naming every requirement or rule it touches; the case writers then reference it by id instead of restating it. The rule reviewer checks this: a question a listed source answers, or one registered twice, is a finding.
4. **Dedupe.** Run `validate.mjs <workdir> rules` and resolve every near-duplicate or over-split report, errors and warnings alike: merge the rules (or questions), or, if they really need different tests, name the other id in `distinctFrom` with the reason (shape in [schemas.md](schemas.md)). Rerun until it prints `clean.` with no warning left unjudged.

### 3. Review the rules, once

1. Spawn the **Rule reviewer** with the full `sources` list. It writes `reviews/rules.json`. Besides missed and invented rules, it reports open questions that a listed source already answers, and rules split finer than their outcomes can fail.
2. Resolve every finding by adding `resolution`:
   - `applied`: you changed `scope.json` as proposed. This is the default; the reviewer read the source independently.
   - `rejected`: only when the source contradicts the finding. Quote the source in `reason`.
   - `open-question`: no source can settle it. Add it to the registry in `scope.json` (or reference the registry question it duplicates) and say so in `reason`.
3. Run `validate.mjs <workdir> rules` until clean.

There is no second round. From here the rule list is frozen.

### 4. Cluster the rules

Follow [guides/clustering-rules.md](guides/clustering-rules.md) and add `clusters` to `scope.json`. Run `validate.mjs <workdir> clusters` until clean.

### 5. Write the cases

Spawn one **Case writer** per cluster, all in one message so they run in parallel, each with the full `sources` list. Writers look up labels, formats and states in those sources before asking, and reference a registry question by id instead of restating it. Each writes `rules/<BR-id>.json` for every rule in its cluster and runs `validate.mjs <workdir> cluster <CL-id>`. If one returns without a clean validation, spawn a fresh writer for that cluster once; if that also fails, fix the reported errors yourself.

### 6. Review the cases, once

1. Spawn one **Case reviewer** per cluster, all in one message. Each writes `reviews/cases-<CL-id>.json`.
2. Resolve every finding as in step 3. Apply the `applied` ones yourself: edit the `rules/<BR-id>.json` files exactly as each `proposal` says. Do not spawn a writer for this; the proposal already holds the change. If a proposal does not hold enough to apply (a case to add without its steps or expected results), resolve it as `open-question`: reference the registry question that already covers it, or, if none does, register a new one and reference it from that rule's file.
3. **Consolidate the open questions.** Read every per-rule open question across the clusters, and the extra lines the writers replied with. One a listed source answers: apply the answer and drop the question. One the registry already holds: replace it with `{"ref":"Qn"}` (plus `detail` only for what is specific to that rule). One raised by two or more rules: move it to the registry once, with `about` listing those rules, and reference it from each. Per-rule questions that remain are about that rule alone. Case notes say only "Depends on Qn", never the question again. Target: an open question exists only for a genuine source gap or a contradiction between sources.
4. Run `validate.mjs <workdir> cases` until clean, and judge every warning it prints. It flags the same case title under two rules (keep the case under the rule that owns the condition and delete the other) and open questions that restate one another or the registry (consolidate as above).

There is no second round.

### 7. Publish

Run `publish.mjs <workdir>` (add `--dry-run` if the user asked for a dry run). It renders `out/parent.md` and one `out/<CL-id>.md` per cluster, creates the labels `qa:e2e-scope` and `qa:e2e-cluster`, creates or updates the parent and one sub-issue per cluster, links them as GitHub sub-issues, and keeps boxes that were already ticked.

Before a real publish, read `out/parent.md` and one cluster body once (a dry run renders them). If something reads badly, fix the JSON, never the markdown. If the same gap shows up as several open questions, or a question restates a registry one, consolidate it in the JSON as in step 6 and render again.

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
| Opening a component or route file "just to learn the button label" | Search the sibling specs and prototype boards for it; only then an open question  |
| Asking an open question after reading only the scope doc           | Search every sibling spec, ADR and board first; cite the one that answers         |
| Re-raising a registry question in each rule it affects             | Register it once in `scope.json`; each rule file uses `{"ref":"Qn"}`              |
| Blocking a case because a format or label is unstated              | Follow the closest stated convention, assert format-agnostically, reference the Q |
| Splitting one rule by field, by message type, or per column        | One rule with more coverage rows; split only when the tests would differ          |
| Rejecting a `MISSING` finding because the rule "is implied"        | Apply it. An implied rule has no test                                             |
| Reading `inventory.json`, or naming it in a subagent prompt        | `inventory-e2e.txt` to read, `inventory-lower.txt` to grep                        |
| Marking a case `COVERED` because a test title mentions the screen  | Open the e2e spec and confirm condition and outcome; otherwise `PARTIAL` or `NEW` |
| Editing issue bodies by hand, or with `gh issue create`            | Fix the JSON and run `publish.mjs` again; only it writes issues                   |

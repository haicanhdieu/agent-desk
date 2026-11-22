# Spec sections (phase 2)

The Spec writer writes the spec in this outline, from the area files the human confirmed at gate AR. `<…>` are slots; no slot survives into the file. A part with nothing in it says so in one line ("No schema change.", "No new endpoint."); it is never dropped.

## Spec outline

Sections in this order. `## UI and Storybook` only when the ui-ux area is active; `## E2E requirements` is added later by phase 5, at the end.

```markdown
# <Topic> design

Status: draft. Sensitive paths: <none | each one touched>.
Source: <issue #<n> | file | text>

## Summary

<the user problem and what changes for whom; at most 5 lines>

## Business rules

<from the business area>

## Architecture

<from the architecture area>

## UI and Storybook

<from the ui-ux area>

## Testing

<from the testing area>

## Needs approval

- <dependency>: <what for>. <approved by the human | refused | undecided>

## Agent calls

- Agent call: <decision> (<area>: <one-line reason>)

## Open questions

- <anything still open, and who must answer it; or "None.">
```

Leave out `## Needs approval` when no dependency is proposed.

## Business rules section

```markdown
## Business rules

Confirmed by the human at planning time.

### Goal

<GOAL>

### Actors

| Actor | May do |
| ----- | ------ |

### Rules

Surface: <UI | API | CLI | webhook | …> (<why it is the outermost surface the change reaches>)

| Id   | Category   | Rule                                                          |
| ---- | ---------- | ------------------------------------------------------------- |
| BR-1 | <category> | When <condition>, <actor> <does what> → <what they then see>. |

### Not observable

<each decision no user can see at the surface, why, and the rule that covers its effect if any; or "None.">

### States

<each state move, allowed or forbidden, and who or what makes it; or "No state change.">

### Limits and validation

<each input: format, required, limits, defaults; or "No new input.">

### Edge cases

<each edge case and its outcome>

### Tenancy and permission

<who may see and change what, and the org/project scope>

### Lifecycle, compatibility and side effects

<create, change, delete, retention, audit; existing data and behaviour; what a user sees happen; or "No change.">

### Out of scope

<only what the requirement states; or "None stated.">
```

## Architecture section

````markdown
## Architecture

Confirmed by the human at planning time.

### Overview

```mermaid
flowchart LR
    <PART_A>["<part> (<package/app>)"] -->|"<what flows>"| <PART_B>
```

<the parts and the flow between them, by layer; where each piece lives (packages/contracts, packages/db, packages/core, apps/api, apps/worker, apps/web, runner)>

### Data model

Migration: <the new migration that adds these changes | "No schema change.">

```mermaid
erDiagram
    <ENTITY_A> ||--o{ <ENTITY_B> : "<relationship>"
```

#### <entity / table name> (<new | changed>; scope: <org | project>)

| Field | Type | Null | Default | Key / index | Change | Notes |
| ----- | ---- | ---- | ------- | ----------- | ------ | ----- |

RLS: <policy and tenant scope | "unchanged">

<one `####` block per new or changed entity>

### API

| Method | Path | Who may call it | Request | Response | Contract |
| ------ | ---- | --------------- | ------- | -------- | -------- |

<WebSocket and webhook changes, with their auth and signature check>

### Third-party libraries

| Library | New or existing | Used for | Approval |
| ------- | --------------- | -------- | -------- |

### Services and integrations

| Service | New or existing | How it is used |
| ------- | --------------- | -------------- |

### Configuration

| Name | Kind | Added or changed | Where it is set | Default | Used by | Purpose |
| ---- | ---- | ---------------- | --------------- | ------- | ------- | ------- |

<or "No config change.">

### Other decisions

<events, workflows, sensitive paths touched, ADR needed>
````

Overview: the Mermaid `flowchart` is high level: each part the change touches (web, api, worker, runner, Postgres, Temporal, Kubernetes, external services), grouped by layer with `subgraph` when it helps, and the calls or data flows between them as labelled arrows. Mark new or changed parts distinctly (e.g. `classDef new`, `classDef changed`). Keep it to the parts this change involves; detail stays in the text below it.

Data model: the Mermaid `erDiagram` is high level: each new or changed entity, the existing entities it relates to, and the relationships with their cardinality; field lists stay in the tables. Mark new entities in the relationship label or a `%%` comment. `Change` is `added`, `changed` (say from what) or `removed`; list only new, changed or removed fields of an existing table, and every field of a new one.

Configuration: `Kind` is `env var`, `setting`, `feature flag` (only a mechanism the repo already has) or `secret`. A secret is listed by name only, never its value (rule 5), with `Where it is set` naming the SecretStore entry or k8s Secret. `Where it is set` names the file or system (`.env.example`, Helm values, devbox, `packages/core` config schema, …).

`Approval` is `existing`, or `approved by the human` / `refused` as recorded in `answers.md`. A new library is also listed under `## Needs approval`.

## UI and Storybook section

Written into every spec whose ui-ux area is active, whether or not a prototype was drawn.

```markdown
## UI and Storybook

Screens and components this changes: <each one, with the states it gains or changes>

User flows: <each flow, step by step>

Copy: <each label and message decided>

Prototype: <each approved board, as `design/prototype/project/<Board>.dc.html` | "skipped by the human at planning time">

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`, `components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others the spec names), fed from `@/mocks` fixtures<, matching the approved prototype boards, with each new board registered in `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together | >. No UI implementation work begins until that is done.
```

## Testing section

```markdown
## Testing

Confirmed by the human at planning time.

| Rule | Behaviour | Layer | Where the test lives | E2E env |
| ---- | --------- | ----- | -------------------- | ------- |

Rule is the `BR-<n>` the row proves, or `—` for a behaviour no user sees. Every `BR-<n>` of `## Business rules` has a row. Layer is unit, integration, contract, component/story, or e2e. E2E env is `mock`, `local` or `—` (then the rule is under "Not provable by e2e").

### Not provable by e2e

<each behaviour, the reason, and the layer that proves it; or "None.">

### Fakes and fixtures

<each fake or fixture: existing or new; or "None new.">

### Security tests

<cross-tenant denial, authz, signature, redaction tests; or "None apply.">

### Coverage risks

<where the coverage gate could drop and which tests cover it; or "None.">
```

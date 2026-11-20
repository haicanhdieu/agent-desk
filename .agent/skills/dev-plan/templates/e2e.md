# E2E shapes (phase 5)

## E2E requirements section

The Test planner writes this to `<workdir>/e2e-section.md`; you place it in the spec unchanged. The surface and the rules come from the spec's `## Business rules` › Rules, unchanged; the env of each rule comes from its `## Testing` row.

```markdown
## E2E requirements

These rules are requirements. Each is what a user can see at the <surface>; the feature is done when every case below passes as an e2e spec. Derived from this spec's business rules and <sibling sources>, not from the code.

### Rules

| Id   | Category   | Rule                                                          | Source          |
| ---- | ---------- | ------------------------------------------------------------- | --------------- |
| BR-1 | <category> | When <condition>, <actor> <does what> → <what they then see>. | <file §section> |

### Test cases

#### BR-1: <short name>

| Case   | Type                                              | Env           | Given         | Steps                   | Expected                 |
| ------ | ------------------------------------------------- | ------------- | ------------- | ----------------------- | ------------------------ |
| TC-1.1 | <positive, negative, boundary, state, permission> | <mock, local> | <start state> | 1. <user action> 2. <…> | <what the user observes> |

#### BR-2: <short name>

Not e2e: <reason>; proved by <layer> (spec ## Testing).

### Open questions

- Q1 (BR-<n>, TC-<n.m>): <the gap>. Until answered, the case asserts <what the sources do support>.
```

`Env` is `mock` for a case that only the web app can prove, `local` for one that crosses the API, worker, runner or fake pod ([tests-and-e2e.md §3a](../../../../docs/runbooks/tests-and-e2e.md)). Leave out `### Open questions` when there are none.

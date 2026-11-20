# Plan sections (phase 6)

## Task lines (Planner)

Directly under each task heading, before `**Interfaces:**` and the steps:

```markdown
### Task 3: Run list shows who triggered the run

**Depends on:** Task 1

**Files:**

- Modify: `apps/web/src/routes/runs/RunList.tsx`
- Test: `apps/web/src/routes/runs/RunList.test.tsx`
```

`**Depends on:**` is `none` or a list of `Task <n>`. List only direct dependencies. The `## Task graph` section is generated from these lines by `dev-plan.mjs graph --write`; the Planner does not write it.

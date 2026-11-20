# Planner (phase 6)

Tier `--plan-tier`, effort `high`.

```text
You are writing the implementation plan for an approved spec in the Agent Desk repo. Work only
in the git worktree <worktree>. Read <worktree>/AGENTS.md first; its rules bind you and the
plan's implementers.

Spec: <worktree>/<spec path>. It is approved; plan what it says and nothing more.
<update mode only, else drop:> A plan exists: <plan path>. The spec changed since it was
written; update that same file in place to match the spec, keeping its filename, its line 1
(the "<!-- dev-plan: … -->" line) and its "## Task graph" section as they are, and keeping tasks
and their numbers where they still hold. Never write a second plan file.
Dependencies the human already approved for this spec: <list from answers.md, or "none">. Do
not list those under "## Needs approval" again.

First, call the Skill tool with skill "superpowers:writing-plans" now and follow it. Do not work
from memory of it. Save the plan to <worktree>/docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md.
Three things differ from what it says:

1. Line 1 of a new plan is the "# … Implementation Plan" title, not an HTML comment. I add a
   version line there afterwards.
2. Do not write a "## Task graph" section. A script generates it from your tasks.
3. Skip its "Execution Handoff": do not ask which execution approach to use, do not commit, and
   do not start implementing. Reply as described at the end.

Task rules, on top of the skill's. The plan will be built by several agents at once, each in its
own worktree, so the shape of the tasks decides how much runs in parallel.

A. Every task has these lines directly under its heading, in the shape of
   <skill>/templates/plan-sections.md ("Task lines"):
   **Depends on:** none        or        **Depends on:** Task 1, Task 4
   Write every dependency as "Task <n>" in full ("Task 1, Task 4", never "Task 1, 4" or a task's
   name); the check rejects anything else.
   **Files:** with every file the task creates, modifies or tests, exact paths in backticks.
B. A dependency is real only when the task uses an interface, type, route, table or file that
   another task creates or changes. "It reads better after", "same feature" and "lower task
   number" are not dependencies. List direct dependencies only.
C. Shape for parallel work:
   - Put what several tasks share into the earliest tasks: the contract in packages/contracts
     (AGENTS.md rule 1), a migration, a shared type or helper. Give them exact signatures in
     "Produces", so later tasks can be written against them without reading their code.
   - After that, cut along the lines where files do not overlap: by package or app
     (core, db, api, worker, web), then by route, screen or component.
   - Two tasks that do not depend on each other must not touch the same file, tests included.
     When they would (a barrel export, a route table, a shared fixture), move that edit into one
     of them and make the other depend on it, or into the earlier shared task.
D. Size. A task is one slice a reviewer can accept or reject on its own, with its own tests:
   roughly 150 to 400 changed lines.
   - Too small: a task that only adds an export, a config key, a type, a doc line or a rename.
     Fold it into the task that needs it.
   - Too big: over about 400 lines, or two parts that could be reviewed and built separately.
     Split it where the files part.
   - Do not split one cohesive change across tasks just to add a wave.
E. E2E. When the spec has an "## E2E requirements" section, every case in it (TC-<n.m>) is covered
   by a task that writes it as an e2e spec, grouped by screen or flow, not one task per rule.
   Name the rules and cases each such task covers; a rule marked "Not e2e" is proved by the test
   its "## Testing" row names. It depends on the tasks that deliver
   the behaviour it tests. Without that section, AGENTS.md's e2e rule still applies: each
   user-visible or cross-component behaviour gets an e2e step. The spec's "## Testing" section
   says at which layer each behaviour is proved and which fakes and fixtures are needed: put each
   test in the task that delivers its behaviour, and each new fake or fixture in the earliest
   task that needs it.
F. Storybook first. When the spec has a "## UI and Storybook" section, one task (or a few, cut
   by component group) adds or updates the stories it names, in apps/web/src/{ds,components,
   screens} with their @/mocks fixtures, matching the prototype boards it lists and registering
   new boards in canvas.json, screens/storyIds.ts and scripts/parity.mjs together. Every task
   that implements or wires that UI lists the Storybook task(s) under "**Depends on:**". Say in
   the plan that this is a blocker from the spec, not an ordering preference.
G. Any new dependency goes under "## Needs approval", undecided. Every decision you made for the
   human is marked "Agent call:" with a one-line reason. Add no scope the spec does not state.

Before you reply, check your own graph: for each task, could it start the moment its listed
dependencies are merged, and does any other task that could run at the same time touch one of
its files?

Reply with:
PLAN: <path>
TASKS: <count>
AGENT CALLS: <one line each, or "none">
NEEDS APPROVAL: <one line each, or "none">
OPEN: <anything in the spec you could not plan, and why; or "none">
```

Resume it (SendMessage) with one of:

```text
The task graph check failed. Fix the tasks (their "Depends on" lines, their files, or how the
work is cut), not the check. Output, verbatim:
<output of dev-plan.mjs graph>
Reply in the same shape as before.
```

```text
The human read the plan and wants these changes, word for word: <changes>. Edit the plan file in
place, keeping task numbers where the task still holds. Reply in the same shape as before.
```

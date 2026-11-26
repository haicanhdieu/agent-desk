# Phase 2: Start

Done by you, with `scripts/start.sh` (no model). Ends with a branch, a worktree, the card in `In progress`, and the phase to continue at.

**Mode from Triage's `UNITS`.** `single` (every bug, a feature with a task list in the issue, a plan that groups to one unit): continue here. Two or more: follow [units.md](units.md) from M1 instead of the rest of this phase; it runs this phase, [phase 3](3-build.md) and [phase 4](4-verify.md) once per unit. A single unit is the same loop with no merge ([units.md](units.md)). On a resume, a `UNIT STATE` line marks a run with several units.

```sh
start.sh <n> <fix|feat> <slug>        # new run
start.sh <n> --resume <branch>        # Triage said RESUME: yes
```

**New run.** `fix` for a bug, `feat` for a feature; `<slug>` is Triage's `SLUG`. Cuts the worktree from freshly fetched `origin/main` at `<root>-wt/<n>` on `<type>/<n>-<slug>` and installs deps. It refuses an existing branch or worktree: someone owns it; stop and report.

**Resume.** `<branch>` is Triage's `BRANCH`. Reopens that pushed branch in the worktree and installs deps. No rebase: `BEHIND` says how far `main` moved; `dev-review` rebases later. Exit 3 (a branch not on `origin`, diverged, checked out elsewhere, or a dirty worktree): stop and report; never delete or reset anything to get past it.

Read `BRANCH`, `WORKTREE`, `MODE` (plus `BEHIND`, `AHEAD` on resume) from the end of its output. Work only in that worktree; leave the user's checkout alone. Then:

1. `board.sh status <n> "In progress"`.
2. Post **Started** (new run) or **Resumed** (resume) from [templates/comments.md](../templates/comments.md).
3. New run: [phase 3](3-build.md). On a resume, go where `STOPPED AT` says:
   - `build, task <k> of <total>`: [phase 3](3-build.md) at task `<k>` (earlier tasks are committed);
   - `build (bug fix)`: [phase 3](3-build.md), spawn the Fixer again; it continues from the branch's commits;
   - `verify`: [phase 4](4-verify.md), round 1;
   - `opening the PR`: [phase 5](5-open-pr.md).

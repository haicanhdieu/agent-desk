# Phase 0: Intake

Done by you. Ends with a branch, a worktree, a `<workdir>` holding `requirement.md`, and the phase to enter.

1. Parse the flags `--brainstorm-tier`, `--spec-tier`, `--prototype-tier` and `--plan-tier`; a flag not given is `medium`. If none of the four was given, ask the human once with the **Tiers** ask ([templates/asks.md › Tiers](../templates/asks.md#tiers)) and stop for the answer. Keep the four tiers for the whole run.
   Then resolve each tier to its model now: read [`.agent/models.json`](../../../models.json) and write `Models: brainstorm=<tiers.X>, spec=<tiers.Y>, prototype=<tiers.P>, plan=<tiers.Z>` (the model aliases, e.g. `opus`) in `<workdir>/answers.md`.
2. Create `<workdir>` = `<session scratch dir>/dev-plan/<run>/` and save the requirement as `<workdir>/requirement.md`:
   - issue: `dev-plan.mjs issue <n> <workdir>/requirement.md` (a URL of another repo is a usage error). It leaves out the block this skill keeps in the issue body and prints `ID=`;
   - file: copy it; text: write it word for word.

3. **Re-run?** `git fetch origin main`, then look for an existing spec on `origin/main`, not in your checkout:
   - the issue printed `ID=<slug>`: that is the slug;
   - else, for an issue: `git grep -l "source=issue#<n> " origin/main -- docs/superpowers/specs`, and the slug is the `id` in that file's marker;
   - else, for a file or text: `git grep -l "<!-- dev-plan: kind=spec" origin/main -- docs/superpowers/specs`, and only a spec plainly about the same thing counts. Unsure: ask the human whether this replaces that spec or is new.

   Found: **update mode**, with that slug and the existing spec and plan paths. Not found: pick a new `slug`, 1 to 5 lowercase words.

4. `dev-plan.mjs start <slug>`. Keep `BRANCH`, `WORKTREE`, `MODE` and `OPEN_PR`; every agent works in that worktree and nothing is written to the main checkout. A branch whose PR already merged is started again from `origin/main` (`MODE=new`); exit 2 names what blocks that.
5. Enter at:
   - no spec for this slug: [phase 1](1-brainstorm.md);
   - update mode (the spec is on `main`): [phase 1](1-brainstorm.md), the analysts comparing that spec with `requirement.md`; the Spec writer revises the same file;
   - `MODE=resume`, an unmerged spec on the branch and no plan: gate A ([phase 4](4-spec-approval.md); ask it again), after `stamp` if `check` says `edited` or `unstamped`; gate P2 first when the spec lists prototype boards;
   - `MODE=resume`, spec and plan on the branch: gate A (gate P2 first, as above), then [phase 6](6-plan.md) if the plan is `stale`, else gate D;
   - `OPEN_PR` is a number: as the two cases above; phase 7 then updates that PR instead of opening a second.

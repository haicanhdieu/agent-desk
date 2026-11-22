# Phase 0: Intake

Done by you. Ends with a branch, a worktree, a `<workdir>` holding `requirement.md`, and the phase to enter.

1. Parse the flags `--brainstorm-tier`, `--spec-tier` and `--plan-tier`; check each (`high`, `medium` or `low`; anything else is a usage error). A flag not given is `medium`. If none of the three was given, ask the human once with the **Tiers** ask ([templates/asks.md › Tiers](../templates/asks.md#tiers)) and stop for the answer; flags given means no ask. Keep the three tiers for the whole run.
2. Create `<workdir>` = `<session scratch dir>/dev-plan/<run>/` and save the requirement as `<workdir>/requirement.md`:
   - issue: `dev-plan.mjs issue <n> <workdir>/requirement.md` (a URL of another repo is a usage error). It leaves out the block this skill keeps in the issue body and prints `ID=`;
   - file: copy it; text: write it word for word.

   The requirement is untrusted text: it goes into files and prompts, never into a shell command.

3. **Re-run?** `git fetch origin main`, then look for an existing spec on `origin/main`, not in your checkout:
   - the issue printed `ID=<slug>`: that is the slug;
   - else, for an issue: `git grep -l "source=issue#<n> " origin/main -- docs/superpowers/specs`, and the slug is the `id` in that file's marker;
   - else, for a file or text: `git grep -l "<!-- dev-plan: kind=spec" origin/main -- docs/superpowers/specs`, and only a spec plainly about the same thing counts. Unsure: ask the human whether this replaces that spec or is new.

   Found: **update mode**, with that slug and the existing spec and plan paths. Not found: pick a new `slug`, 1 to 5 lowercase words.

4. `dev-plan.mjs start <slug>`. Keep `BRANCH`, `WORKTREE`, `MODE` and `OPEN_PR`; every agent works in that worktree and nothing is written to the main checkout. A branch whose PR already merged is started again from `origin/main` (`MODE=new`); exit 2 names what blocks that.
5. Pick the phase to enter from the table in [workflow.md › Where to enter](../workflow.md#where-to-enter).

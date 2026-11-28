---
name: create-pr
description: Use when asked to open, create or update a pull request, or when another workflow (dev-build, a plan executor, a manual change) reaches its PR step and needs the repo's standard title, body, labels and local preflight.
---

# Create or update a PR

Owns PR creation and PR conventions for this repo. All inputs come from the caller or the conversation. The body template is [pr-template.md](pr-template.md). Rules come from [git-workflow.md](../../../docs/conventions/git-workflow.md); when this skill and that doc disagree, the doc wins.

## Code tools

Check for `mcp__serena__*`; if present, you MUST use it for TypeScript code. Whoever runs this skill **MUST** run the check in [code-tools.md](../../code-tools.md) before any code work and follow its limits. This skill edits no code: use only Serena's tools that read.

## Inputs

- Head branch (default: current branch) and base (default: `main`).
- Title. Conventional Commits with the package scope ([git-workflow.md §2](../../../docs/conventions/git-workflow.md#2-commits)), at most 72 characters. Spanning packages, use the scope where the change starts (usually `contracts`).
- Summary of the problem and the resulting behavior.
- Issue refs, linked spec / plan / ADR paths.
- Verification already run (commands and results), checks not run, judgment calls, remaining risks or follow-ups.
- Optional: `bugfix` or `feature` type, `draft`, `agent-authored` (default `true` when an agent wrote the change), source issue text.
- Optional: `local_ci_preflight` (default `true`). Set `false` only when the user explicitly asks to skip local checks; a caller must pass that instruction through unchanged.

If the title or summary is missing, derive it from `git log origin/main..HEAD` and the diff; ask only if that is impossible.

## Procedure

Create a todo per step.

1. **Preconditions.** The working tree is clean for the intended change; the branch is not `main`; the diff against `origin/main` holds only the scoped work (one concern, about 800 changed lines or fewer excluding lockfiles and migration snapshots, or a reason in the body). Nothing under "Never commit" in [AGENTS.md](../../../AGENTS.md) is in the diff. Push only if the caller authorized it; otherwise ask. If a precondition fails and you can't fix it, stop and report; do not open the PR.

2. **Local CI preflight (default on).** One script is the local gate for the current head:

   ```sh
   bash <main checkout>/.agent/skills/dev-build/scripts/verify.sh <worktree> origin/main
   ```

   It runs `devbox run fix` (which must print `fix: clean.`; it replaces repo-wide `format:check`), then lint and typecheck per touched package, then the tests scoped to the change, and prints `VERIFY: PASS` or `FAIL`. Integration tests run only when the diff touches one or `packages/db`, and need a Docker engine; if none is running, that check is unavailable, not passed. Full suites run in remote CI, which this step never replaces.
   - **Reuse.** A caller that already ran the script on this same head passes its result: reuse it and rerun nothing. Rerun only when the head changed since.
   - If `fix` changed files, commit them and run the script again.
   - Every check must pass. A failing, cancelled or unavailable check blocks the PR: report it and stop, unless the user explicitly bypasses preflight. Never weaken a check to make it pass, and never count remote CI as local evidence.
   - With `local_ci_preflight: false` from the user, skip this step and list the bypass and the checks not run in your report. It never bypasses remote CI or branch protection.

3. **Detect type.** Bug fix if the caller says `bugfix`, or the source issue is a defect (`bug` or `qa:failed` label, issue type `Bug`, repro steps, error text). Otherwise feature. An explicit caller type wins; unclear means feature.

4. **Fill the template.** Copy [pr-template.md](pr-template.md) and replace every `<…>` slot; remove sample rows; scale detail to the change.
   - **Plain language** in Summary, Root cause and Behavior change: write for an owner or PM. Short sentences, everyday words, no meaning lost. Keep file, function, flag and error-text names out (only the "How it is supported" column may name the main module). When a technical term is unavoidable, explain it in a few words. Keep proof (logs, exact errors, commands) out of these sections; report it to the caller.
     - Too technical: "`withOrg` wasn't wrapping `listRuns`, so RLS saw no `app.org_id` and returned rows from every tenant."
     - Plain: "The runs list skipped the step that tells the database which organization is asking, so a user could see other organizations' runs."
   - **Summary:** 2 to 4 sentences: the problem and the resulting behavior.
   - **Root cause:** bug fixes only; delete the section for features. 1 to 3 short sentences per cause (several causes: a short numbered list). State the underlying cause, not the symptom. If it can't be established, say what is unknown.
   - **Behavior change:** one row per business, logic or app behavior that changes: Current (today; for a bug, the faulty behavior), Expected (after merge), and How it is supported (one or two sentences on the mechanism, derived from the diff and tests, not just commit messages). If nothing observable changes (refactor, docs, CI), replace the table with one line saying so.
   - **Linked spec / issue:** the issue lines of step 5, then spec, plan or ADR paths ("None" only for fixes, refactors, deps).
   - **Architecture changes, DB schema changes, API endpoints / contract changes:** include a section only when the diff changes that area; delete it otherwise. Each shows old, new and what changed, as Mermaid (architecture: one flowchart with before/after subgraphs; DB: `erDiagram`; API: diagram or before/after route and shape table). Mark added, removed and changed items distinctly (e.g. `classDef` colors). Derive them from the diff (`packages/db` schema and migrations, `packages/contracts` route table), not from commit messages.
   - **Screenshots:** before / after, or Storybook story names. Delete the section if there's no UI change.

5. **Issue links.** Use `Closes #<n>` for every issue the PR delivers, one per line, deduplicated (`Closes owner/repo#<n>` across repos), so merging closes it. Never a bare `Refs`/`#<n>` for an issue the PR completes ([dev-workflow.md](../../../docs/runbooks/dev-workflow.md)). Use `Refs #<n>` only for an issue that is related but not finished by this PR.

6. **Labels.**
   - `bug` for a bug fix, `enhancement` for a feature.
   - `agent-authored` when an agent wrote the change.
   - `review:sensitive` when the diff touches a [sensitive path](../../../docs/conventions/git-workflow.md#sensitive-paths) or `.github/workflows/`. When in doubt, add it.

7. **Create or update.** Write the body to a file in your scratchpad (never in the repo) and pass it with `--body-file`. Check for an open PR first: `gh pr list --head <branch> --state open --json number,url,isDraft,baseRefName`.
   - None: `gh pr create --base main --head <branch> --title "<title>" --body-file <file> --label …`. Ready for review unless the caller asks for `--draft`.
   - One: update it (`gh pr edit <n> --title … --body-file … --add-label …`); never open a second. Keep its draft/ready state and its existing `Closes`/`Refs` lines unless the caller replaces them; retarget the base if it differs.
   - Several: ask the caller which one.
   - A 403 or "not found" from `gh` or `git push` means the active account can't write here: retry that one command with `GH_TOKEN=$(gh auth token --user <login>) …`. Never run `gh auth switch` or `gh auth setup-git`, and never print the token.

8. **Verify.** Read it back: `gh pr view <n> --json state,isDraft,baseRefName,title,body,labels,url`. It is open, targets the intended base, the title is Conventional Commits, the body has no `<…>` slot or HTML comment left and a `Closes #<n>` line for every issue it delivers, and the labels are set. Fix with `gh pr edit` and recheck; if it still fails, report the failure and no URL. Report the PR URL, draft or ready, labels, the preflight commands with real results (failures included), checks not run, and judgment calls.

Do not approve or merge: only `dev-review` merges, after a clean review and green CI. PRs that change agent rules or CI wait for a human.

## Red flags: stop

- "CI will catch it, skip preflight": preflight runs unless the user explicitly says skip.
- "Docker isn't up, integration tests count as passed": unavailable is not passed. Report it and stop.
- "`format:check` fails, so run `pnpm format`": never repo-wide in a feature PR. `devbox run fix` covers yours.
- "The Summary needs the function name to be precise": names go in "How it is supported" or the report.

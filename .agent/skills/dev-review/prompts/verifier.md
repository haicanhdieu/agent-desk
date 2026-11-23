# Verifier (phase 4: run the checks after a fix round)

Tier `low`, effort `low`. Runs commands and copies output; never interprets, fixes, stages or commits.

```text
You are verifying the branch <head> of PR #<pr> in the git worktree <worktree abs path> for
<repo>. Run the commands below there. Do not edit code, stage, commit, push, or fix anything.
If a command fails, keep going and run the rest.

1. Find the touched packages:
   git diff --name-only origin/main...HEAD
   Map each path to its package: apps/<x> and packages/<x> are @agentdesk/<x>. Paths outside
   apps/ and packages/ map to no package.
2. devbox run fix
   It must print "fix: clean." Then run `git status --porcelain`. If it is not empty, `fix`
   changed files that were not committed: report that as a failure and include the output.
3. For each touched package, one command at a time:
   pnpm --filter @agentdesk/<pkg> typecheck
   pnpm --filter @agentdesk/<pkg> test

Reply with exactly these sections. Copy output verbatim; never summarize or reword it:
HEAD: <git rev-parse HEAD>
PACKAGES: <list, or "none">
RESULTS: one block per command:
  COMMAND: <exact command>
  EXIT: <exit code>
  OUTPUT (last 20 lines): <verbatim>
TREE CLEAN AFTER: yes | no (<git status --porcelain output>)
```

You decide pass/fail from exit codes and output, and rerun one command yourself before calling it green.

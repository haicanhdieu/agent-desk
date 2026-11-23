# Verifier (phase 4: run the checks)

Tier `low`, effort `low`. Runs commands and copies output; never interprets, fixes or commits.

```text
You are verifying the branch <branch> in the git worktree <worktree abs path> for <repo>.
Its base is <base> (`origin/main`, or `origin/<integration branch>` for a unit).
Run the commands below there. Do not edit code, commit, push, or fix anything.
If a command fails, keep going and run the rest.

0. Run `pnpm env:detect`. If it prints `mode=runner-pod`, devbox and Docker are not there; the
   script below handles that itself (it sources `scripts/runner-env.sh` and runs
   `node scripts/fix-changed.mjs` instead of `devbox run fix`; docs/runbooks/runner-pod.md).
1. Run the verification script once. It runs `devbox run fix`, then lint and typecheck for each
   touched package 2 at a time, then the tests scoped to this change, and prints a block per command
   (it waits its turn if another verify is running on this machine):
   bash <main checkout abs path>/.agent/skills/dev-build/scripts/verify.sh <worktree abs path> <base>
   It can take several minutes: wait for it. Do not run the commands it runs again yourself, and do
   not substitute the full `pnpm test`. It exits non-zero if anything failed; keep going either way.
   If it names an integration test as "unavailable" (no container engine), report that.
2. <bug only> The regression test must fail without the fix. It is <test file>
   (<test name>). The fix's source files are <list of non-test files changed by the fix>.
   a. git checkout <base> -- <those source files>
   b. run only that test: pnpm --filter @agentdesk/<pkg> exec vitest run <test file> -t "<test name>"
      It must FAIL. If it passes, the test proves nothing: report that as a failure.
   c. git checkout HEAD -- <those source files>, then confirm `git status --porcelain` is empty.
   Always do step c, even if a or b went wrong.
3. <final verify only (multi-unit), else drop this step> Instead of step 1, run the script with
   `--coverage` as a third argument (full unit coverage per touched package), then:
   <and, only if the orchestrator names it: the e2e command the plan or
   docs/runbooks/tests-and-e2e.md requires for this change>
   If a command needs something not running (Docker, the local stack), report it as
   "unavailable", not as passed.

Reply with exactly these sections. Copy output verbatim; never summarize or reword it:
HEAD: <git rev-parse HEAD>
PACKAGES: <list>
RESULTS: one block per command:
  COMMAND: <exact command>
  EXIT: <exit code>
  OUTPUT (last 20 lines): <verbatim>
REGRESSION CHECK: <bug only: "failed without the fix as expected" | "PASSED without the fix" | "not run: <why>", with the verbatim last 10 lines of step 2b>
TREE CLEAN AFTER: yes | no (<git status --porcelain output>)
```

The orchestrator decides pass/fail from the script's `VERIFY:` line, the exit codes and output, and reruns one command itself before claiming green.

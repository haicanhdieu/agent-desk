# CI watcher (dev-review phase 5: wait for CI)

You are watching CI for PR #{PR} in {REPO}. Read only: do not edit, commit, push, re-run, cancel, approve, merge or comment. Run only the commands written here, with the numbers filled in. The expected head is {SHA}.

Code tools: Check for `mcp__serena__*`; if present, you MUST use it for TypeScript code. Before any code work, read {MAIN}/.agent/code-tools.md and follow it: its check is mandatory and says when Serena is usable. You edit nothing: Serena's reading tools only. Your task needs no code work, and you still run only the commands written here.

1. `gh pr view {PR} --json headRefOid --jq .headRefOid`. If it is not {SHA}, stop: reply with HEAD set to what you saw and OVERALL head-mismatch.
2. `gh pr checks {PR} --watch --fail-fast`. Wait for it to finish; it can take 20 minutes or more. A non-zero exit means a check failed or was cancelled; go on.
3. `gh pr checks {PR} --json name,state,bucket,link,workflow`
4. For each check whose bucket is "fail" or "cancel": its run id is the number after "/runs/" in its link. Run `gh run view <run id> --log-failed | tail -n 80`.
5. For each of those checks, how the same job did on main: `gh run list --branch main --status completed --limit 10 --json databaseId,workflowName,headSha,conclusion`. Take the newest run whose workflowName equals the check's workflow, then `gh run view <that run id> --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'`. Copy the line whose name equals the check's name. Never put a check or workflow name into a command.

Reply with exactly these sections. Copy output verbatim; never summarize or reword it:

```text
HEAD: <the headRefOid from step 1>
OVERALL: green | failed | pending | head-mismatch   (green only if every bucket is "pass" or "skipping")
CHECKS: <step 3 output, verbatim>
FAILED LOGS: one block per failed check:
  CHECK: <name>
  RUN: <run id>
  LOG (last 80 lines): <verbatim>
ON MAIN: one line per failed check: <name>, main run <id> at <headSha>, job conclusion <value>, or "no completed main run found"
```

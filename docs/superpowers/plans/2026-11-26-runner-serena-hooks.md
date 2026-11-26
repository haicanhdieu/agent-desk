# Runner Serena Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `RUNNER_ENABLE_SERENA=1`, the runner pod starts and the agent runs with Serena's four Claude Code hooks.

**Architecture:** `scripts/runner-serena.sh` gets one new step that merges the hooks into `.claude/settings.local.json` with an inline `node` program. Nothing else about the install or the MCP registration changes.

**Tech Stack:** Bash, Node 22 (already in the runner image), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-runner-serena-hooks-design.md`

## Global Constraints

- Never modify `.claude/settings.json`.
- No new dependency.
- Hooks, exactly: `PreToolUse` `""` `remind`; `PreToolUse` `mcp__serena__*` `auto-approve`; `SessionStart` `""` `activate`; `SessionEnd` `""` `cleanup`. Each: `type: "command"`, command `'<abs path>/serena-hooks' <name> --client=claude-code`.
- `<abs path>` is `$(uv tool dir --bin)`, shell single-quoted.
- Follow `AGENTS.md`: `devbox run fix` before a commit (in a runner pod, follow `docs/runbooks/runner-pod.md`).

## Review Focus

1. A broken or non-object `settings.local.json`: setup fails, the file keeps its exact bytes.
2. The user's own hook in the same event or matcher group: it survives every rerun.
3. A home path with a space: the hook command still runs as one program path.
4. An empty or whitespace-only `settings.local.json`: treated as `{}`, so the pod still starts.
5. `serena-hooks` missing after install: setup fails instead of writing hooks that cannot run.

---

### Task 1: Write the hooks from the setup script

**Files:**
- Modify: `scripts/runner-serena.sh` (new step after registration, before `keep .serena/ out of git`; header comment)
- Modify: `docs/runbooks/runner-pod.md` (section 6)
- Test: `scripts/runner-serena.test.ts`

**Interfaces:**
- Produces: step `==> runner-serena: hooks (.claude/settings.local.json)`, writing `<cwd>/.claude/settings.local.json` as 2-space JSON with a trailing newline.

- [ ] **Step 1: Prepare the test fakes**

Add `'node'` and `'mv'` to `SYSTEM_TOOLS`. The fake uv's `tool install` in `buildUvTarball()` must also create an executable `$HOME/.local/bin/serena-hooks`. `preinstalled()` must create the same file.

- [ ] **Step 2: Write the failing tests** in `describe('runner-serena.sh')`

Helpers: `localFile = join(repo, '.claude', 'settings.local.json')`, `settings = () => JSON.parse(readFileSync(localFile, 'utf8'))`, `cmd = (n: string) => `'${join(dir, '.local', 'bin', 'serena-hooks')}' ${n} --client=claude-code``, `group = (matcher: string, n: string) => ({ matcher, hooks: [{ type: 'command', command: cmd(n) }] })`.

```ts
const expected = () => ({
  PreToolUse: [group('', 'remind'), group('mcp__serena__*', 'auto-approve')],
  SessionStart: [group('', 'activate')],
  SessionEnd: [group('', 'cleanup')],
});
```

| Test name | Arrange | Assert |
| --- | --- | --- |
| `writes the four Serena hooks to settings.local.json` | none | status 0; `settings()` equals `{ hooks: expected() }` |
| `never touches settings.json` | write `.claude/settings.json` = `{"enabledPlugins":{}}` | its bytes are unchanged |
| `keeps other settings and hooks, without duplicates on rerun` | file has `model: 'x'`, a `Stop` group, and a `PreToolUse` group with matcher `''` and command `mine` | after two runs: `model` and `Stop` unchanged; `PreToolUse` equals `[mineGroup, ...expected().PreToolUse]` |
| `replaces a hook that points to an old path, keeping its neighbour` | one `PreToolUse` group holds `/old/serena-hooks remind --client=claude-code` and `mine` | `/old/` is gone; `mine` stays; exactly one command contains ` remind --client=claude-code` |
| `treats an empty settings.local.json as {}` | write `'  \n'` | status 0; `{ hooks: expected() }` |
| `fails and leaves the file untouched` (`it.each`: `'{oops'`, `'[]'`, `'{"hooks":[]}'`, `'{"hooks":{"PreToolUse":{}}}'`) | write the text | status not 0; `err` contains `runner-serena:` and `settings.local.json`; bytes unchanged |
| `quotes a hooks path that contains a space` | set `HOME` to `join(dir, 'a home')` (create its `.local/bin`) | status 0; the `remind` command starts with `'` + `join(dir, 'a home', '.local', 'bin', 'serena-hooks')` + `' ` |
| `fails when serena-hooks is missing` | `preinstalled('0.9.28', '2.1.0')`, then remove `serena-hooks` | status not 0; `err` contains `serena-hooks`; `localFile` does not exist |

Add to the existing flag-off test: `expect(existsSync(join(repo, '.claude'))).toBe(false)`.

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --root scripts runner-serena`
Expected: the new tests FAIL (no file written); the old tests PASS.

- [ ] **Step 4: Implement the step in `scripts/runner-serena.sh`**

Check `-x "$(uv tool dir --bin)/serena-hooks"`, else print `runner-serena: serena-hooks not found at <path>` and exit 1. Then run `node - <file> <hooks path> <<'JS'` (paths go in as arguments, never into the program text):
- Missing or whitespace-only file means `{}`. The root and `hooks` must be plain objects, and each of the three events, if present, an array. Otherwise print `runner-serena: .claude/settings.local.json is not valid, left unchanged: <reason>` and exit 1.
- For each wanted hook, first drop old entries in that event whose command contains `serena-hooks` and ends with ` <name> --client=claude-code`. Drop a group only if this emptied it. Then append one group per hook, in the table's order. Leave groups of any other shape as they are.
- Write to a temp file beside the target, then rename it over the target.

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm exec vitest run --root scripts runner-serena && pnpm exec tsc -p scripts && shellcheck scripts/runner-serena.sh`
Expected: all PASS, no output from `shellcheck`.

- [ ] **Step 6: Update runbook section 6**

Add a row for `<repo>/.claude/settings.local.json` to the table. Add bullets: the four hooks and what each does; `remind` denies one call, then waits at least 2 minutes; `auto-approve` has no effect under `bypassPermissions`; Serena calls the hooks alpha; setup never edits `settings.json`; to remove the hooks, delete the `serena-hooks` entries (turning the flag off does not remove them).

- [ ] **Step 7: Commit**

```bash
devbox run fix
git add scripts/runner-serena.sh scripts/runner-serena.test.ts docs/runbooks/runner-pod.md docs/superpowers
git commit -m "feat(scripts): add Serena's Claude Code hooks to runner setup"
```

### Task 2: Prove it in a real pod

Unit tests use fakes, so they cannot show that the hooks work or that the agent uses Serena.

- [ ] **Step 1: Smoke the real hook commands** where Serena 2.1.0 is installed, with a throwaway `SERENA_HOME` from `mktemp -d`

Pipe `{"session_id":"smoke","tool_name":"Bash","tool_input":{"command":"grep -rn foo src"},"permission_mode":"bypassPermissions"}` to each of `remind`, `auto-approve`, `activate` and `cleanup` (`--client=claude-code`).
Expected: every command exits 0. `activate` prints guidance to use Serena. `auto-approve` prints no `allow` decision. Exit 2 from any of them is a stop: Claude Code would block on it.

- [ ] **Step 2: Start one new real run after the change is on the branch the run checks out**

This needs the owner: merging, and starting a run, are their actions.

- [ ] **Step 3: Check that run's pod only**

Expected, all of these:
- the log shows `agentdesk: setup passed`, then `agentdesk: session started`
- `claude mcp list` in the repo shows `serena ... Connected`
- `.claude/settings.local.json` holds the four hooks, and `git status --short .claude` is empty
- the session transcripts show `activate` output at session start, no hook errors, and at least one `tool_use` named `mcp__serena__*`

If there is no Serena call, report that. Do not mark the goal done.

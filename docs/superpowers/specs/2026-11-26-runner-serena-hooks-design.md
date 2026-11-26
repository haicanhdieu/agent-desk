# Serena hooks for Claude Code in the runner pod

**Date:** 2026-11-26. **Size:** small change. **Status:** approved in chat (all four hooks).

## Intent

With Serena turned on, the pod starts, the agent runs, and the agent works with Serena. Today, in a real run, Serena installs, registers and connects, but the main agent and its subagents never load or call a Serena tool. `AGENTS.md` and `.claude/` say nothing about it.

## What changes

When `RUNNER_ENABLE_SERENA=1`, `scripts/runner-serena.sh` also sets up the four hooks from [Serena's Claude Code setup](https://oraios.github.io/serena/02-usage/030_clients.html) in `<repo>/.claude/settings.local.json`:

| Event          | Matcher         | `serena-hooks` command |
| -------------- | --------------- | ---------------------- |
| `PreToolUse`   | `""`            | `remind`               |
| `PreToolUse`   | `mcp__serena__*` | `auto-approve`        |
| `SessionStart` | `""`            | `activate`             |
| `SessionEnd`   | `""`            | `cleanup`              |

Each command ends with `--client=claude-code`.

- `.claude/settings.json` is never modified. `settings.local.json` is already in `.gitignore`.
- The command uses the quoted absolute path of `serena-hooks`, because the agent's `PATH` has no `~/.local/bin`.
- Existing keys and other hooks in the file are kept. A rerun adds no duplicates and replaces an entry that points to an old path.
- A file that is not a JSON object (or has a malformed `hooks` section) stops setup with an error and is left untouched. `Agent call:` this matches the script's current fail-closed behaviour.
- The MCP registration stays as it is. It already matches the page's per-project command, plus `--agent-interface tools` and the absolute path.
- `Agent call:` no `MCP_TIMEOUT`, because the server already connects.
- The runbook section on Serena describes the hooks.

## What to expect

- `remind` denies one tool call after repeated searches or code reads (shell ones included), then stays quiet for at least 2 minutes.
- `auto-approve` acts only in `acceptEdits` or `auto` mode. Runs use `bypassPermissions`, so it has no effect today. It is included to follow the page.
- Serena calls the hooks alpha.
- Hooks apply when Claude Code starts, so setup must run as the project's `SETUP_SCRIPT` (or take effect after a resume).

## Approaches

1. `remind`, `activate`, `cleanup`: leaves out the hook with no effect.
2. **All four (chosen by the owner):** matches Serena's page and keeps working if the permission mode changes.
3. `activate`, `cleanup` only: nothing is blocked, but there are no reminders during the run.

## Not in scope

Changes to `AGENTS.md`, `.claude/settings.json`, skills, the runner image, or turning Serena on by default.

## Access control

No routes, queries, workflows or screens change. No permission or tenant data is touched.

## Needs approval

No new dependency. `serena-hooks` ships with the pinned `serena-agent`, and `node` is already in the runner image. Evidence, checked 2026-11-26 in a runner pod with the pinned `serena-agent` 2.1.0: `serena-hooks` is installed and provides `activate`, `auto-approve`, `cleanup` and `remind`; the hooks have not yet been run with real input.

## Done when

1. `scripts/runner-serena.test.ts` covers: the four hooks written, other settings kept, no duplicates on rerun, stale path replaced, invalid file untouched with a failing exit, `settings.json` unchanged, nothing written when the flag is off.
2. A new real run with Serena on shows: setup passed, the agent session started, no hook errors, and `mcp__serena__*` tool calls in the transcript. Unit tests alone don't prove this. No e2e spec can, because it needs a real model and pod.

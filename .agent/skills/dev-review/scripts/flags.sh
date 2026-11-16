#!/usr/bin/env bash
# Report which gates a PR's diff trips: agent rules / CI (a human merges it) and
# sensitive paths (review:sensitive label, security review at high effort).
#
#   bash flags.sh <worktree>
#
# Reads only `git diff --name-only --no-renames origin/main...HEAD` in <worktree>
# (run `git fetch origin main` first). File names are data: they are matched with
# shell patterns and never evaluated.
#
# The sensitive list is the path-based part of git-workflow.md "Sensitive paths",
# kept wide on purpose ("when in doubt, add it"). Areas named by module rather
# than folder are judged by the Triage agent; the label is set if either says yes.
#
# Prints:
#   AGENT_RULES=yes|no
#   AGENT_RULES_FILES=<space-separated paths>
#   SENSITIVE=yes|no
#   SENSITIVE_FILES=<space-separated paths>
#
# Exit 2 = bad input.
set -euo pipefail

usage() { sed -n '2,22p' "$0" >&2; exit 2; }
[ $# -eq 1 ] || usage
wt=$1
[ -d "$wt" ] && git -C "$wt" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  { echo "not a git worktree: $wt" >&2; exit 2; }
git -C "$wt" rev-parse --verify --quiet origin/main >/dev/null ||
  { echo "origin/main is missing in $wt; fetch it first" >&2; exit 2; }

agent_rules() {
  case "$1" in
    AGENTS.md | */AGENTS.md | CLAUDE.md | */CLAUDE.md) return 0 ;;
    .claude/* | .agent/* | .github/workflows/*) return 0 ;;
    CODEOWNERS | */CODEOWNERS) return 0 ;;
    coverage-thresholds.json | coverage-baseline.json | scripts/coverage-*.ts) return 0 ;;
    vitest.config.* | */vitest.config.* | vite.config.* | */vite.config.*) return 0 ;;
    vitest.workspace.* | */vitest.workspace.*) return 0 ;;
  esac
  return 1
}

sensitive() {
  case "$1" in
    apps/api/src/auth/* | apps/api/src/intake/* | apps/api/src/kube/*) return 0 ;;
    apps/api/src/secrets/* | apps/api/src/terminal/*) return 0 ;;
    packages/core/src/kube/* | packages/core/src/secrets/* | packages/core/src/intake/*) return 0 ;;
    packages/core/src/adapters/* | packages/core/src/redact.ts) return 0 ;;
    packages/db/*) return 0 ;;
    images/runner/* | deploy/*) return 0 ;;
    .sops.yaml | *.sops.yaml | .github/workflows/*) return 0 ;;
  esac
  return 1
}

rules_files="" sens_files=""
while IFS= read -r -d '' f; do
  if agent_rules "$f"; then rules_files+="${rules_files:+ }$f"; fi
  if sensitive "$f"; then sens_files+="${sens_files:+ }$f"; fi
done < <(git -C "$wt" diff -z --name-only --no-renames origin/main...HEAD)

echo "AGENT_RULES=$([ -n "$rules_files" ] && echo yes || echo no)"
echo "AGENT_RULES_FILES=$rules_files"
echo "SENSITIVE=$([ -n "$sens_files" ] && echo yes || echo no)"
echo "SENSITIVE_FILES=$sens_files"

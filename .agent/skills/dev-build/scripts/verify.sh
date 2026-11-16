#!/usr/bin/env bash
# One-shot verification for a branch: fix once, then lint / typecheck / tests per touched
# package. Unit tests are scoped to the change (vitest --changed <base>) so a run costs seconds,
# not the whole suite; remote CI runs everything and is the backstop.
#
#   verify.sh <worktree> <base> [--coverage]
#
# <base> is origin/main (or origin/<integration branch> for a unit). --coverage (final verify
# only) swaps the scoped tests for the full unit coverage run of each touched package.
# Prints one COMMAND / EXIT / OUTPUT block per command and a final VERIFY line; exit 0 only if all pass.
set -u
wt=${1:?worktree}; base=${2:?base}; coverage=${3:-}
cd "$wt" || exit 2
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
fail=0

echo "HEAD: $(git rev-parse HEAD)"
files=$(git diff --name-only "$base"...HEAD)
pkgs=$(printf '%s\n' "$files" | sed -nE 's#^(apps|packages)/([^/]+)/.*#\1/\2#p' | sort -u)
echo "PACKAGES: $(printf '%s\n' "$pkgs" | sed 's#.*/#@agentdesk/#' | tr '\n' ' ')"

# 1. fix: serial, because it may rewrite files. Must print "fix: clean." and leave the tree clean.
devbox run fix >"$out/fix.log" 2>&1; fixrc=$?
grep -q '^fix: clean\.' "$out/fix.log" || fixrc=1
echo "COMMAND: devbox run fix"; echo "EXIT: $fixrc"; echo "OUTPUT (last 20 lines):"; tail -20 "$out/fix.log"
[ "$fixrc" -eq 0 ] || fail=1
dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then echo "FAIL: fix changed files the builder did not commit:"; echo "$dirty"; fail=1; fi

# 2. Integration tests (Docker, slow): only when the diff touches one or the DB package, and then
#    only those the change reaches. Otherwise CI's integration shards run them.
want_int=no
printf '%s\n' "$files" | grep -qE '\.int\.test\.ts$|^packages/db/' && want_int=yes
[ "$coverage" = "--coverage" ] && want_int=no
export TESTCONTAINERS_RYUK_DISABLED=${TESTCONTAINERS_RYUK_DISABLED:-true}
if [ "$want_int" = yes ] && ! docker ps >/dev/null 2>&1; then
  echo "FAIL: integration tests needed but no container engine is running (unavailable, not passed)"
  fail=1; want_int=no
fi

# 3. Build the job lists. Light jobs (lint, typecheck) run in parallel; test jobs then run one at
#    a time: several jsdom/vitest suites at once starve each other of CPU and time out.
light=(); tests=()
for dir in $pkgs; do
  name=@agentdesk/${dir#*/}; id=${dir//\//_}
  light+=("$id.lint|pnpm --filter $name lint" "$id.typecheck|pnpm --filter $name typecheck")
  if [ "$coverage" = "--coverage" ]; then
    tests+=("$id.test|pnpm --filter $name test:unit:coverage")
  elif [ "${dir%%/*}" = "packages" ]; then
    tests+=("$id.test|pnpm --filter $name test:unit") # shared package: full unit suite, no Docker
  else
    tests+=("$id.test|pnpm --filter $name exec vitest run --changed $base --passWithNoTests --exclude **/*.int.test.ts")
  fi
  [ "$want_int" = yes ] && tests+=("$id.testint|pnpm --filter $name exec vitest run --changed $base --passWithNoTests int.test")
done
if printf '%s\n' "$files" | grep -q '^scripts/'; then
  light+=("scripts.typecheck|pnpm typecheck"); tests+=("scripts.test|pnpm test:scripts")
fi

exec_job() { # exec_job "<id>|<command>"  (command is split on spaces; no quoting needed)
  local id=${1%%|*} cmd=${1#*|}
  set -f; $cmd >"$out/$id.log" 2>&1; echo $? >"$out/$id.rc"; set +f
}
for j in "${light[@]}"; do exec_job "$j" & done
wait
for j in "${tests[@]}"; do exec_job "$j"; done

for j in "${light[@]}" "${tests[@]}"; do
  id=${j%%|*}; cmd=${j#*|}; rc=$(cat "$out/$id.rc" 2>/dev/null || echo 1)
  echo "COMMAND: $cmd"; echo "EXIT: $rc"; echo "OUTPUT (last 20 lines):"; tail -20 "$out/$id.log"
  [ "$rc" -eq 0 ] || fail=1
done
echo "TREE CLEAN AFTER: $([ -z "$(git status --porcelain)" ] && echo yes || echo "no ($(git status --porcelain | tr '\n' ';'))")"
echo "VERIFY: $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail

#!/usr/bin/env bash
# Set up (or reuse) the worktree for a PR, rebase it on fresh origin/main, and
# install deps. Run it again later in the same run when main moves.
#
#   bash start.sh <pr-number> <head-branch>
#
# <head-branch> comes from the PR, so it is untrusted: it is validated here and
# always quoted. It must already be on origin, and it may not be main.
#
# Reuses a worktree that already has the branch checked out (dev-build's, or one a
# blocked dev-review run left) only if it is clean and not mid-rebase. Otherwise
# creates <root>-wt/pr-<pr>. A local branch that has diverged from origin is
# refused. It never pushes, resets, stashes or deletes anything.
#
# Prints, on the last lines:
#   WORKTREE=<abs path>
#   BRANCH=<head-branch>
#   MODE=new|reused
#   REBASE=clean|up-to-date|conflicts
#   CONFLICTS=<space-separated paths>      (conflicts only)
#   HEAD=<sha>
#   PUSH_NEEDED=yes|no                      (local HEAD differs from origin/<branch>)
#   then the lines of flags.sh               (not on conflicts)
#
# Run it from the main checkout. Exit 2 = bad input, 3 = refused (dirty, diverged,
# owned elsewhere), 4 = rebase stopped on conflicts: the worktree is left
# mid-rebase for the Conflict resolver.
set -euo pipefail

usage() { sed -n '2,28p' "$0" >&2; exit 2; }
[ $# -eq 2 ] || usage
pr=$1 branch=$2
[[ $pr =~ ^[0-9]+$ ]] || { echo "PR number must be digits: $pr" >&2; exit 2; }
[[ $branch =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && $branch != *..* && $branch != */ ]] ||
  { echo "unsafe branch name: $branch" >&2; exit 2; }
git check-ref-format --branch "$branch" >/dev/null 2>&1 ||
  { echo "invalid branch name: $branch" >&2; exit 2; }
[[ $branch != main && $branch != master ]] || { echo "refusing to work on $branch" >&2; exit 2; }

here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel)

git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 ||
  { echo "branch is not on origin: $branch" >&2; exit 3; }
git fetch origin main "$branch"
remote=$(git rev-parse "origin/$branch")

# Is <local sha> safe to use against origin? equal / ahead are fine, behind is
# fast-forwarded later, diverged is refused.
relation() {
  local l=$1
  if [ "$l" = "$remote" ]; then echo equal
  elif git merge-base --is-ancestor "$remote" "$l"; then echo ahead
  elif git merge-base --is-ancestor "$l" "$remote"; then echo behind
  else echo diverged; fi
}

# Find a worktree that has the branch checked out.
wt=""
cur=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) cur=${line#worktree } ;;
    "branch refs/heads/$branch") wt=$cur ;;
  esac
done < <(git worktree list --porcelain)

if [ -n "$wt" ]; then
  mode=reused
  for d in rebase-merge rebase-apply; do
    [ ! -e "$(git -C "$wt" rev-parse --git-path "$d")" ] ||
      { echo "worktree $wt is mid-rebase; not touching it" >&2; exit 3; }
  done
  [ -z "$(git -C "$wt" status --porcelain)" ] ||
    { echo "worktree $wt has uncommitted changes; not touching it" >&2; exit 3; }
else
  mode=new
  wt="$root-wt/pr-$pr"
  [ ! -e "$wt" ] || { echo "path exists but does not hold $branch: $wt" >&2; exit 3; }
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    [ "$(relation "$(git rev-parse "$branch")")" != diverged ] ||
      { echo "local $branch has diverged from origin/$branch; not touching it" >&2; exit 3; }
    git worktree add "$wt" "$branch"
  else
    git worktree add --track -b "$branch" "$wt" "origin/$branch"
  fi
fi

case "$(relation "$(git -C "$wt" rev-parse HEAD)")" in
  diverged) echo "local $branch has diverged from origin/$branch; not touching it" >&2; exit 3 ;;
  behind) git -C "$wt" merge --ff-only "origin/$branch" ;;
esac

if git -C "$wt" merge-base --is-ancestor origin/main HEAD; then
  rebase=up-to-date
elif git -C "$wt" rebase origin/main; then
  rebase=clean
else
  [ -e "$(git -C "$wt" rev-parse --git-path rebase-merge)" ] ||
    [ -e "$(git -C "$wt" rev-parse --git-path rebase-apply)" ] ||
    { echo "rebase failed without stopping on conflicts" >&2; exit 1; }
  conflicts=$(git -C "$wt" diff --name-only --diff-filter=U | tr '\n' ' ')
  echo "WORKTREE=$wt"
  echo "BRANCH=$branch"
  echo "MODE=$mode"
  echo "REBASE=conflicts"
  echo "CONFLICTS=${conflicts% }"
  exit 4
fi

cd "$wt"
if command -v devbox >/dev/null 2>&1; then
  devbox run -- pnpm install
else
  pnpm install
fi

head=$(git -C "$wt" rev-parse HEAD)
echo "WORKTREE=$wt"
echo "BRANCH=$branch"
echo "MODE=$mode"
echo "REBASE=$rebase"
echo "HEAD=$head"
echo "PUSH_NEEDED=$([ "$head" = "$remote" ] && echo no || echo yes)"
bash "$here/flags.sh" "$wt"

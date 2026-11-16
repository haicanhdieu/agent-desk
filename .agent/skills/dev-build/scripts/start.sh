#!/usr/bin/env bash
# Create (or, after a block, reopen) the worktree for a ticket and install deps.
#
#   bash start.sh <issue-number> <fix|feat> <slug>     new run: branch from fresh origin/main
#   bash start.sh <issue-number> --resume <branch>     continue a run that blocked
#
# <slug> is 1-4 lowercase words joined by "-" (letters and digits only). It is
# derived from untrusted issue text, so it is validated here and never passed
# through a shell unquoted. <branch> in resume mode must be (fix|feat)/<n>-<slug>
# and must already exist on origin.
#
# New run: refuses an existing branch or worktree (someone else owns it).
# Resume: reuses the pushed branch. The caller (SKILL.md step 1) has already
# checked that dev-build itself blocked this ticket and no PR is open.
# The branch is NOT rebased; BEHIND says how far main has moved (dev-review
# rebases and resolves conflicts).
#
# Prints, on the last lines:
#   BRANCH=<type>/<n>-<slug>
#   WORKTREE=<abs path>
#   MODE=new|resume
#   BEHIND=<commits on origin/main the branch lacks>   (resume only)
#   AHEAD=<commits the branch has on top of origin/main>   (resume only)
#
# Run it from the main checkout. Exit 2 = bad input, 3 = refused (owned/diverged).
set -euo pipefail

usage() { sed -n '2,26p' "$0" >&2; exit 2; }
[ $# -ge 2 ] || usage
n=$1
[[ $n =~ ^[0-9]+$ ]] || { echo "issue number must be digits: $n" >&2; exit 2; }

root=$(git rev-parse --show-toplevel)
wt="$root-wt/$n"

install_deps() {
  cd "$wt"
  if command -v devbox >/dev/null 2>&1; then
    devbox run -- pnpm install
  else
    pnpm install
  fi
}

if [ "$2" = "--resume" ]; then
  [ $# -eq 3 ] || usage
  branch=$3
  [[ $branch =~ ^(fix|feat)/$n-[a-z0-9]+(-[a-z0-9]+){0,3}$ ]] ||
    { echo "branch must be (fix|feat)/$n-<slug>: $branch" >&2; exit 2; }

  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 ||
    { echo "branch is not on origin, nothing to resume: $branch" >&2; exit 3; }
  git fetch origin main "$branch"
  remote=$(git rev-parse "origin/$branch")

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    local_sha=$(git rev-parse "$branch")
    if [ "$local_sha" != "$remote" ] && ! git merge-base --is-ancestor "$remote" "$local_sha"; then
      echo "local $branch has diverged from origin/$branch; not touching it" >&2
      exit 3
    fi
  fi

  if [ -e "$wt" ]; then
    # Reuse only our own clean worktree on this exact branch.
    [ "$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || true)" = "$branch" ] &&
      [ -z "$(git -C "$wt" status --porcelain)" ] ||
      { echo "worktree $wt exists but is not a clean checkout of $branch" >&2; exit 3; }
  elif git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$wt" "$branch" ||
      { echo "$branch is checked out in another worktree" >&2; exit 3; }
  else
    git worktree add --track -b "$branch" "$wt" "origin/$branch"
  fi

  behind=$(git rev-list --count "$branch..origin/main")
  ahead=$(git rev-list --count "origin/main..$branch")
  install_deps
  echo "BRANCH=$branch"
  echo "WORKTREE=$wt"
  echo "MODE=resume"
  echo "BEHIND=$behind"
  echo "AHEAD=$ahead"
  exit 0
fi

[ $# -eq 3 ] || usage
type=$2 slug=$3
[[ $type == fix || $type == feat ]] || { echo "type must be fix or feat: $type" >&2; exit 2; }
[[ $slug =~ ^[a-z0-9]+(-[a-z0-9]+){0,3}$ ]] || { echo "slug must be 1-4 kebab-case words: $slug" >&2; exit 2; }

branch="$type/$n-$slug"

if git show-ref --verify --quiet "refs/heads/$branch" ||
  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  echo "branch already exists: $branch (use --resume only if dev-build blocked this ticket)" >&2
  exit 3
fi
[ ! -e "$wt" ] || { echo "worktree path already exists: $wt" >&2; exit 3; }

git fetch origin main
git worktree add -b "$branch" "$wt" origin/main

install_deps
echo "BRANCH=$branch"
echo "WORKTREE=$wt"
echo "MODE=new"

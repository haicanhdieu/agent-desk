#!/usr/bin/env bash
# Create (or, after a block, reopen) the worktree for a ticket and install deps.
#
#   bash start.sh <n> <fix|feat> <slug>                  new run: branch from fresh origin/main
#   bash start.sh <n> <fix|feat> <slug> --integration    same, then push it (multi-unit integration branch)
#   bash start.sh <n> --unit <id> --base <integration>   unit branch <integration>--u<id> from fresh origin/<integration>
#   bash start.sh <n> --resume <branch>                  continue a run that blocked (integration, single or unit branch)
#
# <slug> is 1-4 lowercase words joined by "-" (letters and digits only). It is
# derived from untrusted issue text, so it is validated here and never passed
# through a shell unquoted. <id> is 1-8 lowercase letters or digits. A unit
# branch is <integration>--u<id>: "--" never occurs in a slug, so a unit branch
# can't be mistaken for a slug word, and it does not nest under the integration
# name (git refuses "a" and "a/b" side by side). <integration> must be
# (fix|feat)/<n>-<slug> and on origin. <branch> in resume mode is
# (fix|feat)/<n>-<slug> or (fix|feat)/<n>-<slug>--u<id> and must be on origin.
#
# New run, integration or unit: refuses an existing branch or worktree (someone
# else owns it). Resume: reuses the pushed branch. The caller (SKILL.md step 1)
# has already checked that dev-build itself blocked this ticket. The branch is
# NOT rebased; BEHIND says how far its base has moved.
#
# Worktrees: <root>-wt/<n> for a single or integration branch, <root>-wt/<n>-u<id>
# for a unit.
#
# Prints, on the last lines:
#   BRANCH=<branch>
#   WORKTREE=<abs path>
#   MODE=new|integration|unit|resume
#   BASE=<origin/main or origin/<integration>>
#   BEHIND=<commits on BASE the branch lacks>   (resume only)
#   AHEAD=<commits the branch has on top of BASE>   (resume only)
#
# Run it from the main checkout. Exit 2 = bad input, 3 = refused (owned/diverged).
set -euo pipefail

usage() { sed -n '2,34p' "$0" >&2; exit 2; }
[ $# -ge 2 ] || usage
n=$1
[[ $n =~ ^[0-9]+$ ]] || { echo "issue number must be digits: $n" >&2; exit 2; }

root=$(git rev-parse --show-toplevel)
slug_re='[a-z0-9]+(-[a-z0-9]+){0,3}'
id_re='[a-z0-9]{1,8}'

install_deps() {
  cd "$wt"
  if command -v devbox >/dev/null 2>&1; then
    devbox run -- pnpm install
  else
    pnpm install
  fi
}

refuse_existing() { # $1 branch, $2 worktree path
  if git show-ref --verify --quiet "refs/heads/$1" ||
    git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; then
    echo "branch already exists: $1 (use --resume only if dev-build blocked this ticket)" >&2
    exit 3
  fi
  [ ! -e "$2" ] || { echo "worktree path already exists: $2" >&2; exit 3; }
}

if [ "$2" = "--resume" ]; then
  [ $# -eq 3 ] || usage
  branch=$3
  if [[ $branch =~ ^((fix|feat)/$n-$slug_re)--u($id_re)$ ]]; then
    base_branch=${BASH_REMATCH[1]}
    wt="$root-wt/$n-u${BASH_REMATCH[4]}"
  elif [[ $branch =~ ^(fix|feat)/$n-$slug_re$ ]]; then
    base_branch=main
    wt="$root-wt/$n"
  else
    echo "branch must be (fix|feat)/$n-<slug> or (fix|feat)/$n-<slug>--u<id>: $branch" >&2
    exit 2
  fi

  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 ||
    { echo "branch is not on origin, nothing to resume: $branch" >&2; exit 3; }
  git ls-remote --exit-code --heads origin "$base_branch" >/dev/null 2>&1 ||
    { echo "base branch is not on origin: $base_branch" >&2; exit 3; }
  git fetch origin main "$base_branch" "$branch"
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

  behind=$(git rev-list --count "$branch..origin/$base_branch")
  ahead=$(git rev-list --count "origin/$base_branch..$branch")
  install_deps
  echo "BRANCH=$branch"
  echo "WORKTREE=$wt"
  echo "MODE=resume"
  echo "BASE=origin/$base_branch"
  echo "BEHIND=$behind"
  echo "AHEAD=$ahead"
  exit 0
fi

if [ "$2" = "--unit" ]; then
  [ $# -eq 5 ] && [ "$4" = "--base" ] || usage
  id=$3 base_branch=$5
  [[ $id =~ ^$id_re$ ]] || { echo "unit id must be 1-8 lowercase letters or digits: $id" >&2; exit 2; }
  [[ $base_branch =~ ^(fix|feat)/$n-$slug_re$ ]] ||
    { echo "base must be the integration branch (fix|feat)/$n-<slug>: $base_branch" >&2; exit 2; }
  git ls-remote --exit-code --heads origin "$base_branch" >/dev/null 2>&1 ||
    { echo "integration branch is not on origin: $base_branch" >&2; exit 3; }

  branch="$base_branch--u$id"
  wt="$root-wt/$n-u$id"
  refuse_existing "$branch" "$wt"

  git fetch origin "$base_branch"
  git worktree add --no-track -b "$branch" "$wt" "origin/$base_branch"

  install_deps
  echo "BRANCH=$branch"
  echo "WORKTREE=$wt"
  echo "MODE=unit"
  echo "BASE=origin/$base_branch"
  exit 0
fi

[ $# -eq 3 ] || { [ $# -eq 4 ] && [ "$4" = "--integration" ]; } || usage
type=$2 slug=$3 integration=${4:-}
[[ $type == fix || $type == feat ]] || { echo "type must be fix or feat: $type" >&2; exit 2; }
[[ $slug =~ ^$slug_re$ ]] || { echo "slug must be 1-4 kebab-case words: $slug" >&2; exit 2; }

branch="$type/$n-$slug"
wt="$root-wt/$n"
refuse_existing "$branch" "$wt"

git fetch origin main
git worktree add -b "$branch" "$wt" origin/main

mode=new
if [ -n "$integration" ]; then
  # The integration branch goes up before any unit starts, so a resume can find it.
  git -C "$wt" push -u origin "$branch"
  mode=integration
fi

install_deps
echo "BRANCH=$branch"
echo "WORKTREE=$wt"
echo "MODE=$mode"
echo "BASE=origin/main"

#!/usr/bin/env bash
# Move an issue to a board column and keep its status:* label in sync.
#
#   bash board.sh status <issue-number> "<Status>"
#   bash board.sh get    <issue-number>
#
# <Status> is one of: Backlog, Ready, In progress, Blocked, In review, QA, Done.
# The board Status field is the source of truth; the status:* label mirrors it
# so `gh issue list --label status:ready` works. Backlog and Done carry no label.
#
# Env (all optional):
#   BOARD_OWNER   project owner login     (default: owner of the current repo)
#   BOARD_NUMBER  project number          (default: 4)
#   GH_TOKEN      token for an account with write access to the repo and project
set -euo pipefail

usage() { sed -n '2,13p' "$0" >&2; exit 2; }
[ $# -ge 2 ] || usage
cmd=$1 issue=$2

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
owner=${BOARD_OWNER:-${repo%%/*}}
number=${BOARD_NUMBER:-4}

label_for() {
  case "$1" in
    Ready) echo status:ready ;;
    "In progress") echo status:in-progress ;;
    Blocked) echo status:blocked ;;
    "In review") echo status:in-review ;;
    QA) echo status:qa ;;
    Backlog | Done) echo "" ;;
    *) echo "unknown status: $1" >&2; exit 2 ;;
  esac
}

url="https://github.com/$repo/issues/$issue"

if [ "$cmd" = get ]; then
  gh project item-list "$number" --owner "$owner" --format json --limit 500 \
    --jq ".items[] | select(.content.url == \"$url\") | .status // \"(none)\""
  exit 0
fi

[ "$cmd" = status ] && [ $# -eq 3 ] || usage
status=$3
want_label=$(label_for "$status")

project_id=$(gh project view "$number" --owner "$owner" --format json --jq .id)
field_json=$(gh project field-list "$number" --owner "$owner" --format json \
  --jq '.fields[] | select(.name == "Status")')
field_id=$(jq -r .id <<<"$field_json")
option_id=$(jq -r --arg s "$status" '.options[] | select(.name == $s) | .id' <<<"$field_json")
[ -n "$option_id" ] || { echo "board has no Status option '$status'" >&2; exit 1; }

# item-add is idempotent: it returns the existing item if the issue is already on the board.
item_id=$(gh project item-add "$number" --owner "$owner" --url "$url" --format json --jq .id)
gh project item-edit --id "$item_id" --project-id "$project_id" \
  --field-id "$field_id" --single-select-option-id "$option_id" >/dev/null

# Swap status:* labels.
current=$(gh issue view "$issue" --json labels --jq '.labels[].name | select(startswith("status:"))')
for l in $current; do
  [ "$l" = "$want_label" ] || gh issue edit "$issue" --remove-label "$l" >/dev/null
done
if [ -n "$want_label" ] && ! grep -qx "$want_label" <<<"$current"; then
  gh issue edit "$issue" --add-label "$want_label" >/dev/null
fi

echo "#$issue -> $status${want_label:+ ($want_label)}"

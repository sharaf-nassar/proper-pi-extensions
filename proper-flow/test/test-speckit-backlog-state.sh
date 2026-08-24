#!/usr/bin/env bash
# Verifies Speckit treats deferred P4 issues as backlog, not ready work.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FORMULA="$ROOT/formulas/speckit.formula.toml"

require() {
  grep -Fq -- "$1" "$FORMULA" || {
    printf 'FAIL: formula missing %s\n' "$2" >&2
    exit 1
  }
}

require 'version = 11' 'source-scope formula version'
require '[vars.source_scope]' 'source scope variable'
require '`explicit`, do not add unselected cards' 'explicit source isolation'
require 'stored status is `open` or `deferred`' \
  'open-or-deferred backlog discovery'
require '--status=open,deferred --priority=4' \
  'open-or-deferred final backlog invariant'
require '--defer="" --status=open' 'refinement reactivation'
require '`promote-epic`' 'P4 target-epic disposition'
require 'bd update EPIC -p <P0-P3> --defer="" --status=open' \
  'epic promotion without type conversion'

count=$(grep -Fc 'stored status is `open` or `deferred`' "$FORMULA")
[[ "$count" -eq 2 ]] || {
  printf 'FAIL: expected two backlog discovery passes, found %s\n' "$count" >&2
  exit 1
}

T=$(mktemp -d /tmp/speckit-backlog-state.XXXXXX)
trap 'rm -rf "$T"' EXIT

git init -q -b main "$T"
(
  cd "$T"
  bd init --non-interactive --skip-hooks --skip-agents \
    --prefix backlogtest --quiet
)

id=$(bd -C "$T" create "Deferred backlog check" --type=chore -p 4 \
  --status=deferred --silent)
epic=$(bd -C "$T" create "Deferred epic check" --type=epic -p 4 \
  --status=deferred --silent)
ready=$(bd -C "$T" ready --json)
ledger=$(bd -C "$T" list --status=open,deferred --priority=4 --json --limit=0)

jq -e --arg id "$id" 'all(.[]; .id != $id)' <<<"$ready" >/dev/null
jq -e --arg id "$id" \
  'any(.[]; .id == $id and .status == "deferred")' \
  <<<"$ledger" >/dev/null

bd -C "$T" update "$id" -p 2 --defer="" --status=open >/dev/null
bd -C "$T" update "$epic" -p 1 --defer="" --status=open >/dev/null
refined=$(bd -C "$T" show "$id" --json)
promoted=$(bd -C "$T" show "$epic" --json)

jq -e '.[0].status == "open" and .[0].priority == 2' \
  <<<"$refined" >/dev/null
jq -e '.[0].status == "open" and .[0].priority == 1 and
  .[0].issue_type == "epic"' <<<"$promoted" >/dev/null

printf 'ok: deferred P4 backlog refines and epic promotion preserves type\n'

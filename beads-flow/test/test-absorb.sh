#!/usr/bin/env bash
# Exercises clean, blocked, staged, and verify absorb states.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RAIL="$ROOT/rail/implement-ready.sh"
T=$(mktemp -d /tmp/rail-absorb.XXXXXX)
trap 'rm -rf "$T"' EXIT

git init -q -b main "$T/repo"
git -C "$T/repo" config user.email t@t
git -C "$T/repo" config user.name T
mkdir -p "$T/repo/.beads"
printf '{}\n' >"$T/repo/.beads/interactions.jsonl"
printf 'base\n' >"$T/repo/other.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm seed

[[ "$("$RAIL" absorb --repo "$T/repo" | jq -r .status)" == clean ]] || {
  printf 'FAIL: clean repo did not report clean\n' >&2; exit 1;
}

printf '{"event":1}\n' >>"$T/repo/.beads/interactions.jsonl"
printf 'staged\n' >>"$T/repo/other.txt"
git -C "$T/repo" add other.txt
set +e
OUT=$("$RAIL" absorb --repo "$T/repo")
RC=$?
set -e
[[ $RC -eq 8 && "$(jq -r .status <<<"$OUT")" == blocked ]] || {
  printf 'FAIL: staged index did not block absorb\n' >&2; exit 1;
}
printf 'ok: staged index blocks absorb\n'

git -C "$T/repo" reset -q HEAD -- other.txt
git -C "$T/repo" checkout -q -- other.txt
OUT=$("$RAIL" absorb --repo "$T/repo")
[[ "$(jq -r .status <<<"$OUT")" == staged ]] || {
  printf 'FAIL: dirty audit log was not staged\n' >&2; exit 1;
}
[[ "$(git -C "$T/repo" diff --cached --name-only)" == .beads/interactions.jsonl ]] || {
  printf 'FAIL: absorb staged unexpected paths\n' >&2; exit 1;
}
printf 'ok: absorb stages only tracked .beads JSONL\n'

git -C "$T/repo" commit -qm audit
[[ "$("$RAIL" absorb --repo "$T/repo" --verify | jq -r .status)" == verified-clean ]] || {
  printf 'FAIL: verify did not report clean\n' >&2; exit 1;
}
printf 'ok: absorb verify confirms clean state\n'

printf '\nabsorb: all cases passed\n'

#!/usr/bin/env bash
# Exercises cmd_prepare's advanced and rewritten-main rebase modes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RAIL="$ROOT/rail/implement-ready.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok: %s\n' "$*"; }

setup_repo() {
  local root="$1"
  git init -q -b main "$root/repo"
  git -C "$root/repo" config user.email t@t
  git -C "$root/repo" config user.name T
  printf 'seed\n' >"$root/repo/seed.txt"
  git -C "$root/repo" add -A
  git -C "$root/repo" commit -qm seed
}

setup_run() {
  local root="$1" task="$2" branch="$3" worktree="$4" base="$5"
  mkdir -p "$root/run/tasks" "$root/run/attempts" "$root/run/integrations"
  jq -cn --arg repo "$root/repo" \
    '{repo:$repo,scope:"all",main_branch:"main",run_id:"r",actor:"a",lock_token:"tok"}' \
    >"$root/run/manifest.json"
  jq -cn --arg task "$task" --arg worktree "$worktree" --arg branch "$branch" --arg base "$base" \
    '{task_id:$task,worktree:$worktree,branch:$branch,base_sha:$base,files:[]}' \
    >"$root/run/tasks/$task.json"
}

record_worker() {
  local root="$1" task="$2" sha="$3"
  "$RAIL" result --run-dir "$root/run" --task "$task" --attempt 1 \
    --json "$(jq -cn --arg task "$task" --arg sha "$sha" \
      '{task_id:$task,attempt:1,status:"done",commit_sha:$sha,checks:["test"],summary:"done"}')" \
    >/dev/null
  "$RAIL" verify-worker --run-dir "$root/run" --task "$task" --attempt 1 >/dev/null
}

# Main advanced normally: cmd_prepare uses plain rebase.
T=$(mktemp -d /tmp/rail-rebase-advanced.XXXXXX)
setup_repo "$T"
BASE=$(git -C "$T/repo" rev-parse HEAD)
BRANCH=wt/r/advanced
git -C "$T/repo" worktree add -q -b "$BRANCH" "$T/wt" "$BASE"
printf 'work\n' >"$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
printf 'sibling\n' >"$T/repo/sibling.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm sibling
setup_run "$T" advanced "$BRANCH" "$T/wt" "$BASE"
record_worker "$T" advanced "$(git -C "$T/wt" rev-parse HEAD)"
OUT=$("$RAIL" prepare --run-dir "$T/run" --task advanced --attempt 1)
[[ "$(jq -r '.rebase_mode' <<<"$OUT")" == advanced ]] || fail "advanced main chose wrong mode"
[[ -f "$T/wt/feature.txt" && -f "$T/wt/sibling.txt" ]] || fail "advanced rebase lost content"
pass "prepare uses plain rebase when main still contains the worker base"
rm -rf "$T"

# Main rewritten by amend: cmd_prepare replays only task commits with --onto.
T=$(mktemp -d /tmp/rail-rebase-rewritten.XXXXXX)
setup_repo "$T"
printf 'mistake\n' >"$T/repo/oops.txt"
printf 'legit\n' >"$T/repo/keeper.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm base
BASE=$(git -C "$T/repo" rev-parse HEAD)
BRANCH=wt/r/rewritten
git -C "$T/repo" worktree add -q -b "$BRANCH" "$T/wt" "$BASE"
printf 'work\n' >"$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
git -C "$T/repo" rm -q oops.txt
git -C "$T/repo" commit -q --amend -m "base amended"
setup_run "$T" rewritten "$BRANCH" "$T/wt" "$BASE"
record_worker "$T" rewritten "$(git -C "$T/wt" rev-parse HEAD)"
OUT=$("$RAIL" prepare --run-dir "$T/run" --task rewritten --attempt 1)
[[ "$(jq -r '.rebase_mode' <<<"$OUT")" == rewritten ]] || fail "rewritten main chose wrong mode"
[[ ! -e "$T/wt/oops.txt" && -f "$T/wt/feature.txt" ]] || fail "rewritten rebase resurrected old content or lost task work"
pass "prepare uses --onto after main rewrite without resurrecting amended-away files"
rm -rf "$T"

printf '\nall rail rebase-mode cases passed\n'

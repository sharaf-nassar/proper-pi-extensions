#!/usr/bin/env bash
# Exercises rail recovery after integration-gate and rebase failures.
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
  local root="$1" task="$2" attempt="$3" sha="$4"
  "$RAIL" result --run-dir "$root/run" --task "$task" --attempt "$attempt" \
    --json "$(jq -cn --arg task "$task" --arg sha "$sha" --argjson attempt "$attempt" \
      '{task_id:$task,attempt:$attempt,status:"done",commit_sha:$sha,checks:["test"],summary:"done"}')" \
    >/dev/null
  "$RAIL" verify-worker --run-dir "$root/run" --task "$task" --attempt "$attempt" >/dev/null
}

# Gate failure: retain the lock, accept a fix-forward commit, and prepare again.
T=$(mktemp -d /tmp/rail-gate-recovery.XXXXXX)
setup_repo "$T"
BASE=$(git -C "$T/repo" rev-parse HEAD)
BRANCH=wt/r/t-1
git -C "$T/repo" worktree add -q -b "$BRANCH" "$T/wt" "$BASE"
printf 'broken\n' >"$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
setup_run "$T" t-1 "$BRANCH" "$T/wt" "$BASE"
record_worker "$T" t-1 1 "$(git -C "$T/wt" rev-parse HEAD)"
"$RAIL" prepare --run-dir "$T/run" --task t-1 --attempt 1 >/dev/null
git -C "$T/repo" commit -qm 'task squash'
set +e
"$RAIL" verify-integration --run-dir "$T/run" --task t-1 --gates false >/dev/null 2>&1
RC=$?
set -e
[[ $RC -eq 10 ]] || fail "integration gate should exit 10, got $RC"
printf 'fixed\n' >"$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm fix
record_worker "$T" t-1 2 "$(git -C "$T/wt" rev-parse HEAD)"
"$RAIL" prepare --run-dir "$T/run" --task t-1 --attempt 2 >/dev/null
git -C "$T/repo" commit -qm 'fix forward'
"$RAIL" verify-integration --run-dir "$T/run" --task t-1 --gates true >/dev/null
[[ -s "$T/run/integrations/t-1.attempt-1.failed.json" ]] || fail "failed prepare was not archived"
pass "gate failure permits a same-task fix-forward prepare"
rm -rf "$T"

# Rebase conflict: abort recovery must restore the task worktree before unlock.
T=$(mktemp -d /tmp/rail-rebase-recovery.XXXXXX)
setup_repo "$T"
printf 'base\n' >"$T/repo/conflict.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm base
BASE=$(git -C "$T/repo" rev-parse HEAD)
BRANCH=wt/r/t-2
git -C "$T/repo" worktree add -q -b "$BRANCH" "$T/wt" "$BASE"
printf 'task\n' >"$T/wt/conflict.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
printf 'main\n' >"$T/repo/conflict.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm main
setup_run "$T" t-2 "$BRANCH" "$T/wt" "$BASE"
record_worker "$T" t-2 1 "$(git -C "$T/wt" rev-parse HEAD)"
set +e
"$RAIL" prepare --run-dir "$T/run" --task t-2 --attempt 1 >/dev/null 2>&1
RC=$?
set -e
[[ $RC -eq 5 ]] || fail "rebase conflict should exit 5, got $RC"
"$RAIL" unlock --run-dir "$T/run" --task t-2 --abort >/dev/null
[[ -z "$(git -C "$T/wt" status --porcelain)" ]] || fail "abort left task worktree dirty"
[[ ! -d "$(git -C "$T/wt" rev-parse --git-path rebase-merge)" ]] || fail "abort left rebase in progress"
pass "unlock --abort clears a conflicted task rebase"
rm -rf "$T"

printf '\nintegration recovery: all cases passed\n'

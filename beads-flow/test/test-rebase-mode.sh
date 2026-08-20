#!/usr/bin/env bash
#
# Regression test for cmd_prepare's rebase-mode selection.
#
# The integration branch can be REWRITTEN (not just advanced) while a worker
# runs, because the primary checkout amends main routinely. When that happens
# the recorded base_sha is orphaned, and a plain `git rebase $pre_head` replays
# the stale base commit along with the task commit — resurrecting pre-amend
# content. `git rebase --onto $pre_head $base` replays only the task's own
# commits.
#
# The staged/branch tree-equality check in cmd_prepare CANNOT catch this: both
# trees contain the resurrected content, so the squash verifies and lands.
#
# Run: bash test-rebase-mode.sh   (exits nonzero on regression)

set -euo pipefail

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok: %s\n' "$*"; }

setup() { # $1 = scratch root; prints BASE and NEW main sha via globals
  T="$1"
  git init -q "$T/repo"
  git -C "$T/repo" config user.email t@t
  git -C "$T/repo" config user.name T
  printf 'seed\n' > "$T/repo/seed.txt"
  git -C "$T/repo" add -A
  git -C "$T/repo" commit -qm seed
}

# --- case 1: amend REMOVES a file the base commit added (silent resurrection)
T=$(mktemp -d /tmp/rail-rebase-c1.XXXXXX)
setup "$T"
printf 'mistake\n' > "$T/repo/oops.txt"
printf 'legit\n' > "$T/repo/keeper.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm A
BASE=$(git -C "$T/repo" rev-parse HEAD)
git -C "$T/repo" worktree add -q -b wt/t "$T/wt" "$BASE"
printf 'work\n' > "$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
git -C "$T/repo" rm -q "$T/repo/oops.txt"
git -C "$T/repo" commit -q --amend -m "A amended"
NEW=$(git -C "$T/repo" rev-parse HEAD)

git -C "$T/repo" merge-base --is-ancestor "$BASE" "$NEW" &&
  fail "case 1 setup: base should NOT be an ancestor after amend"
pass "case 1: rewrite detected (base is not an ancestor of main)"

git -C "$T/wt" rebase --onto "$NEW" "$BASE" >/dev/null 2>&1 ||
  fail "case 1: rebase --onto reported a conflict it should not have"
git -C "$T/wt" ls-files --error-unmatch oops.txt >/dev/null 2>&1 &&
  fail "case 1: REGRESSION — amended-away file resurrected by --onto"
[[ -f "$T/wt/feature.txt" ]] || fail "case 1: task work lost"
pass "case 1: amended-away file stayed removed, task work preserved"
rm -rf "$T"

# --- case 2: main merely ADVANCED — plain rebase must still be chosen and work
T=$(mktemp -d /tmp/rail-rebase-c2.XXXXXX)
setup "$T"
BASE=$(git -C "$T/repo" rev-parse HEAD)
git -C "$T/repo" worktree add -q -b wt/t "$T/wt" "$BASE"
printf 'work\n' > "$T/wt/feature.txt"
git -C "$T/wt" add -A
git -C "$T/wt" commit -qm task
printf 'sibling\n' > "$T/repo/sibling.txt"
git -C "$T/repo" add -A
git -C "$T/repo" commit -qm sibling
NEW=$(git -C "$T/repo" rev-parse HEAD)

git -C "$T/repo" merge-base --is-ancestor "$BASE" "$NEW" ||
  fail "case 2 setup: base should still be an ancestor after a normal commit"
git -C "$T/wt" rebase "$NEW" >/dev/null 2>&1 ||
  fail "case 2: plain rebase failed on an advanced main"
[[ -f "$T/wt/sibling.txt" && -f "$T/wt/feature.txt" ]] ||
  fail "case 2: advanced-main content or task work missing after rebase"
git -C "$T/wt" merge-base --is-ancestor "$NEW" HEAD ||
  fail "case 2: rebased branch does not descend from main tip"
pass "case 2: advanced path replays cleanly and descends from main tip"
rm -rf "$T"

printf '\nall rebase-mode cases passed\n'

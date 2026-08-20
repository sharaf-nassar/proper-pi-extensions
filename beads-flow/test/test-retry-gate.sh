#!/usr/bin/env bash
# Drives cmd_retry_gate through a hand-built run dir (no bd/git needed).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RAIL="$ROOT/rail/implement-ready.sh"
T=$(mktemp -d /tmp/retrygate.XXXXXX)
mkdir -p "$T/tasks" "$T/attempts/t-1" "$T/integrations"
cat > "$T/manifest.json" <<'EOF'
{"repo":"/tmp","scope":"all","main_branch":"main","run_id":"r","actor":"a","lock_token":"tok"}
EOF

result() { # attempt, status, signature
  mkdir -p "$T/attempts/t-1/$1"
  printf '{"status":"%s","task_id":"t-1","commit_sha":"","checks":[],"failure":"f","error_signature":"%s"}\n' \
    "$2" "$3" > "$T/attempts/t-1/$1/result.json"
}
run() { bash "$RAIL" retry-gate --run-dir "$T" --task t-1 --attempt "$1" 2>/dev/null; }
chk() { # name, attempt, want_allowed
  local out allowed
  out=$(run "$2"); allowed=$(jq -r '.allowed' <<<"$out" 2>/dev/null || echo "ERR")
  if [[ "$allowed" == "$3" ]]; then
    printf 'ok: %-46s (%s)\n' "$1" "$(jq -r '.reason' <<<"$out")"
  else
    printf 'FAIL: %s -> allowed=%s want %s\n%s\n' "$1" "$allowed" "$3" "$out"; exit 1
  fi
}

chk "attempt 1 always allowed" 1 true

result 1 failed "SIG-A"
chk "attempt 2 after failure, no prior to compare" 2 true

result 2 failed "SIG-A"
chk "attempt 3, signature UNCHANGED -> deny" 3 false

result 2 failed "SIG-B"
chk "attempt 3, signature CHANGED -> allow" 3 true

result 3 failed "SIG-C"
chk "attempt 4 exceeds ceiling -> deny" 4 false

result 1 done "" ; rm -rf "$T/attempts/t-1/2"
chk "retry after a DONE attempt -> deny" 2 false

rm -rf "$T/attempts/t-1"/*
chk "no recorded prior result -> deny" 2 false

# --- soft ceiling: cumulative across runs, overridable ---
runx() { bash "$RAIL" retry-gate --run-dir "$T" --task t-1 "$@" 2>/dev/null; }
chkx() { # name, want_allowed, args...
  local name="$1" want="$2"; shift 2
  local out allowed; out=$(runx "$@"); allowed=$(jq -r '.allowed' <<<"$out" 2>/dev/null || echo ERR)
  if [[ "$allowed" == "$want" ]]; then
    printf 'ok: %-46s (%s)\n' "$name" "$(jq -r '.denial' <<<"$out")"
  else printf 'FAIL: %s -> allowed=%s want %s\n%s\n' "$name" "$allowed" "$want" "$out"; exit 1; fi
}

rm -rf "$T/attempts/t-1"/*
result 1 failed "SIG-A"
chkx "prior-run attempts count toward ceiling" false --attempt 2 --prior-attempts 3
chkx "ceiling overridable with a stated reason" true --attempt 2 --prior-attempts 3 \
  --override-ceiling "root cause finally identified; different fix"

# The hard gate must NOT be bypassable by the soft override.
result 2 failed "SIG-A"
chkx "override cannot bypass repeated signature" false --attempt 3 --prior-attempts 5 \
  --override-ceiling "I really want to"

# exit code contract: 7 = hard (evidence), 9 = soft (budget)
bash "$RAIL" retry-gate --run-dir "$T" --task t-1 --attempt 3 >/dev/null 2>&1
[[ $? -eq 7 ]] && printf 'ok: repeated signature exits 7 (hard)\n' ||
  { printf 'FAIL: wrong exit code for hard denial\n'; exit 1; }

rm -rf "$T/attempts/t-1"/*
result 1 failed "SIG-A"
bash "$RAIL" retry-gate --run-dir "$T" --task t-1 --attempt 2 --prior-attempts 3 >/dev/null 2>&1
[[ $? -eq 9 ]] && printf 'ok: soft ceiling exits 9 (budget)\n' ||
  { printf 'FAIL: wrong exit code for soft denial\n'; exit 1; }

rm -rf "$T"
printf '\nretry gate: all cases passed\n'

#!/usr/bin/env bash
# Exercises the real survey command against crafted bd JSON.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RAIL="$ROOT/rail/implement-ready.sh"
T=$(mktemp -d /tmp/rail-survey.XXXXXX)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/run/tasks" "$T/run/attempts" "$T/run/integrations" "$T/repo"

cat >"$T/ready.json" <<'EOF'
[
 {"id":"a-1","title":"has both","priority":2,"issue_type":"task",
  "acceptance_criteria":"tests pass","description":"Why: x\nWhat: y\nFiles: src/a.rs, src/b.rs"},
 {"id":"a-2","title":"acceptance omitted entirely","priority":1,"issue_type":"bug",
  "description":"Why: x\nFiles: src/c.rs"},
 {"id":"a-3","title":"acceptance blank","priority":2,"issue_type":"task",
  "acceptance_criteria":"   \n  ","description":"Why: x"},
 {"id":"a-4","title":"no Files line","priority":3,"issue_type":"task",
  "acceptance_criteria":"builds","description":"Why: x\nWhat: y"},
 {"id":"a-5","title":"files unknown","priority":2,"issue_type":"bug",
  "acceptance_criteria":"repro passes","description":"Files: unknown — root cause is in a generated file"},
 {"id":"a-6","title":"backlog","priority":4,"issue_type":"task",
  "acceptance_criteria":"whatever","description":"Files: src/z.rs"},
 {"id":"a-7","title":"lowercase files key","priority":2,"issue_type":"task",
  "acceptance_criteria":"ok","description":"files: src/d.rs"},
 {"id":"a-8","title":"legacy description acceptance","priority":1,"issue_type":"bug",
  "description":"Root cause: x\n## Acceptance criteria\n- regression test passes\n- original repro passes"},
 {"id":"a-9","title":"blank legacy acceptance","priority":2,"issue_type":"task",
  "description":"## Acceptance criteria\n\n## Notes\nNo criteria yet"}
]
EOF
printf '[{"id":"b-1"}]\n' >"$T/blocked.json"

cat >"$T/bin/bd" <<'EOF'
#!/usr/bin/env bash
args=("$@")
while (($#)); do
  case "$1" in
    ready) cat "$READY_FILE"; exit ;;
    blocked) cat "$BLOCKED_FILE"; exit ;;
    show) jq --arg id "${2:-}" '[.[] | select(.id == $id)]' "$READY_FILE"; exit ;;
  esac
  shift
done
printf 'fake bd: unsupported args: %s\n' "${args[*]}" >&2
exit 2
EOF
chmod 700 "$T/bin/bd"

jq -cn --arg repo "$T/repo" \
  '{repo:$repo,scope:"all",main_branch:"main",run_id:"r",actor:"a",lock_token:"tok"}' \
  >"$T/run/manifest.json"

OUT=$(PATH="$T/bin:$PATH" READY_FILE="$T/ready.json" BLOCKED_FILE="$T/blocked.json" \
  "$RAIL" survey --run-dir "$T/run")

chk() { # name, jq expr, expected
  local got; got=$(jq -r "$2" <<<"$OUT")
  if [[ "$got" == "$3" ]]; then printf 'ok: %s\n' "$1"
  else printf 'FAIL: %s -> got %s want %s\n' "$1" "$got" "$3"; exit 1; fi
}

chk "a-2 (acceptance key omitted) excluded"  '[.ready[].id] | index("a-2") // "none"' none
chk "a-3 (whitespace acceptance) excluded"   '[.ready[].id] | index("a-3") // "none"' none
chk "legacy description acceptance included" '[.ready[].id] | index("a-8") // "none"' 4
chk "blank legacy acceptance excluded"       '[.ready[].id] | index("a-9") // "none"' none
chk "unacceptable lists missing and blank"   '[.unacceptable[].id] | join(",")' "a-2,a-3,a-9"
chk "ready keeps the rest"                   '[.ready[].id] | join(",")' "a-1,a-4,a-5,a-7,a-8"
chk "P4 excluded even with acceptance"       '[.p4_excluded[].id] | join(",")' "a-6"
chk "ready count"                            '.counts.ready' 5
chk "unacceptable count"                     '.counts.unacceptable' 3

files() {
  PATH="$T/bin:$PATH" READY_FILE="$T/ready.json" BLOCKED_FILE="$T/blocked.json" \
    "$RAIL" overlap --run-dir "$T/run" --task "$1" | jq -r '.declared | join("|")'
}
[[ "$(files a-1)" == "src/a.rs|src/b.rs" ]] || { printf 'FAIL: multi-file parse\n'; exit 1; }
[[ -z "$(files a-4)" ]] || { printf 'FAIL: no Files line should be empty\n'; exit 1; }
[[ -z "$(files a-5)" ]] || { printf 'FAIL: unknown Files should be empty\n'; exit 1; }
[[ "$(files a-7)" == "src/d.rs" ]] || { printf 'FAIL: lowercase files key\n'; exit 1; }
printf 'ok: overlap parses declared Files from live beads\n'

printf '\nsurvey and overlap filters: all cases passed\n'

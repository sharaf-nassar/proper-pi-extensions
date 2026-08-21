#!/usr/bin/env bash
# Replays the A2/A3 ownership omission against the Speckit formula contract.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FORMULA="$ROOT/formulas/speckit.formula.toml"
T="$(mktemp -d /tmp/speckit-coverage.XXXXXX)"
trap 'rm -rf "$T"' EXIT

require() {
  grep -Fq -- "$1" "$FORMULA" || {
    printf 'FAIL: formula missing %s\n' "$2" >&2
    exit 1
  }
}

require 'version = 7' 'coverage-gate formula version'
require '## Source Authority' 'visual source authority inventory'
require '## Normative Visual Coverage' 'row-level normative coverage map'
require 'The coverage check and approval' 'quick/full coverage requirement'
require 'MUST be NO-GO' 'analyze rejection for missing owners'
require 'STOP before the first Beads mutation' 'create-beads no-mutation preflight'
require 'normative coverage totals as fully-owned/total' 'squash coverage totals'
require 'specs/026-beads-flow-view.md' 'A2/A3 regression spec evidence'
require '.impeccable/mocks/beads-board-directions.html' 'normative mock evidence'
require 'Flow-only 17-task plan' 'original materialization evidence'
require 'A2 Collapsed, hover drawer, pinned, or' 'omitted A2 state evidence'

preflight_line=$(grep -nF '**0. Run the no-mutation normative coverage preflight.**' "$FORMULA" | cut -d: -f1)
epic_line=$(grep -nF '**1. Establish the feature epic.**' "$FORMULA" | cut -d: -f1)
[[ -n "$preflight_line" && -n "$epic_line" && "$preflight_line" -lt "$epic_line" ]] || {
  printf 'FAIL: normative preflight does not precede epic mutation\n' >&2
  exit 1
}
printf 'ok: formula gates normative coverage before bead mutation\n'

coverage_gate() {
  awk -F '\t' '
    NR == 1 { next }
    $4 == "" || $5 == "" { missing = 1 }
    END { exit missing ? 1 : 0 }
  ' "$1"
}

cat >"$T/original.tsv" <<'EOF'
row	artifact state	requirement	implementation owner	verification owner
A2-S1	A2 Collapsed — real state	collapsed lanes
A2-S2	A2 Hovering the Blocked tab	non-reflowing drawer
A2-S3	A2 Blocked pinned	pinned lane
A2-S4	A2 Dragging a card	drag and collapsed targets
A3-S1	A3 Flow opened issue	Flow rendering	Render Flow	Verify Flow
EOF

if coverage_gate "$T/original.tsv"; then
  printf 'FAIL: Flow-only replay accepted unowned A2 rows\n' >&2
  exit 1
fi
printf 'ok: specs/026 plus normative mock replay rejects unowned A2 rows\n'

awk -F '\t' 'BEGIN { OFS = FS } NR == 1 { print; next } {
  if ($4 == "") $4 = "Implement " $1
  if ($5 == "") $5 = "Verify " $1
  print
}' "$T/original.tsv" >"$T/complete.tsv"

coverage_gate "$T/complete.tsv" || {
  printf 'FAIL: complete A2/A3 ownership map was rejected\n' >&2
  exit 1
}
printf 'ok: complete A2/A3 implementation and verification ownership passes\n'

printf '\nspeckit normative coverage: all cases passed (no bd invocation)\n'

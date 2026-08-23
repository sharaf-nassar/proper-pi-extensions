#!/usr/bin/env bash
# Verifies Speckit's generic normative-coverage contract before Beads mutation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FORMULA="$ROOT/formulas/speckit.formula.toml"

require() {
  grep -Fq -- "$1" "$FORMULA" || {
    printf 'FAIL: formula missing %s\n' "$2" >&2
    exit 1
  }
}

require 'version = 10' 'coverage-gate formula version'
require '## Source Authority' 'visual source authority inventory'
require '## Normative Visual Coverage' 'row-level normative coverage map'
require 'Each row needs both an implementation owner and a' 'two-owner plan contract'
require 'The coverage check and approval' 'quick/full coverage requirement'
require 'MUST be NO-GO' 'analyze rejection for missing owners'
require 'Every owner must name a real Sequencing work item' 'materialized owner contract'
require 'If the four counts differ' 'count equality gate'
require 'STOP before the first Beads mutation' 'create-beads no-mutation preflight'
require 'normative coverage totals as fully-owned/total' 'squash coverage totals'

preflight_line=$(grep -nF '**0. Run the no-mutation normative coverage preflight.**' "$FORMULA" | cut -d: -f1)
epic_line=$(grep -nF '**1. Establish the feature epic.**' "$FORMULA" | cut -d: -f1)
[[ -n "$preflight_line" && -n "$epic_line" && "$preflight_line" -lt "$epic_line" ]] || {
  printf 'FAIL: normative preflight does not precede epic mutation\n' >&2
  exit 1
}

printf 'ok: generic normative ownership gates precede Beads mutation\n'
printf '\nspeckit normative coverage contract passed (no bd invocation)\n'

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
while IFS= read -r name; do
  unset "$name"
done < <(git rev-parse --local-env-vars)

for test in "$ROOT"/test/test-*.sh; do
  printf '\n== %s ==\n' "$(basename "$test")"
  bash "$test"
done

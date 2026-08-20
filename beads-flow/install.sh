#!/usr/bin/env bash
# Link the repository-owned Beads workflow files into the user registry.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BEADS_HOME="$HOME/.beads"
FORMULAS=(constitution speckit)

fail() {
  printf 'beads-flow: %s\n' "$*" >&2
  exit 1
}

link_file() {
  local source="$1" destination="$2" resolved=""
  [[ -f "$source" ]] || fail "source file missing: $source"
  mkdir -p "$(dirname "$destination")"

  if [[ -L "$destination" ]]; then
    resolved="$(readlink -f "$destination" 2>/dev/null || true)"
    [[ "$resolved" == "$source" ]] && return
    rm "$destination"
  elif [[ -e "$destination" ]]; then
    cmp -s "$source" "$destination" ||
      fail "refusing to replace different file: $destination"
    rm "$destination"
  fi

  ln -s "$source" "$destination"
}

check_link() {
  local source="$1" destination="$2" resolved
  [[ -L "$destination" ]] || fail "expected symlink: $destination"
  resolved="$(readlink -f "$destination" 2>/dev/null || true)"
  [[ "$resolved" == "$source" ]] ||
    fail "$destination points to ${resolved:-nowhere}, expected $source"
}

check_no_hooks() {
  local directory="$BEADS_HOME/no-hooks"
  [[ -d "$directory" && ! -L "$directory" ]] ||
    fail "no-hooks must be a real directory: $directory"
  [[ -z "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
    fail "no-hooks must remain empty: $directory"
}

check_formulas() {
  local scratch output name destination source
  command -v bd >/dev/null 2>&1 || fail "required tool not found: bd"
  command -v jq >/dev/null 2>&1 || fail "required tool not found: jq"
  scratch="$(mktemp -d /tmp/beads-flow-check.XXXXXX)"
  trap 'rm -rf "$scratch"' RETURN

  for name in "${FORMULAS[@]}"; do
    destination="$BEADS_HOME/formulas/$name.formula.toml"
    output="$(cd "$scratch" && bd formula show "$name" --json)"
    source="$(jq -er '.source' <<<"$output")"
    [[ "$source" == "$destination" ]] ||
      fail "$name resolves from $source, expected $destination"
  done

  rm -rf "$scratch"
  trap - RETURN
}

check_all() {
  local name
  for name in "${FORMULAS[@]}"; do
    check_link \
      "$ROOT/formulas/$name.formula.toml" \
      "$BEADS_HOME/formulas/$name.formula.toml"
  done
  check_link \
    "$ROOT/rail/implement-ready.sh" \
    "$BEADS_HOME/rail/implement-ready.sh"
  [[ -x "$ROOT/rail/implement-ready.sh" ]] ||
    fail "rail is not executable: $ROOT/rail/implement-ready.sh"
  check_no_hooks
  check_formulas
  printf 'beads-flow: links and formula resolution are current\n'
}

link_all() {
  local name
  mkdir -p "$BEADS_HOME/formulas" "$BEADS_HOME/rail"
  if [[ -e "$BEADS_HOME/no-hooks" || -L "$BEADS_HOME/no-hooks" ]]; then
    [[ -d "$BEADS_HOME/no-hooks" && ! -L "$BEADS_HOME/no-hooks" ]] ||
      fail "refusing to replace no-hooks: $BEADS_HOME/no-hooks"
  else
    mkdir -m 700 "$BEADS_HOME/no-hooks"
  fi
  check_no_hooks

  for name in "${FORMULAS[@]}"; do
    link_file \
      "$ROOT/formulas/$name.formula.toml" \
      "$BEADS_HOME/formulas/$name.formula.toml"
  done
  link_file \
    "$ROOT/rail/implement-ready.sh" \
    "$BEADS_HOME/rail/implement-ready.sh"
  check_all
}

case "${1:-}" in
  link) link_all ;;
  check) check_all ;;
  *)
    printf 'Usage: %s link|check\n' "$0" >&2
    exit 2
    ;;
esac

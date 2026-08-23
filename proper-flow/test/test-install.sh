#!/usr/bin/env bash
# Exercises link installation and drift detection in an isolated home.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d /tmp/proper-flow-install.XXXXXX)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home"

# A legacy beads-flow install leaves symlinks into a checkout path that no
# longer exists; link must redirect them instead of failing.
mkdir -p "$T/home/.beads/rail"
ln -s /old-checkout/beads-flow/rail/implement-ready.sh \
  "$T/home/.beads/rail/implement-ready.sh"

HOME="$T/home" "$ROOT/install.sh" link >/dev/null
HOME="$T/home" "$ROOT/install.sh" check >/dev/null

for path in \
  formulas/constitution.formula.toml \
  formulas/speckit.formula.toml \
  rail/implement-ready.sh; do
  [[ -L "$T/home/.beads/$path" ]] || {
    printf 'FAIL: expected symlink: %s\n' "$path" >&2
    exit 1
  }
done
[[ -d "$T/home/.beads/no-hooks" && ! -L "$T/home/.beads/no-hooks" ]] || {
  printf 'FAIL: no-hooks is not a real directory\n' >&2
  exit 1
}
printf 'ok: link installs managed files and a real no-hooks directory\n'

[[ "$(readlink "$T/home/.beads/rail/implement-ready.sh")" == "$ROOT/rail/implement-ready.sh" ]] || {
  printf 'FAIL: legacy beads-flow link was not redirected\n' >&2
  exit 1
}
printf 'ok: link redirects dangling legacy beads-flow symlinks\n'

rm "$T/home/.beads/formulas/speckit.formula.toml"
printf 'local override\n' >"$T/home/.beads/formulas/speckit.formula.toml"
if HOME="$T/home" "$ROOT/install.sh" link >/dev/null 2>&1; then
  printf 'FAIL: link replaced a different regular file\n' >&2
  exit 1
fi
printf 'ok: link refuses to replace different user files\n'

rm "$T/home/.beads/formulas/speckit.formula.toml"
ln -s "$ROOT/formulas/speckit.formula.toml" \
  "$T/home/.beads/formulas/speckit.formula.toml"
rm "$T/home/.beads/rail/implement-ready.sh"
if HOME="$T/home" "$ROOT/install.sh" check >/dev/null 2>&1; then
  printf 'FAIL: check accepted a missing managed link\n' >&2
  exit 1
fi
printf 'ok: check detects missing managed links\n'

printf '\ninstaller: all cases passed\n'

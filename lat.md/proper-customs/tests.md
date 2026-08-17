# Verification

The package uses 51 `node:test` cases to verify history behavior, editor interception, autocomplete rendering and lifecycle, fullscreen key routing, footer styling, and real filesystem storage.

## History fixtures

History tests cover message extraction, text-part concatenation, trimming, malformed entries, timestamps, and skill-wrapper removal.

They also verify newest-first session selection, live-session exclusion, cross-source timestamp interleaving, newest-timestamp deduplication, stable ties, live-prompt exclusion, entry caps, and repeated editor-factory unwrapping.

## Recorder fixtures

Recorder tests exercise pi's actual assignment shape through a class-field-style fake editor.

They cover handlers assigned before and after installation, per-instance property interception, recording before downstream delivery, later handler reassignment, repeated installation, and clearing a handler without resurrecting stale behavior.

## Autocomplete fixture

A `session_start` integration fixture installs proper-customs around a fake editor and verifies selected autocomplete descriptions use a non-capturing overlay above the prompt.

The rendering fixture proves the editor returns the same lines and height, the overlay accounts for footer rows, boxed text stays within terminal width, and visibility ends with the selected description.

A focused lifecycle fixture proves missing descriptions release the overlay immediately and unmounted editors release it after pi's current visibility pass. This guards the overlay-stack condition that otherwise prevents regular/fullscreen TUI mode changes.

## Fullscreen keybinding fixture

A session integration fixture applies the real Pi 0.84.2 `KeybindingsManager` to the installed editor factory.

It verifies fullscreen transcript actions claim Shift+Home, Shift+End, Shift+PageUp, and Shift+PageDown instead of the unmodified keys; the editor retains its native unmodified bindings; legacy escape sequences match the intended actions; a native keybinding reload reapplies the overrides without losing unrelated user values; and repeated installation is idempotent.

## Footer fixture

A session integration fixture mounts a class-shaped built-in footer and verifies decoration preserves visible text while coloring the model purple and every effort level through its own semantic token.

The same fixture verifies max and ultra emit per-character rainbow truecolor, start redraw requests, and clear the shared timer through footer disposal. It also marks the outgoing context stale after `session_shutdown` and verifies the restored built-in footer renders without accessing it.

## Store fixtures

Store tests use temporary directories and real Node filesystem operations.

They verify project-key encoding, path selection, round trips, whitespace and length limits, multiline JSONL, private file permissions, fail-open writes, missing and damaged data, bounded tail reads, compaction thresholds, newest-entry retention, and repeated multi-session appends.

## Coverage boundary

The suite does not instantiate pi or pi-tui's real interactive editor. The autocomplete, fullscreen-keybinding, and footer fixtures run the extension's complete `session_start` callback against minimal fake API and component trees.

Package discovery, real terminal modifier reporting, real terminal color fidelity, selection key handling, session listing failures, replacement footers, built-in modal selectors, and interaction with later-loaded extensions remain startup or manual integration checks. Pure history and storage modules cover the ordering and persistence rules that carry the highest regression risk.

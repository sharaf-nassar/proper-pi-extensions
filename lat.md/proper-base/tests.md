# Verification

The package uses 56 `node:test` cases across history, editor, image preview, fullscreen, cancellation, footer, and filesystem behavior.

## History fixtures

History tests cover message extraction, text-part concatenation, trimming, malformed entries, timestamps, and skill-wrapper removal.

They also verify newest-first session selection, live-session exclusion, cross-source timestamp interleaving, newest-timestamp deduplication, stable ties, live-prompt exclusion, entry caps, and repeated editor-factory unwrapping.

## Clipboard image fixture

A session integration fixture verifies clipboard image preview and submission expansion.

It starts with text-only capabilities, loads proper-base under `TERM_PROGRAM=Scribe`, and verifies the extension factory enables Kitty before a fullscreen renderer captures capabilities. A real one-pixel PNG then becomes `[image 1]` in a bottom-left overlay at the normal editor-relative margin. Deleting one marker character removes the whole image, a second paste creates `[image 2]`, and submission expands it back to the original path.

## Recorder fixtures

Recorder tests exercise pi's actual assignment shape through a class-field-style fake editor.

They cover handlers assigned before and after installation, per-instance property interception, recording before downstream delivery, later handler reassignment, repeated installation, and clearing a handler without resurrecting stale behavior.

## Autocomplete fixture

A `session_start` integration fixture installs proper-base around a fake editor and verifies selected autocomplete descriptions use a non-capturing overlay above the prompt.

The rendering fixture proves the editor returns the same lines and height, the overlay accounts for footer rows, boxed text stays within terminal width, and visibility ends with the selected description.

A focused lifecycle fixture proves missing descriptions release the overlay immediately and unmounted editors release it after pi's current visibility pass. This guards the overlay-stack condition that otherwise prevents regular/fullscreen TUI mode changes.

A model-completion fixture verifies the empty `/model ` list sorts descending, `opu` removes unrelated candidates and sorts Opus versions descending, `opus 4` requires both terms, non-model suggestions preserve provider order, and both Enter and Tab accept and submit the selected `provider/model` value.

## Fullscreen keybinding fixture

A session integration fixture applies the real Pi 0.84.2 `KeybindingsManager` to the installed editor factory.

It verifies fullscreen transcript actions claim Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown instead of unmodified or Shift-only keys; the editor retains its native unmodified bindings; and modern modifier sequences match the intended actions. The same fixture verifies End moves from a middle-line cursor to that line's end, then to the full prompt end, where another press is a no-op. It also seeds the manager with the legacy boolean marker and a stale Shift-only reload closure, then proves current installation upgrades that wrapper, native reload reapplies Ctrl+Shift without losing unrelated user values, repeated installation remains idempotent, and the terminal writer stays untouched for Pi's native mouse handling.

## Footer fixture

A session integration fixture mounts a class-shaped built-in footer and verifies cumulative usage through cost moves to the right of the path row, context remains on the second row, and the model stays right-aligned and purple.

The same fixture verifies max and ultra emit per-character rainbow truecolor, start redraw requests, and clear the shared timer through footer disposal. It also marks the outgoing context stale after `session_shutdown` and verifies the restored built-in footer renders without accessing it.

## Early cancellation fixture

A session integration fixture verifies editable recovery of an unprocessed cancelled prompt.

It submits through the wrapped editor, captures the accepted user entry, and presses Esc before assistant processing. The prompt returns immediately, settlement schedules the internal command, a hidden anchor makes a leaf user entry navigable, and tree navigation abandons the cancelled turn. Further phases cover pre-input routing cancellation, processed-turn retention, and delegation of queued streaming prompts to Pi's native restoration.

## Questionnaire cancellation fixture

A fixture drives the registered `tool_result` handler with synthetic tool results and records whether `ctx.abort()` was called.

It verifies a dismissed questionnaire aborts, while an answered one, a failure envelope carrying `error`, a missing `details` object, and another tool's cancelled result all run on.

## Store fixtures

Store tests use temporary directories and real Node filesystem operations.

They verify project-key encoding, path selection, round trips, whitespace and length limits, multiline JSONL, private file permissions, fail-open writes, missing and damaged data, bounded tail reads, compaction thresholds, newest-entry retention, and repeated multi-session appends.

## Coverage boundary

The suite does not instantiate pi or pi-tui's real interactive editor.

The autocomplete, early-cancellation, fullscreen-keybinding, and footer fixtures run the extension's complete `session_start` callback against minimal fake API and component trees, and the questionnaire fixture calls its registered `tool_result` handler directly.

Package discovery, real terminal modifier reporting, real terminal color fidelity, selection key handling, session listing failures, replacement footers, built-in modal selectors, and interaction with later-loaded extensions remain startup or manual integration checks. Pure history and storage modules cover the ordering and persistence rules that carry the highest regression risk.

# Verification

The package uses 58 `node:test` cases across history, editor, image markers, fullscreen, cancellation, footer, and filesystem behavior.

## History fixtures

History tests cover message extraction, text-part concatenation, trimming, malformed entries, timestamps, and skill-wrapper removal.

They also verify newest-first session selection, live-session exclusion, cross-source timestamp interleaving, newest-timestamp deduplication, stable ties, live-prompt exclusion, entry caps, and repeated editor-factory unwrapping.

One case pins the recallable-submission rule: plain text, a prompt template with a task, and a skill command are recallable, while `/model <provider>/<id>`, `/new`, `/reload`, and an extension command are not.

## Clipboard image fixture

A session integration fixture verifies text-only image markers remain usable downstream.

It starts with text-only capabilities, loads proper-base under `TERM_PROGRAM=Scribe`, and verifies capabilities remain unchanged. A real one-pixel PNG becomes `[image 1]`; a non-capturing overlay shows the marker and source path without Kitty escapes; submission expands the marker so Pi's downstream handler receives the original path.

## Recorder fixtures

Recorder tests exercise pi's actual assignment shape through a class-field-style fake editor.

They cover handlers assigned before and after installation, per-instance property interception, recording before downstream delivery, later handler reassignment, repeated installation, and clearing a handler without resurrecting stale behavior.

## Autocomplete fixture

A `session_start` integration fixture installs proper-base around a fake editor and verifies selected autocomplete descriptions use a non-capturing overlay above the prompt.

The rendering fixture proves the editor returns the same lines and height, the overlay accounts for footer rows, description text uses the selected-item accent instead of muted styling, boxed text stays within terminal width, and visibility ends with the selected description.

A focused lifecycle fixture proves missing descriptions release the overlay immediately and unmounted editors release it after pi's current visibility pass. This guards the overlay-stack condition that otherwise prevents regular/fullscreen TUI mode changes.

An inline-command fixture verifies slash completion receives only the active command segment after whitespace or on a later line, replaces only that segment, supports command arguments, and ignores URL or path-internal slashes. A model-completion fixture verifies the empty `/model ` list sorts descending, `opu` removes unrelated candidates and sorts Opus versions descending, `opus 4` requires both terms, non-model suggestions preserve provider order, and both Enter and Tab accept and submit the selected `provider/model` value.

## Base keybinding fixture

A session integration fixture applies the real Pi 0.84.2 `KeybindingsManager` to the installed editor factory.

It verifies Ctrl+V and Ctrl+Shift+V both match Pi's clipboard paste action without removing an existing Alt+V alias. Shift+Enter and Alt+Enter both match prompt newline while other newline aliases survive, and Alt+Enter no longer matches follow-up queueing. Fullscreen transcript actions claim Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown instead of unmodified or Shift-only keys; the editor retains its native unmodified bindings; and modern modifier sequences match the intended actions. The same fixture verifies Home first reaches a soft-wrapped visible-row start and then the full prompt start, including across a hard newline, while End reaches the logical line end and then the full prompt end. It also proves native reload reapplies current bindings without losing unrelated user values, repeated installation remains idempotent, and the terminal writer stays untouched for Pi's native mouse handling.

## Footer fixture

A session integration fixture verifies the rearranged footer keeps its model, effort, and usage rows inside a safe terminal width.

The same fixture verifies distinct colors for path, branch, input, output, cache read/write/hit, cost, context, model, and effort; context changes at warning and danger thresholds; a narrow row retains `xhigh`; max and ultra animate; and shutdown restores the native footer without stale context access.

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

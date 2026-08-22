# Verification

The package uses 75 `node:test` cases across session naming, model-preserving clearing, history, prompt display, editor, image markers, model context, transcript cleanup, fullscreen, cancellation, footer, and filesystem behavior.

## Session-title fixture

A session integration fixture verifies first-response naming without a second model request.

It proves a fresh unnamed branch receives the title instruction, the streamed metadata marker stays hidden, terminal control characters are removed before `pi.setSessionName()`, and later turns stop receiving the instruction. Separate phases keep naming armed after an aborted response, stop after completed output omits metadata, and prove explicit names or branches with prior assistant output are never renamed.

## Model-preserving clear fixture

A command fixture verifies `/clear` replaces the session before restoring the outgoing provider and model.

It proves the command passes no copied session state into `ctx.newSession()`, uses the replacement context to dispatch only the encoded internal restore command, resolves the exact provider/model pair in the new registry, and selects it through the replacement extension instance. Malformed restore data reports an error, and an absent outgoing model keeps native `/new` behavior.

## History fixtures

History tests cover timestamp ordering, newest-timestamp deduplication, stable ties, entry caps, repeated editor-factory unwrapping, and the recallable-submission rule.

The recall filter keeps plain text, prompt templates, and skills while excluding `/model <provider>/<id>`, `/new`, `/reload`, and extension commands. A guard fixture proves arbitrary session-replay text is rejected unless the recorder explicitly admits it.

A session integration fixture seeds a raw `/skill:unslop` invocation from the store, attempts to replay its expanded `<skill>` body, and verifies only the raw command enters history. It then submits another skill invocation and proves the recorder adds that exact slash command immediately.

## Reverse history search fixture

Reverse-search fixtures verify Ctrl+R follows terminal incremental-search conventions without losing the prompt draft.

They prove the first Ctrl+R selects the newest prompt, typed characters narrow by substring, repeated Ctrl+R moves to older matches, Backspace recovers from a failed query, and the border reports active and failing search states. Ctrl+G restores the exact draft cursor, Esc keeps the match for editing, Enter submits it through the wrapped editor, and newly recorded prompts become searchable immediately.

## Prompt clear fixture

Prompt-clear coverage verifies non-empty text does not count as the first press of Pi's empty-prompt exit sequence.

A focused wrapper fixture starts with draft text and proves the first Ctrl+C only clears it, the second renders `Press Ctrl+C again to exit` in the theme warning color, and the third requests shutdown and removes the row. It also waits past the 500 ms window and proves the warning disappears without entering transcript output. The base keybinding integration fixture repeats the three-press path through `session_start`, the installed editor factory, and Pi's real keybinding manager.

## Clipboard image fixture

A session integration fixture verifies text-only image markers remain usable downstream.

It starts with text-only capabilities, loads proper-base under `TERM_PROGRAM=Scribe`, and verifies capabilities remain unchanged. A real one-pixel PNG becomes `[image 1]`; a non-capturing overlay shows the marker and source path without Kitty escapes; submission expands the marker so Pi's downstream handler receives the original path.

A focused cursor fixture uses a fake editor whose `setText()` moves to prompt end. It proves path-to-marker replacement restores the cursor after the marker and deleting one marker character removes the full marker while restoring its former start position. A history fixture recalls an image prompt followed by an older plain prompt and verifies marker replacement does not reset Pi's history index, so repeated Up presses keep moving backward.

## Image context fixture

A focused fixture verifies old image bytes leave outbound model context without changing the stored messages.

It supplies user and tool-result images on both sides of a newer user message. Earlier image blocks become text markers while current-turn images retain their original objects, and assertions against the inputs prove the filter does not mutate session content. A context containing only the current user turn returns by reference as a no-op.

## Prompt display fixture

A focused fixture verifies prompt-template expansion remains model-facing rather than user-facing.

It queues a plain prompt and `/implement-ready epic-1 4`, then supplies the expanded template body as Pi's user message. The display transformer leaves plain text unchanged, replaces both exact and whitespace-normalized expanded Markdown with the raw slash command, and drains one persistence record containing a hash plus raw command but not the template body. Restoring that custom-entry record reproduces the display mapping after reload, while clearing it restores native text.

## Recorder fixtures

Recorder tests exercise pi's actual assignment shape through a class-field-style fake editor.

They cover handlers assigned before and after installation, per-instance property interception, recording before downstream delivery, later handler reassignment, repeated installation, and clearing a handler without resurrecting stale behavior.

## Autocomplete fixture

A `session_start` integration fixture installs proper-base around a fake editor and verifies selected autocomplete descriptions use a non-capturing overlay above the prompt.

The rendering fixture proves the editor returns the same lines and height, the overlay accounts for footer rows, description text uses the selected-item accent instead of muted styling, boxed text stays within terminal width, and visibility ends with the selected description.

A focused lifecycle fixture proves missing descriptions release the overlay immediately and unmounted editors release it after pi's current visibility pass. This guards the overlay-stack condition that otherwise prevents regular/fullscreen TUI mode changes.

An inline-command fixture verifies slash completion receives only the active command segment after whitespace or on a later line, replaces only that segment, supports command arguments, and ignores URL or path-internal slashes. A model-completion fixture verifies the empty `/model ` list sorts descending, `opu` removes unrelated candidates and sorts Opus versions descending, `opus 4` requires both terms, non-model suggestions preserve provider order, and both Enter and Tab accept and submit the selected `provider/model` value.

## Settled transcript fixture

Transcript fixtures verify thoughts and updates remain fully rendered after settlement, while tools and errors compact and expand independently.

A component-tree fixture installs the wrapper around Pi's document/chat shape and first renders thinking, tool-call commentary, tool cards, errors, and status updates unchanged. It then completes a tool-calling assistant message and one of two tools while the run remains active, proving the assistant's thinking and multiline commentary remain fully visible, updates keep blank rows around them, and the unfinished tool keeps its native live preview. A later phase completes the final active tool above `Working...` and an empty assistant component, proving the tool stays native until that assistant receives text, then compacts on the same render. The fully settled view retains thinking, direct assistant text, and agent-owned status updates while emitting separate descriptive rows for successful tools, failed tools, and errors in original component order. Assertions prove thoughts never receive `thought` summary labels, updates never receive `update` summary labels, and tool and error rows use distinct semantic colors while retaining text labels. Its fake fullscreen screen clicks one tool summary; the wrapper claims the event ahead of Pi's consuming listener, expands only that tool, leaves every sibling collapsed, and fully expands the selected card without changing visible thoughts. The expanded item ends with a linked bottom collapse control that closes only that item. Global tool-output expansion remains available. Starting another run proves earlier item states remain stable while only newly appended components render live. A fake `/session` status appended after settlement remains native. A second user prompt proves grouping remains turn-local, repeated installation refreshes the live context without stacking, and uninstall restores the native renderer. A lifecycle fixture verifies `agent_settled` resets Pi's global tool-output state to collapsed before requesting the final redraw.

## Base keybinding fixture

A session integration fixture applies the real Pi 0.84.2 `KeybindingsManager` to the installed editor factory.

It verifies Ctrl+V and Ctrl+Shift+V both match Pi's clipboard paste action without removing an existing Alt+V alias. Shift+Enter and Alt+Enter both match prompt newline while other newline aliases survive, and Alt+Enter no longer matches follow-up queueing. Fullscreen transcript actions claim Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown instead of unmodified or Shift-only keys; the editor retains its native unmodified bindings; and modern modifier sequences match the intended actions. Navigation fixtures verify a recalled prompt ends at line 0, column 0; Home first reaches a soft-wrapped visible-row start and then the full prompt start, including across a hard newline; and End reaches the logical line end and then the full prompt end. They also prove native reload reapplies current bindings without losing unrelated user values, repeated installation remains idempotent, and the terminal writer stays untouched for Pi's native mouse handling.

## Smart selection fixture

Smart-selection fixtures verify token-aware ranges extend Pi's native fullscreen word selection without replacing it.

Pure cases cover wrapped URLs, source paths with line and column suffixes, command flags, qualified identifiers, quoted values, ANSI-styled paths, ordinary prose fallback, and fraction rejection. A fake fullscreen renderer proves only scroll-view points receive smart ranges, native selection handles other rows, and disposal restores the original resolver.

## Jump-to-bottom fixture

A fake alternate-screen TUI verifies the button's visibility rule, geometry, and mouse priority.

One case proves the extra row appears only while the viewport is scrolled away from output, spans the full width, shrinks to a bare arrow on a narrow terminal, and disappears when even the arrow cannot fit. A second case registers a renderer-style consuming listener first, then verifies the installed listener still receives a press on the button's computed row, scrolls to the end once, swallows the matching release, leaves a press on the prompt row to the renderer, and stops responding after disposal.

## Footer fixture

A session integration fixture verifies the rearranged footer keeps its model, effort, and usage rows inside a safe terminal width.

The same fixture verifies distinct colors for path, branch, input, output, cache read/write/hit, cost, context, model, and effort; context changes at warning and danger thresholds; a narrow row retains `xhigh`; max and ultra animate; and shutdown restores the native footer without stale context access. It also replaces an inherited prototype renderer after shutdown and verifies the reused footer picks up the replacement instead of retaining proper-base's stale captured function.

## Early cancellation fixture

A session integration fixture verifies editable recovery of an unprocessed cancelled prompt.

It submits through the wrapped editor, captures the accepted user entry, and presses Esc before assistant processing. The prompt returns immediately, settlement schedules the internal command, a hidden anchor makes a leaf user entry navigable, and tree navigation abandons the cancelled turn. Further phases cover pre-input routing cancellation, processed-turn retention, and delegation of queued streaming prompts to Pi's native restoration.

## Questionnaire cancellation fixture

A fixture drives the registered `tool_result` handler with synthetic tool results and records whether `ctx.abort()` was called.

It verifies a dismissed questionnaire aborts, while an answered one, a failure envelope carrying `error`, a missing `details` object, and another tool's cancelled result all run on.

## Transient retry fixture

The transient-retry fixture verifies CLIProxyAPI transient stream errors become retryable without touching other messages.

An errored assistant message whose text matches the CPA `empty_stream` pattern must return a copy whose `errorMessage` gains the `network error:` prefix pi treats as retryable. User messages, non-error stops, unrelated error text, and already-prefixed messages must pass through by reference so the `message_end` handler performs no transform.

## Store fixtures

Store tests use temporary directories and real Node filesystem operations.

They verify project-key encoding, path selection, round trips, whitespace and length limits, multiline JSONL, private file permissions, fail-open writes, missing and damaged data, bounded tail reads, compaction thresholds, newest-entry retention, and repeated multi-session appends.

## Settings seed fixtures

Settings-seed tests import the `postinstall` module directly and write real settings files into temporary agent directories.

They verify the override is added without disturbing unrelated top-level keys, that sibling `subagents` and `agentOverrides` entries survive the merge, that an existing `worker` override is returned unchanged even when it says `fork`, that a second run is a no-op, that a missing or malformed settings file is neither created nor overwritten, and that the agent directory follows `PI_CODING_AGENT_DIR` including its tilde form.

The module runs its seed only when invoked as the main script, so importing it in a test cannot touch the real settings file. Whether npm fires the hook is an install-time check rather than a fixture.

## Strict validation

Strict compiler and coverage gates keep test fixtures from hiding unsafe assumptions or losing broad regression protection.

`npm run typecheck` enables strict mode, exact optional properties, unchecked-index diagnostics, unused checks, fallthrough checks, and no-emit compilation across runtime and tests. `npm run test:coverage` requires at least 93% lines, 78% branches, and 90% functions.

## Coverage boundary

The suite does not instantiate pi; one image-history fixture instantiates pi-tui's real `Editor` while lifecycle fixtures use minimal fakes.

The image-history fixture exercises native history state and Up handling. Session-title, history-seeding, autocomplete, early-cancellation, fullscreen-keybinding, and footer fixtures run the extension's complete lifecycle callbacks against minimal fake API and component trees, and the questionnaire fixture calls its registered `tool_result` handler directly.

Package discovery, real terminal modifier reporting, real terminal color fidelity, selection key handling, replacement footers, built-in modal selectors, and interaction with later-loaded extensions remain startup or manual integration checks. Pure history and storage modules cover the ordering and persistence rules that carry the highest regression risk.

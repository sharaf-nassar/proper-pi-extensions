# Verification

The package uses `node:test` cases across session naming, model-preserving clearing, history, prompt display, editor, image markers, model context, transcript cleanup, fullscreen, cancellation, footer, and filesystem behavior.

## Session-title fixture

A session integration fixture verifies first-response naming without a second model request.

It proves a fresh unnamed branch receives the title instruction, the streamed metadata marker stays hidden, terminal control characters are removed before `pi.setSessionName()`, and later turns stop receiving the instruction. Separate phases keep naming armed after an aborted response, stop after completed output omits metadata, and prove explicit names or branches with prior assistant output are never renamed.

## Session listing fixtures

Session-listing tests build real JSONL session files in temporary directories and read them back.

They verify header fields, message counts that ignore non-message entries, the first user message including multi-block text joined with a space, `created` from the header, and an empty `allMessagesText`. Activity time comes from the last user or assistant entry rather than the file, so a later branch append cannot move a finished session; renames are picked up wherever they appear with the newest winning and an explicit clear returning to unnamed. A boundary case sizes an entry so the next one begins inside the read overlap, then requires the exact count, that entry's time, a rename beyond it, and the padded first message. Headerless files and missing paths return nothing, and a session with no messages falls back to its header time.

A descriptor case reads forty sessions whose bodies are never reached and requires the process's open descriptors not to grow, since abandoning a line reader does not close its stream; it is skipped where `/proc/self/fd` is unavailable.

Lister cases prove newest-first ordering, that non-JSONL files are ignored, that a shared custom directory is filtered to the current working directory while the project's own directory is not, and that `listAll` spans project directories and reports progress. A backfill case waits for `allMessagesText` to arrive on the object the picker already holds, and an installation case proves both static methods are replaced exactly once and serve rows before search text lands. A surface case installs onto pi's real `SessionManager` and lists a temporary directory through it, so a rename or argument reorder in pi fails loudly instead of leaving the picker quietly slow.

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

A session integration fixture verifies Scribe Kitty previews and text fallback remain usable downstream.

It starts with text-only capabilities, loads proper-base under `TERM_PROGRAM=Scribe`, and verifies the Kitty and OSC 8 hyperlink capabilities are enabled before the fake fullscreen renderer snapshots them. A real one-pixel PNG becomes `[image 1]`; the non-capturing overlay emits a Kitty image sequence, then a forced text-only capability renders the marker and source path without Kitty escapes. Submission expands the marker so Pi's downstream handler receives the original path.

A thumbnail fixture gives the dimension parser a 4096-by-2160 PNG header and proves the plan is bounded to the 24-by-6-cell pixel envelope while an already-small image bypasses conversion. An asynchronous fixture injects a deterministic thumbnailer, verifies Pi's braille loader renders without exposing the source path, then observes the completed bounded PNG replace it with a Kitty preview. Waiting past one animation interval proves the loader timer stopped after completion.

A real `sharp` fixture generates oversized PNG, JPEG, GIF, and WebP files, passes each through the default runtime thumbnailer, and requires every marker to promote from the loader to a Kitty sequence. A lockfile fixture verifies `@img/sharp-darwin-arm64` and `@img/sharp-darwin-x64` remain optional Darwin artifacts with matching CPU selectors, preventing Linux lock regeneration from silently dropping macOS installation support.

A measurement fixture proves frames without a visible preview never re-render the components below the editor, while an active marker resumes the overlay measurement.

A focus-return fixture models pi-tui's fullscreen upload cache and viewport input handler. With an active Kitty preview, `CSI I` delegates to the original handler, clears the cached upload identities, requests one forced redraw, and disposal restores the original method.

A focused cursor fixture uses a fake editor whose `setText()` moves to prompt end. It proves path-to-marker replacement restores the cursor after the marker and deleting one marker character removes the full marker while restoring its former start position. An editor-navigation fixture proves Left and Right jump across a complete multi-digit marker from either boundary or interior, while movement outside it and malformed marker-like text remain native. A real pi-tui `Editor` fixture places the cursor on a complete marker, observes Pi inverse-highlight the whole token, presses Backspace, and verifies native deletion removes the marker and leaves the cursor at its former start; a zero-id malformed marker retains one-character highlighting. A history fixture recalls an image prompt followed by an older plain prompt and verifies marker replacement does not reset Pi's history index, so repeated Up presses keep moving backward.

## Clipboard leak guard fixture

The fixture drives `installClipboardLeakGuard` against fake addon modules and the subprocess reader against an empty `PATH`, with no live clipboard or X server.

It asserts that on Linux the fake addon's `getText` and `hasImage` are replaced while `setText` and `getImageBinary` keep their native functions, that the replacement reader supplies awaited text and reports no image, and that a second installation — standing in for `/reload` against pi's same cached module object — keeps the first wrappers instead of stacking. Off Linux the module must never be resolved, and a missing, malformed, or unresolvable addon fails open. The tool reader returns empty text when no clipboard tool exists on `PATH`, for both the X11 and Wayland tool orders.

## Image context fixture

A focused fixture verifies old image bytes leave outbound model context without changing the stored messages.

It supplies user and tool-result images on both sides of a newer user message. Earlier image blocks become text markers while current-turn images retain their original objects, and assertions against the inputs prove the filter does not mutate session content. A context containing only the current user turn returns by reference as a no-op.

## Skill context fixture

A focused fixture verifies invoked skills stay present once in outbound context and survive compaction.

It asserts a repeated identical body keeps the first message by reference, so the cached request prefix cannot shift, while the later message retains its request beside an already-loaded note. A changed body returns the context unmodified, proving different arguments still reach the model. A compacted context holding only a summary and a follow-up turn regains the dropped bodies on the first user turn after the summary, in invocation order, without inserting a message; a skill still present is not carried a second time, and a branch with no summary is left alone. Oversized bodies truncate, the combined ceiling drops the oldest, plain transcripts return by reference, and repeated runs over one input are byte-identical.

## Prompt display fixture

A focused fixture verifies prompt-template expansion remains model-facing rather than user-facing.

It queues a plain prompt and `/implement-ready epic-1 4`, then supplies the expanded template body as Pi's user message. The display transformer leaves plain text unchanged, replaces both exact and whitespace-normalized expanded Markdown with the raw slash command, and drains one persistence record containing a hash plus raw command but not the template body. Restoring that custom-entry record reproduces the display mapping after reload, while clearing it restores native text.

## Recorder fixtures

Recorder tests exercise pi's actual assignment shape through a class-field-style fake editor.

They cover handlers assigned before and after installation, per-instance property interception, recording before downstream delivery, later handler reassignment, repeated installation, and clearing a handler without resurrecting stale behavior.

## Autocomplete fixture

A `session_start` integration fixture installs proper-base around a fake editor and verifies selected autocomplete descriptions use a non-capturing overlay above the prompt.

The rendering fixture proves the editor returns the same lines and height, the overlay accounts for footer rows, description text uses the selected-item accent instead of muted styling, boxed text stays within terminal width, and visibility ends with the selected description.

A focused lifecycle fixture proves missing descriptions release the overlay immediately and unmounted editors release it after pi's current visibility pass. This guards the overlay-stack condition that otherwise prevents regular/fullscreen TUI mode changes. A measurement case proves a frame without a selected description never re-renders the components below the editor, while a selected description resumes the measurement.

An inline-command fixture verifies slash completion receives only the active command segment after whitespace or on a later line, replaces only that segment, supports command arguments, and ignores URL or path-internal slashes. A model-completion fixture verifies the empty `/model ` list sorts descending, `opu` removes unrelated candidates and sorts Opus versions descending, `opus 4` requires both terms, non-model suggestions preserve provider order, and both Enter and Tab accept and submit the selected `provider/model` value.

## Settled transcript fixture

Transcript fixtures verify thoughts and updates remain fully rendered after settlement, while tools and errors compact and expand independently.

A component-tree fixture installs the wrapper around Pi's document/chat shape and first renders thinking, tool-call commentary, tool cards, errors, and status updates unchanged. It then completes a tool-calling assistant message and one of two tools while the run remains active, proving the assistant's thinking and multiline commentary remain fully visible, updates keep blank rows around them, and the unfinished tool keeps its native live preview. A later phase completes the final active tool above `Working...` and an empty assistant component, proving the tool stays native until that assistant receives text, then compacts on the same render. The fully settled view retains thinking, direct assistant text, and agent-owned status updates while emitting separate descriptive rows for successful tools, failed tools, and errors in original component order. Assertions prove thoughts never receive `thought` summary labels, updates never receive `update` summary labels, MCP gateway rows retain `mcp` and append the proxied tool name, detail headers use bold `borderAccent`-colored `›` and `⌄` markers without click or keybinding instructions, and tool and error rows use distinct semantic colors while retaining text labels. Its fake fullscreen screen verifies compact controls emit no OSC 8 links, then clicks one tool summary through a scrolled viewport; the wrapper maps the screen row back to the document, claims the event ahead of Pi's consuming listener, expands only that tool, leaves every sibling collapsed, and fully expands the selected card without changing visible thoughts. The expanded item ends with a bottom collapse control that also emits no link and closes only that item. A stale-frame click then advances the reported scroll offset past the painted screen, proving a click that lands right after a wheel scroll still toggles the row the user actually saw and closes it again once the offsets agree. Global tool-output expansion remains available. Starting another run proves earlier item states remain stable while only newly appended components render live. A fake `/session` status appended after settlement remains native. A second user prompt proves grouping remains turn-local, repeated installation refreshes the live context without stacking, and uninstall restores the native renderer. A lifecycle fixture verifies `agent_settled` resets Pi's global tool-output state to collapsed before requesting the final redraw.

A custom-entry fixture settles a transcript holding an extension entry component whose renderer switches on its own expansion state, clicks its header row, and proves the click is claimed and the entry opens, so entry disclosure markers are not decoration that only the global binding moves.

## Settled render memoization

A memoization fixture proves repeated same-width renders never rebuild completed component content.

It settles a transcript containing a tool-calling assistant message and a collapsed tool card, instruments the instance `updateContent` and `setExpanded` methods, and renders three frames at one width. Rebuild and expansion-call counts must not grow after the first frame, proving the wrapper serves memoized assistant subset lines and skips redundant tool expansion updates. A wider fourth render must recompute and still emit the thinking text, proving width changes invalidate the memo instead of serving stale lines. This guards the frame cost that once re-parsed the whole transcript's markdown every 16ms render and pinned the event loop.

## Base keybinding fixture

A session integration fixture applies the real Pi 0.84.2 `KeybindingsManager` to the installed editor factory.

It verifies Ctrl+V and Ctrl+Shift+V both match Pi's clipboard paste action without removing an existing Alt+V alias. Alt+Enter matches prompt newline and no longer matches follow-up queueing, a user's own newline alias survives beside it, and proper-base adds no Shift+Enter of its own — under a user override that chord stops matching, while Pi's untouched defaults keep both Shift+Enter and Ctrl+J. Fullscreen transcript actions claim Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown instead of unmodified or Shift-only keys; the editor retains its native unmodified bindings; and modern modifier sequences match the intended actions. Navigation fixtures verify a recalled prompt ends at line 0, column 0; Home first reaches a soft-wrapped visible-row start and then the full prompt start, including across a hard newline; and End reaches the logical line end and then the full prompt end. They also prove native reload reapplies current bindings without losing unrelated user values, repeated installation remains idempotent, and the terminal writer stays untouched for Pi's native mouse handling.

## Smart selection fixture

Smart-selection fixtures verify token-aware ranges extend Pi's native fullscreen word selection without replacing it.

Pure cases cover wrapped URLs, source paths with line and column suffixes, command flags, qualified identifiers, quoted values, ANSI-styled paths, ordinary prose fallback, and fraction rejection. A fake fullscreen renderer proves only scroll-view points receive smart ranges, native selection handles other rows, and disposal restores the original resolver.

## Hyperlink identity fixture

Tagging cases verify anonymous OSC 8 opens gain one stable URI-derived id while everything else passes through.

Two rows reopening the same URI receive the same id and a different URI receives a different one, with ST and BEL terminators both preserved. Closes, opens with explicit params, and plain text stay byte-identical. A fake terminal proves installation wraps `write`, reinstallation reuses the live wrapper, tagged output reaches the terminal, and disposal restores the original prototype method so later writes leave links anonymous. A shape without a terminal installs nothing.

## Selection dismissal fixture

A fake fullscreen renderer with a consuming viewport listener verifies typing dismisses the selection while every other input leaves it standing.

Classifier cases accept printable characters, non-ASCII graphemes, multi-character bursts, Enter, Backspace, bare escape, encoded keys, and a bracketed paste whose body resembles a release encoding, and reject empty input, cell-size reports, and key-release encodings. A keystroke with an active selection resets every selection field, stops auto-scroll, requests one render, and leaves the input unconsumed; without a selection nothing re-renders. Mouse gestures and viewport keys consumed by the renderer's earlier listener, terminal reports, and an in-progress drag all keep the selection. A shape without the selection surface installs nothing, reinstallation takes over with one live listener, the replaced install's stale disposer is a no-op, and the owning disposer removes the listener.

## Jump-to-bottom fixture

A fake alternate-screen TUI verifies the button's visibility rule, geometry, and mouse priority.

One case proves the extra row appears only while the viewport is scrolled away from output, spans the full width, shrinks to a bare arrow on a narrow terminal, and disappears when even the arrow cannot fit. A second case initializes the extension's editor factory and proves an interactive submission calls the native bottom-scroll method once, while extension-origin input does not. A third case registers a renderer-style consuming listener first, then verifies the installed listener still receives a press on the button's computed row, scrolls to the end once, swallows the matching release, leaves a press on the prompt row to the renderer, and stops responding after disposal.

## Prompt jump fixture

A fake alternate-screen TUI with scripted transcript content verifies the chips' geometry, prompt filtering, and mouse priority.

One case proves both chips composite into the top-right of row 0, leave every other row untouched, and disappear on a terminal too narrow to hold them. Another paints them over a background-filled banner row and proves that background survives underneath rather than resetting to the terminal default. A third walks the viewport down a scripted transcript and proves the reading moves from zero through each prompt, vanishes once the viewport follows output, stays absent when no prompts exist, centres within half a cell of the arrow pair, and renders in the weaker of the two colors. A cache case repaints an unchanged frame, then appends prompts and scrolls, proving the cached reading refreshes on line-count and viewport changes. A fourth paints over rows whose text ends part-way through an escape sequence and proves both the chips and the reading still appear, so the style scan cannot spin the renderer. A fifth installs a color function that always throws and proves the frame reaches the renderer byte-for-byte unchanged and the click region is released, so a failed decoration cannot end the session. A second case walks a transcript of alternating user and assistant zones: the down chip stops on the next user prompt, then scrolls to the end once no prompt remains below, and the up chip walks back to the first prompt and stays there. A third case registers a renderer-style consuming listener first, then verifies a click one row below the chips stays with the renderer and clicks stop scrolling after disposal. A fourth case replays the reload order — install, reinstall, then the first disposer — and proves the replacement wrapper still renders and still scrolls.

## Footer fixture

A session integration fixture verifies the rearranged footer keeps its model, effort, and usage rows inside a safe terminal width.

The same fixture verifies distinct colors for path, branch, input, output, cache read/write/hit, cost, context, model, and effort; context changes at warning and danger thresholds; a narrow row retains `xhigh`; max and ultra animate; and shutdown restores the native footer without stale context access. It also replaces an inherited prototype renderer after shutdown and verifies the reused footer picks up the replacement instead of retaining proper-base's stale captured function.

A second fixture models pi's width-sensitive native render, which silently drops trailing model tags such as CLIProxyAPI's `fast` label when the one-line stats row overflows. It proves the layout's wide re-render recovers the full tag on the realigned model row at the original terminal width while extra status lines stay bounded.

## Early cancellation fixture

A session integration fixture verifies editable recovery of an unprocessed cancelled prompt.

It submits through the wrapped editor, captures the accepted user entry, and presses Esc before assistant processing. The prompt returns immediately, settlement schedules the internal command, a hidden anchor makes a leaf user entry navigable, and tree navigation abandons the cancelled turn. Further phases cover pre-input routing cancellation, processed-turn retention, and delegation of queued streaming prompts to Pi's native restoration. A final phase appends another extension's transcript entry between submission and the user message and proves navigation targets the pre-submission leaf, so that entry leaves the branch with the prompt instead of remaining as its surviving parent.

## Questionnaire cancellation fixture

A fixture drives the registered `tool_result` handler with synthetic tool results and records whether `ctx.abort()` was called.

It verifies a dismissed questionnaire aborts, while an answered one, a failure envelope carrying `error`, a missing `details` object, and another tool's cancelled result all run on.

## Transient retry fixture

The transient-retry fixture verifies CLIProxyAPI transient stream errors become retryable without touching other messages.

An errored assistant message whose text matches the CPA `empty_stream` pattern must return a copy whose `errorMessage` gains the `network error:` prefix pi treats as retryable. User messages, non-error stops, unrelated error text, and already-prefixed messages must pass through by reference so the `message_end` handler performs no transform.

## Fast tier fixture

Fast-mode fixtures verify the session and global tier scopes against a temporary agent directory holding provider config and catalog files.

Cases prove a bare `/fast` submission is the only session toggle text; session Fast adds `service_tier: "priority"` for capable models of the configured provider while already-injected, non-object, foreign-provider, and non-capable payloads stay untouched; Fast off strips exactly the priority tier while other tier values survive; and the session reset restores the default. Global cases prove one overlay's toggle reaches another instance's next request through the shared config file, preserves unrelated keys and the provider's file format, and honors `CLIPROXYAPI_FAST` and `CLIPROXYAPI_PROVIDER_ID` grammar including invalid-value fallback. A rewritten catalog cache refreshes the capability set by modification time and a missing cache means no capable models. Feedback cases name the scope, warn on an incapable current model, and report the surviving other scope on disable. A recorder case proves the consume hook swallows `/fast` before recording or forwarding while other text passes through.

## Commit guard fixtures

Commit-guard tests exercise the ported validator's command and message rules.

They verify that valid direct commits and non-commit commands pass; that compound, wrapped, env-prefixed, and assignment-prefixed invocations, dynamic tokens, unsupported flags, and missing literal messages are rejected with the hook's wording; that multiple and attached `-m` values extract and join as paragraphs; that message rules cover subject and body length, the blank second line, trailer-block exemption, and forbidden attribution lines; that blocked reasons aggregate every error at once; and that unparseable commands naming git commit block fail-safe.

## Store fixtures

Store tests use temporary directories and real Node filesystem operations.

They verify project-key encoding, path selection, round trips, whitespace and length limits, multiline JSONL, private file permissions, fail-open writes, missing and damaged data, bounded tail reads, compaction thresholds, newest-entry retention, and repeated multi-session appends.

## Strict validation

Strict compiler and coverage gates keep test fixtures from hiding unsafe assumptions or losing broad regression protection.

`npm run typecheck` enables strict mode, exact optional properties, unchecked-index diagnostics, unused checks, fallthrough checks, and no-emit compilation across runtime and tests. `npm run test:coverage` requires at least 93% lines, 78% branches, and 90% functions.

## Coverage boundary

The suite does not instantiate pi; one image-history fixture instantiates pi-tui's real `Editor` while lifecycle fixtures use minimal fakes.

The image-history fixture exercises native history state and Up handling. Session-title, history-seeding, autocomplete, early-cancellation, fullscreen-keybinding, and footer fixtures run the extension's complete lifecycle callbacks against minimal fake API and component trees, and the questionnaire fixture calls its registered `tool_result` handler directly.

Package discovery, real terminal modifier reporting, real terminal color fidelity, selection key handling, replacement footers, built-in modal selectors, and interaction with later-loaded extensions remain startup or manual integration checks. Pure history and storage modules cover the ordering and persistence rules that carry the highest regression risk.

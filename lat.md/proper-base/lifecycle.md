# Prompt history lifecycle

Each `session_start` rebuilds the editor wrapper and seeds a bounded history assembled for the active working directory.

## Startup sequence

Startup compacts the project store when needed, loads history, unwraps any prior proper-base wrapper, and installs a new factory around the current editor factory.

If another extension already provides an editor, that factory remains the base. Otherwise proper-base creates pi's `CustomEditor`. The seeded prompts are added oldest first so the first Up press returns the newest entry.

## Prompt sources

History combines the private store with pi session files for the current working directory.

The store covers prompts from sessions pi never persisted. Session files preserve prompts from before installation and remain a fallback if the store is deleted. Sessions are read newest first, the live session file is skipped, and scanning stops after collecting 200 prompts.

Failure to list or open sessions leaves store history available. Damaged sessions contribute no prompts instead of failing startup.

## Prompt normalization

Only user messages produce history entries.

String content is used directly. Text parts are concatenated the same way pi builds live editor history, while non-text parts are ignored. Whitespace-only prompts are dropped. Skill-wrapper messages are reduced to the trailing text the user typed; a wrapper without trailing text is omitted.

## Recallable submissions

UI commands are excluded from history so recalling a prompt cannot re-run one.

A submission whose first token is a slash command is kept only when that name appears in pi's `getCommands()` with a source other than `extension`. Prompt templates such as `/file <task>` and skill commands are therefore recalled, while built-ins such as `/model`, `/new`, and `/reload` and extension commands such as `/llm-router-config` are not. Text that does not start with `/` is always kept.

The filter runs on append and again on the seeded result, so stores written before it existed stop surfacing their recorded commands. This matters beyond noise: re-submitting a recalled `/model <provider>/<id>` silently leaves `llm-router/auto`, which disarms the routing decision described under `Eligible input` in `../proper-llm-router/routing.md` and makes later pinned commands run unrouted.

## Merge contract

Sources merge by prompt text and timestamp rather than by source order.

A duplicate collapses onto its newest timestamp. Same-timestamp entries retain encounter order. Prompts already present in pi's live-session history are excluded, the newest 200 survive the limit, and the result is returned oldest first for `addToHistory()`.

## Submission interception

Recording wraps the editor instance's `onSubmit` property rather than relying on pi's input event.

The property descriptor wraps both an existing handler and handlers assigned later by pi. A preparation step expands display-only image markers before recording and delegation, so history and Pi receive usable paths. Recording occurs before delegating so a downstream failure cannot lose the prompt, and the `Recallable submissions` filter decides whether the prepared text reaches the store. A symbol marker prevents recorder stacking when installation repeats.

The early-cancellation capture keeps its own narrower rule: any leading `/` or `!` disqualifies a submission from restore, regardless of whether history would recall it.

## Clipboard images

Clipboard image paths use compact editor markers while their source paths remain visible and available to agents.

proper-base binds Pi's `app.clipboard.pasteImage` action to Ctrl+V and Ctrl+Shift+V; either chord invokes Pi's native image-or-text clipboard handler when the terminal forwards it. Every insertion route detects readable absolute `pi-clipboard-*` GIF, JPEG, PNG, or WebP paths and replaces each with `[image N]`. Active markers render as full-width text rows containing the marker and source path in a non-capturing overlay above the editor. Multiple paths stack, while an autocomplete description temporarily hides the image overlay to avoid overlap.

proper-base does not enable Kitty rendering or change terminal image capabilities, including under `TERM_PROGRAM=Scribe`. The overlay contains plain text only.

A one-character deletion inside an intact marker removes the whole marker and its path entry. Submission preparation expands every intact marker back to its source path before recorder storage and Pi dispatch, so agent input never receives the display-only tag. Preview state survives an unprocessed early cancellation, then clears once assistant processing begins or a normal turn settles.

## Autocomplete description pane

The installed editor's `render()` is wrapped once per instance. Selected autocomplete descriptions render in a non-capturing pi-tui overlay immediately above the editor instead of adding lines to the editor itself.

The overlay is full-width, square-bordered, and anchored above the editor plus any widgets and footer rows beneath it. Description text uses the same theme-selected accent as the active autocomplete item, while the border retains its normal theme color. It expands upward over transcript content, so descriptions of different lengths never move the prompt, autocomplete list, or footer. Newlines are normalized and text wraps inside the box; descriptions exceeding the terminal area above the prompt end with an ellipsis.

Cursor movement updates the selected item before the next render. The overlay exists only while its editor remains mounted and a selected description exists. Losing either condition calls the overlay handle's `hide()` method, removing the entry rather than merely making it invisible. Unmount detection queues removal after the current overlay-visibility pass so the stack is not mutated while pi iterates it.

This lifecycle matters when pi changes renderers: its regular/fullscreen switch refuses to run while any overlay entry exists, including invisible non-capturing entries. Releasing the detail overlay keeps that switch available, and the next editor render recreates the box against the active renderer. Editors without pi's autocomplete-list state render exactly as before.

This scope covers editor autocomplete, including skills and slash commands. proper-base triggers command completion for a slash segment at the beginning of the first line, after whitespace anywhere in a line, or at the beginning of later prompt lines. The provider evaluates only the active slash segment, including command arguments, and completion splices the result back into that segment without changing surrounding prompt text. Slashes embedded in paths or URLs are not command boundaries. Custom editors without Pi's autocomplete state and trigger method remain untouched.

The same provider wrapper sorts every `/model ` result by displayed model ID descending using case-insensitive, numeric-aware comparison. For a non-empty query, whitespace-delimited terms must each occur in the candidate's label, value, or description; when strict matches exist, unrelated fuzzy candidates are removed before sorting. If strict matching finds nothing, Pi's fuzzy candidate set remains available but is still sorted descending. Non-model suggestions retain provider order. When Enter or Tab accepts a model completion, the editor wrapper verifies that Pi produced the exact selected `provider/model` command and immediately invokes Pi's submission path. Enter reuses its confirm key; Tab calls the editor's native submit routine, with an Enter fallback for compatible custom editors. Tab remains completion-only outside `/model ` arguments, and editors without Pi's autocomplete internals are untouched. Built-in modal selectors do not pass through the editor factory and are outside the extension API.

## Prompt newline keys

Shift+Enter and Alt+Enter insert new lines in the prompt.

proper-base ensures both chords belong to `tui.input.newLine` while preserving other newline aliases such as Ctrl+J. Alt+Enter is removed from `app.message.followUp`, whose application-level handling would otherwise consume the chord before the editor can insert a line. The bindings are reapplied after native keybinding reloads.

## Prompt cursor navigation

Home and End move through visible prompt rows and full-prompt boundaries in two stages.

For Home, proper-base reuses Pi's current visual-line map and render width. The first press moves to the start column of the current soft-wrapped row; a second press from that boundary moves to line 0, column 0. The same two-stage rule applies across hard-newline paragraphs, and Home at the full prompt start is a no-op.

End retains its existing behavior: native Pi handling reaches the current logical line end, then a second press moves to the final column of the final line. Autocomplete keeps native handling, custom editors without Pi's visual-line state keep their own behavior, and Ctrl+Shift+Home/End remain fullscreen transcript actions.

## Pinned transcript scrolling

Pinned scrolling comes from pi's native fullscreen renderer; proper-base keeps that renderer switch available and changes which keys target it.

With `tuiMode` set to `fullscreen`, pi owns transcript scrolling while queued messages, status, widgets, editor, and footer remain fixed at the bottom. proper-base does not implement a second transcript viewport; it releases inactive overlays so renderer changes remain unblocked. Mouse selection, wheel scrolling, scrollbar dragging, and link clicks remain under Pi's native fullscreen renderer.

Pi normally gives fullscreen transcript actions priority on unmodified Home, End, PageUp, and PageDown. The editor factory rewrites those four `tui.altScreen` action bindings on pi's shared keybinding manager to Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown. The unmodified and Shift-only keys therefore remain available to the terminal and pi's native editor actions.

Pi reloads `keybindings.json` after extension `session_start` handlers, so proper-base wraps the manager's `reload()` method once and reapplies its four overrides after the native file load. The wrapper delegates through a symbol-stored mutable controller: hot reload replaces the controller's apply callback, preventing a closure from an older extension version from restoring obsolete bindings after the new `session_start`. A legacy boolean marker is upgraded by wrapping its stale reload handler so the newest apply pass runs last. Unrelated user bindings are preserved, repeated factory installation cannot stack current wrappers or drift values, and these four transcript bindings intentionally override user values while proper-base is active.

## Footer presentation

The editor factory locates pi's mounted built-in `FooterComponent` and decorates its `render()` output in place.

When the stats row contains a dollar cost, cumulative input, output, cache, cache-hit, and cost fields move to the right side of the top path row. The path truncates to make room. Context usage remains left on the second row, while the existing provider/model/thinking segment is re-padded with one trailing column reserved. Narrow layouts that cannot retain a useful path keep Pi's native arrangement.

`max` and the router-provided `ultra` level render each character with a different rainbow color. A bright highlight crosses the word on a four-second cycle; a 120 ms unref'd timer requests redraws only while either level is active and the footer remains mounted. Changing to another effort stops the timer, and footer disposal clears it.

After layout, stable low-chroma truecolors identify each metric without changing its label: slate path, sage branch, steel-blue input, sage output, lavender cache read, clay cache write, teal cache hit, ochre cost, and dusty-rose context. Context becomes amber above 70% and muted red above 90%. The active model stays purple; off through xhigh use pi's semantic thinking-level colors, and maximum effort uses the animation above. Extension statuses and components other than the built-in footer are not modified.

`session_shutdown` restores the built-in footer methods and stops the animation before pi invalidates the outgoing extension context. The replacement session can therefore render its native footer during rebinding without touching a stale captured context, then install fresh decoration from its new `session_start`.

## Early prompt cancellation

proper-base tracks each submitted plain prompt until assistant processing begins.

Editor submission captures text before Pi's input pipeline, while input and message events attach the accepted user-message timestamp and processing state. A terminal-input listener watches Esc only while the editor is focused and autocomplete is closed.

If Esc arrives before assistant processing, the prompt text is restored to the editor immediately. After the aborted run settles, proper-base invokes an internal extension command with command-context access and navigates to the cancelled user entry. Navigating to a user entry moves the active leaf to its parent, rebuilds agent context, and rerenders the transcript; when the user entry is already the leaf, a hidden custom anchor first makes navigation non-no-op. The append-only JSONL retains the abandoned branch, but the active transcript and future model context exclude it.

The pre-input submission capture also covers cancellation during llm-router judging, when no Pi user entry exists yet: the router discards the prompt, and proper-base restores its text without branch navigation. Streaming steering or follow-up submissions clear this early capture and remain owned by Pi's native queue restoration. Once an assistant message starts, cancellation keeps Pi's normal behavior and does not remove the turn. Escape used by autocomplete or another focused component is ignored.

## Questionnaire cancellation

A `tool_result` handler aborts the agent when the `ask_user_question` tool reports a dismissed questionnaire.

The tool is provided by `@juicesharp/rpiv-ask-user-question`, which resolves Esc as an ordinary result carrying `cancelled: true` and the text `User declined to answer questions`. Without intervention the turn continues and the model responds to a decline the user did not ask it to acknowledge. `ctx.abort()` reaches the same handler pi binds to Esc during streaming, so the run ends and the prompt accepts typing immediately.

The same result also reports `cancelled` for host and validation failures, which additionally set `error`: no UI, an RPC host without custom rendering, rejected parameters, and questionnaire module-load failures. Those keep their normal delivery so the model can fall back to asking in plain text. Results from other tools and answered questionnaires are untouched.

The handler is registered once at extension load rather than per `session_start`, so reload, resume, and fork cannot stack it.

## Reload and composition

A global symbol tags the editor factory and remembers the factory it wrapped.

The editor and recorder symbol keys retain their legacy `pi-proper-history` namespace so recorded behavior survives both package renames. The fullscreen keybinding installer also recognizes the prior `pi-proper-customs.fullscreen-keybindings` marker and migrates its mutable controller to the `pi-proper-base` namespace.

Because `session_start` runs on reload, resume, and fork, the next pass unwraps proper-base's previous factory before wrapping again. This prevents duplicate seeding and an ever-growing wrapper chain. Separate editor, TUI, and footer symbols prevent wrappers, overlays, and timers from stacking; repeated footer installation refreshes its live context, while `session_shutdown` removes it before context invalidation. Extensions loaded later may still replace the editor or footer, so load order controls the final renderer and keybindings.

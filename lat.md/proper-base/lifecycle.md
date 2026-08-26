# Prompt history lifecycle

Each `session_start` rebuilds the editor wrapper and seeds a bounded history assembled for the active working directory.

## Startup sequence

Startup compacts the project store when needed, loads only recorder-captured history, unwraps any prior proper-base wrapper, and installs a new factory around the current editor factory.

If another extension already provides an editor, that factory remains the base. Otherwise proper-base creates pi's `CustomEditor`. A history guard captures the editor's original append method, blocks Pi's later session replay, and adds trusted store prompts oldest first so the first Up press returns the newest entry.

## Automatic session title

A fresh unnamed session asks the model to summarize the task in its first successful response, then applies that title through Pi's native session-name API.

At `session_start`, proper-base enables title capture only when `pi.getSessionName()` is empty and the active branch has no assistant message. `before_agent_start` appends a short system instruction requiring a final `<session_title>` marker containing a plain 3–7 word title. Explicit names and resumed or forked branches with prior assistant output are never changed.

A markdown transformer hides the marker as soon as it appears during streaming. On finalized assistant output, proper-base extracts at most 64 characters, removes C0 and C1 terminal control characters, and calls `pi.setSessionName()`. Pi then refreshes the terminal tab and session selector through its native `session_info_changed` path. The assistant message itself remains intact so provider text or thought signatures are preserved for future turns.

Tool-use responses may defer the marker until the final response in the same agent run. An aborted or failed response leaves naming armed for a retry; a successful final response that omits the marker ends the attempt rather than adding the instruction to later user turns.

## Model-preserving clear

`/clear` follows Pi's native new-session replacement lifecycle, then restores the exact provider and model selected in the outgoing session.

The command captures only the provider and model ID, then calls `ctx.newSession()` without copying messages, names, branch state, or parent metadata. This preserves `/new` guards, shutdown, rebinding, and `session_start` behavior.

Pi invalidates the outgoing extension API during replacement. The old handler therefore uses `withSession` only to dispatch an encoded internal command through the replacement context. The newly bound proper-base instance resolves that exact model in the new registry and calls its own `pi.setModel()`. Extension-command dispatch finishes without creating a user message or starting an agent turn.

The post-bind restore intentionally runs after every new-session hook. In particular, proper-llm-router may switch a new session to `llm-router/auto`; `/clear` then restores the outgoing model so the next prompt does not route again. A session with no selected model keeps Pi's normal `/new` result, while an unavailable model leaves that result in place and shows an error.

## Prompt sources

History has one trusted source: the private recorder store for the current working directory.

Pi session messages are model-facing records. Skill invocations become `<skill>` blocks containing the full skill body, and prompt templates become their expanded bodies. Reading those messages cannot reconstruct exact user input, so proper-base never imports them and blocks Pi's initial transcript replay from adding them through `addToHistory()`.

## Prompt normalization

Only text captured by the editor's submission path can enter history.

The recorder keeps exact outgoing text after display-only image markers expand to their source paths. Store writes trim outer whitespace and reject blank or oversized entries. Skill and prompt-template commands remain in their submitted slash-command form.

## Prompt display

Prompt templates keep their raw slash invocation in the transcript while Pi and the model continue using the expanded body.

The `input` event records every interactive submission in order and marks only commands whose `getCommands()` source is `prompt`. When the corresponding expanded user `message_start` arrives, proper-base hashes its normalized text and maps that hash to the raw command. A display-only user Markdown transformer replaces matching expanded bodies with the raw invocation, so `/implement-ready epic-1 4` never becomes the full template in the user bubble.

At `agent_settled`, new hash-to-command records persist in a renderer-less custom session entry. Only the SHA-256 hash and raw command are stored; the already-persisted expanded prompt body is not duplicated. `session_start` rebuilds the map from active-branch records, preserving the compact display after reload, resume, or fork. Plain prompts, extension commands, and the actual model context remain unchanged.

## Recallable submissions

UI commands are excluded from history so recalling a prompt cannot re-run one.

A submission whose first token is a slash command is kept only when that name appears in pi's `getCommands()` with a source other than `extension`. Prompt templates such as `/file <task>` and skill commands are therefore recalled, while built-ins such as `/model`, `/new`, and `/reload` and extension commands such as `/llm-router-config` are not. Text that does not start with `/` is always kept.

The filter runs on append and again on the seeded result, so stores written before it existed stop surfacing their recorded commands. This matters beyond noise: re-submitting a recalled `/model <provider>/<id>` silently leaves `llm-router/auto`, which disarms the routing decision described under `Eligible input` in `../proper-llm-router/routing.md` and makes later pinned commands run unrouted.

## Merge contract

Recorded prompts order by timestamp before reaching the editor.

A duplicate collapses onto its newest timestamp. Same-timestamp entries retain encounter order, the newest 200 survive the limit, and the result is returned oldest first to the guard's trusted append method.

## Reverse history search

Ctrl+R runs terminal-style reverse incremental search over the same trusted, project-scoped prompts used by Up/Down recall.

The first Ctrl+R saves the current draft and cursor, exits Pi's native history-browsing state, and shows the newest recorded prompt. Typing adds a case-sensitive substring query, Backspace removes query characters, and repeated Ctrl+R moves to the next older match. New recorder-approved submissions join the searchable list immediately, which stays bounded by the same 200-entry lifecycle limit.

While searching, the editor's bottom border becomes `(reverse-i-search)\`query':`; a failed lookup keeps the last match visible and changes the label to `failing reverse-i-search`. Enter accepts and submits the match, Esc accepts it for editing, and Ctrl+G restores the original draft and cursor. Other control or navigation input accepts the match before delegating to the editor.

The wrapper owns Ctrl+R only while the main prompt editor is focused, so session-picker rename and other modal controls keep their native shortcuts. Starting search closes active autocomplete, repeated editor-factory installation refreshes the bounded prompt list without stacking wrappers, and compatible custom editors retain their own submission and rendering behavior beneath the search layer.

## Submission interception

Recording wraps the editor instance's `onSubmit` property rather than relying on pi's input event.

The property descriptor wraps both an existing handler and handlers assigned later by pi. A preparation step expands display-only image markers before recording and delegation, so history and Pi receive usable paths. Recording occurs before delegation and immediately appends the trusted text through the history guard; Pi's later `addToHistory()` call is ignored. The `Recallable submissions` filter decides whether the prepared text reaches the store, and symbol markers prevent wrapper stacking.

The early-cancellation capture keeps its own narrower rule: any leading `/` or `!` disqualifies a submission from restore, regardless of whether history would recall it.

## Clipboard images

Clipboard image paths use compact editor markers while their source paths remain visible and available to agents.

proper-base binds Pi's `app.clipboard.pasteImage` action to Ctrl+V and Ctrl+Shift+V; either chord invokes Pi's native image-or-text clipboard handler when the terminal forwards it. Every insertion route detects readable absolute `pi-clipboard-*` GIF, JPEG, PNG, or WebP paths and replaces each with `[image N]`. Active markers render in a non-capturing overlay above the editor. Image-capable terminals show compact previews, text-only terminals show full-width marker and source-path rows, and multiple entries stack. An autocomplete description temporarily hides the image overlay to avoid overlap.

At extension load, `TERM_PROGRAM=Scribe` promotes Pi's detected image capability to Kitty before the fullscreen renderer snapshots it. This restores previews now that Scribe preserves Kitty placement inside synchronized output. Other terminals retain Pi's native capability detection.

Before creating a terminal image, proper-base compares the source dimensions with the 24-by-6-cell preview's current pixel envelope. A larger PNG, JPEG, GIF, or WebP source is decoded and auto-oriented asynchronously by the declared `sharp` runtime dependency, resized with `fit: inside` and `withoutEnlargement`, and encoded as a bounded PNG; animated inputs use the first page. The original clipboard file remains untouched and still expands into submitted prompts. `sharp` performs work through libuv/libvips rather than synchronously blocking Pi, and its five-second pipeline timeout bounds damaged or pathological input. Its npm optional artifacts cover macOS arm64, macOS x64 (10.15+), glibc/musl Linux, and other supported platforms under the package's Node 20.9+ floor, which proper-base's Node 22.19+ requirement exceeds.

While conversion runs, the overlay renders pi-tui's existing accent-coloured braille `Loader` with no message, matching Pi's native working animation instead of flashing the marker path. If decoding, resize, encoding, or timeout fails, the animation stops and the overlay shows the marker-and-path fallback. Deletion, submission, clear, disposal, and overlay release destroy the active `sharp` pipeline and stop the loader timer; late promise results are ignored. This keeps focus-triggered terminal scene replay below bounded queue limits without an external `magick` or `convert` command.

Scribe can lose its painted scene across pane focus while Pi's fullscreen renderer still caches the Kitty source as uploaded. proper-base guards the current pi-tui private compatibility point by wrapping `handleViewportInput`; on focus-in (`CSI I`) with an active preview, it clears only pi-tui's uploaded-Kitty cache and requests a forced redraw. The existing `Image` lines then retransmit their bounded sources. Disposal restores the exact prior input handler, and incompatible TUI implementations skip the hook.

Left and Right treat every syntactically intact `[image N]` marker as one prompt token: Left from the end or interior lands at its start, and Right from the start or interior lands after it. proper-base wraps Pi's private editor segmenter so the renderer receives the complete marker as one grapheme; when the cursor is at that token position, Pi's native inverse cursor style highlights the full marker. Backspace at the highlighted start first moves to the token end and delegates to Pi's native atomic deletion, preserving its undo snapshot and `onChange` path. Backspace after the marker also deletes the full segment natively. Movement outside a marker and malformed marker-like text delegate to Pi's normal character behavior.

A one-character deletion inside an intact marker removes the whole marker and its path entry. Path-to-marker replacement maps the pre-rewrite cursor offset onto the shorter marker, while marker deletion restores the marker's former start offset; neither rewrite leaves the cursor at prompt end. When history recall supplies an image path, replacement updates Pi's active history state in place instead of calling its public `setText()`, which would exit history browsing and make repeated Up presses recall the same entry. Submission preparation expands every intact marker back to its source path before recorder storage and Pi dispatch, so agent input never receives the display-only tag. Preview state survives an unprocessed early cancellation, then clears once assistant processing begins or a normal turn settles.

## Model image context

Images remain model-visible for the complete user turn that introduced them, then leave later outbound context without changing session history.

Before each model call, proper-base finds the newest user message in Pi's copied context. Image blocks at or after that message remain unchanged, so the model can inspect user attachments and tool-result images across every tool loop in the active turn. Earlier image blocks become short text markers in place, preserving message order and tool-call/result structure without resending binary data.

The `context` event supplies a deep copy, so persisted messages, transcript rendering, exports, resume, and branches keep the original image blocks. A later request that needs an old image must read or send it again.

## Skill context

Each invoked skill stays present exactly once in outbound context, and survives the compaction that would otherwise erase it.

Pi expands `/skill:<name>` into a user message holding the whole `SKILL.md` body followed by the request, then treats that message like any other. Re-invoking the skill appends a second full copy, and compaction summarizes the copy away while the model keeps working under instructions it can no longer read. Bodies run to tens of thousands of characters, so both cost real context.

On the same `context` event as image trimming, proper-base parses user messages with Pi's own skill-block reader. The first copy of a given rendered body is never rewritten, so the cached request prefix stays byte stable across turns; later messages carrying an identical body keep their request and replace the block with a one-line already-loaded note. A changed body, from different arguments or regenerated content, hashes differently and is left intact.

When the context contains a compaction summary, proper-base walks the active branch for skills whose body no longer appears, and prepends the newest body of each to the first user turn after that summary. Restoration reproduces the message shape Pi itself produces rather than inserting a message, so role alternation and turn structure are unchanged. A per-skill character ceiling truncates long bodies and a combined ceiling bounds the total, filled newest first, keeping restored text well under the recent-token window so it cannot re-trigger the compaction that just ran.

The transform is derived from the copied context on every request, so it self-heals across compaction, resume, fork, and branch navigation with nothing persisted. Session history, transcript rendering, and exports keep the original messages.

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

## Prompt clearing and exit

Ctrl+C clears a non-empty prompt without arming Pi's quick double-press exit, so exiting from text requires three presses.

proper-base intercepts the configured `app.clear` action at the main editor. When text exists, it clears the editor, redraws, and resets its empty-prompt exit timer without invoking Pi's native handler. The next Ctrl+C on the now-empty prompt shows `Press Ctrl+C again to exit`; only another press within 500 ms calls the public shutdown API. An initially empty prompt therefore keeps the familiar two-press exit sequence.

The warning is a temporary editor row rendered with the theme's `warning` color, not an extension notification or persisted transcript component. It disappears when the 500 ms exit window closes, any other input cancels the sequence, the second Ctrl+C requests shutdown, or the session tears down.

The timer belongs to the editor wrapper rather than Pi's private `lastSigintTime`, so typing after a warning and then clearing text cannot inherit a stale armed exit. Repeated factory installation refreshes the live TUI, keybinding manager, and extension context without stacking input wrappers or leaving stale timers.

## Prompt cursor navigation

History recall starts at the prompt beginning, Left and Right cross intact image markers atomically, while Home and End retain two-stage row and prompt boundaries.

The editor-navigation wrapper recognizes `[image N]` only when the brackets, label, positive number, and closing bracket are complete. It merges the marker around Pi's existing grapheme segmentation, retaining native paste-marker handling while making image markers atomic for rendering, horizontal and vertical movement, and backward deletion. A cursor anywhere inside that token snaps to its outside boundary in the requested direction; at its start the entire token receives Pi's inverse cursor highlight, and Backspace deletes it through the native editor. Ordinary and malformed text keeps Pi's character movement. Autocomplete and active reverse search retain their own key handling because their wrappers consume navigation before the base cursor rule.

For Home, proper-base reuses Pi's current visual-line map and render width. The first press moves to the start column of the current soft-wrapped row; a second press from that boundary moves to line 0, column 0. The same two-stage rule applies across hard-newline paragraphs, and Home at the full prompt start is a no-op.

When Up or a dedicated previous-history binding changes the prompt text, proper-base places the cursor at line 0, column 0 after native handling. End retains its existing behavior: native Pi handling reaches the current logical line end, then a second press moves to the final column of the final line. Autocomplete keeps native handling, custom editors without Pi's state keep their own behavior, and Ctrl+Shift+Home/End remain fullscreen transcript actions.

## Settled transcript

Completed tools and errors collapse behind expandable lines, while thoughts and updates stay fully visible beside direct model replies.

At `agent_start`, proper-base records the current end of Pi's chat container. Earlier turns stay in their settled compact form, while incomplete components appended for the active run use Pi's native renderer unchanged. `message_end` and `tool_execution_end` mark matching assistant and tool components complete, but active rendering compacts eligible errors and tools only after a later transcript component renders non-empty text. Blank components and the `Working...` indicator do not count, so a finished section does not shrink while Pi waits for the next response token. Thinking and tool-calling text stay fully rendered, and parallel tools settle independently once later output exists. `agent_settled` clears the run boundary, restores collapsed global tool state, compacts eligible items in the completed run, and requests the final redraw.

Idle rendering walks components in their original transcript order. Thinking blocks and assistant text from tool-free model messages keep their native rendering. Tool-calling text and agent-owned status components also remain complete, with one blank row above and below updates so they stay legible inside long runs of compact entries. Components present when proper-base installs, plus components appended inside an `agent_start` through `agent_settled` boundary, are agent-owned. Every owned tool and error becomes its own one-line summary at the position where the component occurred; tool cards show the tool name plus a primary path, command, pattern, query, task, URL, or action argument. MCP gateway cards retain the `mcp` name and append their top-level `tool` argument. Later assistant responses therefore never precede the intermediary output that produced them.

Components appended while Pi is idle are not agent-owned and keep native rendering. This preserves output from slash commands such as `/session`, extension notifications, and other command UI instead of relabeling them as model updates.

Each detail summary has independent expansion state. Summary headers use a bold `›` or `⌄` disclosure marker in the theme's brighter `borderAccent` color; click and keybinding instructions are omitted. Type remains explicit in text and also receives a stable semantic color: tools use `mdLink`, and failures use `error`. The same semantic color carries onto that item's bottom collapse control, while labels and disclosure markers keep meaning available without color. Rendering records each header and collapse control's document row and clickable width without emitting an OSC 8 URI, so terminals do not expose internal controls as hyperlinks.

In fullscreen mode, a mouse listener converts a left click into the primary scroll view's content row, confirms that the expected control is visible there, toggles only that item, fully expands a selected tool card, and consumes the press and release before Pi begins text selection. Pi advances the scroll offset the moment a wheel or keyboard scroll arrives but repaints on a throttle, so a click that follows a scroll can map to a content row the painted frame never showed. When the mapped row does not carry the expected control, the listener falls back to the painted screen line and toggles it only when exactly one control matches that text. Expanded detail ends with a compact left-aligned inverse-video `collapse` control, so long items can close without returning to their header. Pi's configured `app.tools.expand` binding remains a global expand/collapse fallback and resets per-item overrides when used.

The transformation is display-only. Session messages and component order remain unchanged, active rendering never loses live output, and unloading proper-base restores Pi's original chat-container renderer and `invalidate` hook. The wrapper installs only when Pi's current document/chat container shape is present; an incompatible custom renderer keeps its native transcript.

Pi re-renders the full component tree every frame and relies on each component's internal cache, so the wrapper must not rebuild component content per frame. Rendering a subset of an assistant message swaps content via `updateContent`, which recreates the component's Markdown children and discards their caches; those subset renders are therefore memoized per component, message identity, width, and content-part indices, and recomputed only when one of these changes. Tool detail rows call `setExpanded` only when the desired state differs from the component's current state, because a redundant call rebuilds the tool's result renderer and re-sanitizes full outputs. A `chat.invalidate` wrapper drops the memoized lines whenever Pi invalidates components (theme or terminal cell changes), keeping stale styling out of settled rows. Without this, long sessions pinned the event loop at full CPU: every 16ms frame re-parsed the entire transcript's markdown.

## Pinned transcript scrolling

Pinned scrolling comes from pi's native fullscreen renderer; proper-base keeps that renderer switch available and changes which keys target it.

With `tuiMode` set to `fullscreen`, pi owns transcript scrolling while queued messages, status, widgets, editor, and footer remain fixed at the bottom. proper-base does not implement a second transcript viewport; it releases inactive overlays so renderer changes remain unblocked. Mouse selection, wheel scrolling, scrollbar dragging, and link clicks remain under Pi's native fullscreen renderer.

A non-empty interactive submission calls the native `scrollToBottom()` before input processing continues, restoring follow mode so the new user message and response are visible. Extension-origin input leaves viewport position unchanged.

Pi normally gives fullscreen transcript actions priority on unmodified Home, End, PageUp, and PageDown. The editor factory rewrites those four `tui.altScreen` action bindings on pi's shared keybinding manager to Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown. The unmodified and Shift-only keys therefore remain available to the terminal and pi's native editor actions.

Pi reloads `keybindings.json` after extension `session_start` handlers, so proper-base wraps the manager's `reload()` method once and reapplies its four overrides after the native file load. The wrapper delegates through a symbol-stored mutable controller: hot reload replaces the controller's apply callback, preventing a closure from an older extension version from restoring obsolete bindings after the new `session_start`. A legacy boolean marker is upgraded by wrapping its stale reload handler so the newest apply pass runs last. Unrelated user bindings are preserved, repeated factory installation cannot stack current wrappers or drift values, and these four transcript bindings intentionally override user values while proper-base is active.

## Smart fullscreen selection

Double-clicking transcript text expands common terminal tokens while retaining Pi's native selection, drag, highlight, viewport, and clipboard behavior.

Pi's fullscreen renderer already maps mouse coordinates into scroll-view content, detects double clicks, and asks its internal word-range resolver for a selection. proper-base wraps only that resolver. For points inside a scroll view above the prompt, one visual-line URL, file path, command flag, dotted or qualified identifier, or matching quoted value becomes the range. ANSI and OSC sequences do not affect visible columns.

Unrecognized text, prompt and footer rows, regular TUI mode, and renderer shapes without both internal selection methods use Pi's native word selection unchanged. The wrapper restores the original method during session shutdown and refuses to stack on repeated editor-factory installation.

This is deliberately a guarded compatibility layer over private pi-tui methods because the extension API exposes no selection-range hook. A future rename disables token expansion rather than mouse selection. Tokens split across rendered rows remain separate, and proper-base's clickable compact tool and error rows keep their single-click expansion behavior instead of participating in double-click selection.

## Jump-to-bottom button

A scrolled-up viewport shows a clickable jump-to-bottom button on the row directly above the prompt.

The editor's `render()` prepends one right-aligned inverse-video row reading `↓ jump to bottom` whenever the renderer reports a viewport that is not following output, falling back to a bare arrow on narrow terminals and to no row when even that cannot fit. The row belongs to the editor's own output rather than an overlay: any visible overlay entry disables Pi's scrollbar hit testing, which is the gesture in use while the button is on screen. The wrapper installs before the image-preview and autocomplete-detail wrappers so both overlay margins account for the extra row.

Installation is skipped unless the renderer exposes the alternate-screen viewport surface, so regular mode, where the terminal owns scrolling, is untouched. Pi's alternate-screen renderer registers its own input listener in its constructor and consumes every mouse event, so the click listener moves itself to the front of the renderer's listener set. A left press or release inside the button's screen cells is consumed, and the press scrolls the viewport to the end; a renamed internal listener field leaves the button rendered but inert rather than breaking. The button's screen row is derived from the terminal height minus the editor rows and the rows below the editor, matching the overlay anchoring described under `Autocomplete description pane`.

## Prompt jump chips

The transcript's top-right corner carries two always-visible arrow chips that walk the viewport between user prompts.

The chips render as bare `↑` and `↓` glyphs in the theme's muted foreground with no background of their own, so the transcript reads through them instead of a filled button block. Each keeps a three-column click target around its glyph. Arrowheads and box-drawing carets are deliberately avoided because common monospace fonts leave those code points blank.

Compositing resets the cells it covers to the terminal default, which cuts a visible hole through a colored row such as a user message band. The chips therefore replay the styles already active at their own start column, taken from the covered slice, before their foreground color, so the row's background continues underneath them.

That slice can end part-way through an escape sequence, so the styles are collected with a single bounded pattern match rather than a hand-rolled cursor scan. Everything here runs inside the renderer's own frame, where a loop that fails to terminate freezes the whole application instead of degrading one row.

For the same reason the decoration is failure-contained: the chips, the reading, and their colors are all produced inside a guard, and anything thrown drops the decoration for that frame and clears the click region so dead cells cannot keep swallowing mouse input. The renderer then composites the frame exactly as it would without the extension. Colors are requested per frame rather than once at installation, so a theme that rejects the request fails inside that guard instead of propagating out of the editor factory.

The chips composite onto row 0 of the finished alternate screen, one column clear of the scrollbar, by wrapping the renderer's flash compositor. That keeps them outside Pi's overlay stack, which would otherwise disable scrollbar dragging exactly as described under `Jump-to-bottom button`, and lets a transient flash message still win the row because flashes composite last. A terminal too narrow for both chips renders neither and disables their hit region.

Directly beneath the chips, a `position/total` reading appears while the viewport is scrolled away from output and disappears once it follows the newest output again. It centres on the chip pair rather than the right margin, because each chip carries a padding column that would otherwise pull the reading off to one side, and it clamps to the same right gap when it grows wider than the chips. An odd-width reading sits half a cell off an even-width chip pair, which is the closest a character grid allows. The reading uses the theme's dim foreground against the chips' muted one, so it reads as secondary rather than as a second control. Both numbers come from the same prompt scan the chips navigate with, counting every user prompt in the transcript and treating the last one at or above the viewport top as the current position. Scrolling above the first prompt reads position zero, so one down click always advances the reading by one, and a transcript with no prompts shows no reading at all. The scan reuses the renderer's previous-frame layout, so a forced full redraw hides the reading for that one frame.

A jump scans the primary scroll view's content lines outward from the current scroll position for the next OSC 133 zone start that opens a user prompt. Pi marks both user and assistant blocks with the same zone sequence, so a prompt is recognized by the background-padded box row that follows its markers; assistant blocks open with an empty spacer row instead. The up chip stops at the first prompt above and otherwise does nothing, while the down chip past the last prompt scrolls to the transcript end.

Installation, listener priority, and press/release consumption match the jump-to-bottom button. Renderers without the viewport scroll surface, including regular mode, install nothing.

The renderer instance outlives an extension reload, unlike the editor the jump-to-bottom button attaches to, so installation takes over any wrapper a previous extension instance left behind instead of yielding to it. Because a reload runs the incoming instance's editor factory before the outgoing instance shuts down, disposal is identity-guarded and a stale disposer arriving afterwards is a no-op; a live disposal restores the renderer's own flash compositor and drops the extension's property when it was inherited.

## Footer presentation

The editor factory locates pi's mounted built-in `FooterComponent` and decorates its `render()` output in place.

When the stats row contains a dollar cost, cumulative input, output, cache, cache-hit, and cost fields move to the right side of the top path row. The path truncates to make room. Context usage remains left on the second row, while the existing provider/model/thinking segment is re-padded with one trailing column reserved. Narrow layouts that cannot retain a useful path keep Pi's native arrangement.

Pi's native render right-aligns the model segment against the original one-line width and silently truncates its tail — cutting decorations such as CLIProxyAPI's `fast` or `paused` labels — before this layout frees the usage block's columns. Whenever the layout applies, the footer therefore renders a second time at the original width plus the usage width, so pi's provider-prefix and truncation decisions match the space actually available after the move; the wide result is adopted only when its usage capture matches, and any extension status rows are re-truncated to the real width.

`max` and the router-provided `ultra` level render each character with a different rainbow color. A bright highlight crosses the word on a four-second cycle; a 120 ms unref'd timer requests redraws only while either level is active and the footer remains mounted. Changing to another effort stops the timer, and footer disposal clears it.

After layout, stable low-chroma truecolors identify each metric without changing its label: slate path, sage branch, steel-blue input, sage output, lavender cache read, clay cache write, teal cache hit, ochre cost, and dusty-rose context. Context becomes amber above 70% and muted red above 90%. The active model stays purple; off through xhigh use pi's semantic thinking-level colors, and maximum effort uses the animation above. Extension statuses and components other than the built-in footer are not modified.

`session_shutdown` restores the built-in footer methods and stops the animation before pi invalidates the outgoing extension context. If `render()` was inherited, cleanup removes proper-base's instance override instead of assigning the captured prototype function. A reused footer can therefore observe prototype decorations reinstalled by other extensions, including CLIProxyAPI's Fast label, while the replacement session binds fresh proper-base decoration without touching stale context.

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

## Commit message guard

A `tool_call` handler blocks `bash` and `quill_execute` commands whose `git commit` invocation violates the house commit rules.

The guard is a TypeScript port of the Claude Code `commit_message_validator.py` PreToolUse hook, without its amend guard. Commands that do not mention both `git` and `commit` are never tokenized, so unrelated commands with heredocs or odd quoting pass untouched. When both words appear, a shell tokenizer requires one direct `git … commit …` invocation: wrappers, shell wrappers, env or assignment prefixes, compound shell, and dynamic tokens are rejected, as are message-mutating flags such as `-F`, `-e`, `--signoff`, `--fixup`, and `--no-verify`. The literal `-m`/`--message` paragraphs join with blank lines and must keep the subject and every non-trailer line within 72 characters, a blank second line, and no forbidden attribution lines; the final trailer block is exempt from line length.

A blocked call returns every validation error in one reason so the model can fix the whole message in a single retry, and pi blocks the tool fail-safe if the handler itself throws. Commands naming git commit that the tokenizer cannot parse are denied rather than allowed, because passing on parse failure would let `-F` heredoc forms through.

## Transient stream retry

A `message_end` handler makes CLIProxyAPI's `empty_stream` failure retryable instead of turn-fatal.

CLIProxyAPI can close a stream before the first payload; pi-ai surfaces this as a `Codex error: empty_stream: upstream stream closed before first payload` assistant error that matches none of pi's retryable patterns, so the turn dies. The handler rewrites such errored assistant messages with the `network error:` prefix, after which pi's normal retry budget and backoff apply.

Matching is by error text alone, not provider ID, because the wording is CPA-specific. Already-prefixed messages pass through untouched, so the normalizer composes with the provider package's own `message_end` normalizer, which covers different patterns; pi chains `message_end` transforms across extensions in load order.

## Reload and composition

A global symbol tags the editor factory and remembers the factory it wrapped.

The editor and recorder symbol keys retain their legacy `pi-proper-history` namespace so recorded behavior survives both package renames. The fullscreen keybinding installer also recognizes the prior `pi-proper-customs.fullscreen-keybindings` marker and migrates its mutable controller to the `pi-proper-base` namespace.

Because `session_start` runs on reload, resume, and fork, the next pass unwraps proper-base's previous factory before wrapping again. This prevents duplicate seeding and an ever-growing wrapper chain. Separate editor, TUI, and footer symbols prevent wrappers, overlays, and timers from stacking; repeated footer installation refreshes its live context, while `session_shutdown` removes it before context invalidation. Extensions loaded later may still replace the editor or footer, so load order controls the final renderer and keybindings.

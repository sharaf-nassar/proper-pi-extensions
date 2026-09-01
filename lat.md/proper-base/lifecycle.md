# Prompt history lifecycle

Each `session_start` rebuilds the editor wrapper and seeds a bounded history assembled for the active working directory.

## Startup sequence

Startup compacts the project store when needed, loads only recorder-captured history, unwraps any prior proper-base wrapper, and installs a new factory around the current editor factory.

If another extension already provides an editor, that factory remains the base. Otherwise proper-base creates pi's `CustomEditor`. A history guard captures the editor's original append method, blocks Pi's later session replay, and adds trusted store prompts oldest first so the first Up press returns the newest entry.

## Session listing

`/resume` reads only what its rows show, so the picker draws before the transcripts behind it are read.

Pi's `SessionManager.list` and `listAll` build every `SessionInfo` by streaming each session file, `JSON.parse`-ing every line, and concatenating all message text into `allMessagesText`. Only the picker's search reads that field, and only after the user types, so a project with hundreds of megabytes of transcripts waits seconds for rows it already has the data to draw. Extension load replaces both static methods once, tagged by a global symbol because the class outlives every session.

The replacements make two cheap passes per file. Session entries are one JSON object per line, so a byte-prefix test anchored to the preceding newline classifies a line without decoding it. The first pass reads the head until the first user message and stops; because it abandons almost every file part-way, it destroys the read stream rather than only closing the line reader, which would leave the descriptor open. The second scans the file as raw bytes, counting message entries, tracking the newest rename offset, and taking the write time of the last user or assistant entry. Nothing assembles a line: single entries reach tens of megabytes, so buffering one would cost more than the scan it serves. Consecutive reads overlap by one entry head and stop one byte short of that overlap, so an entry near a boundary is taken exactly once, with its role and time in view; a final flush covers the last overlap, where a short head is all the file has.

Two values are deliberately approximate. `modified` uses the entry's write time rather than the message's start time, which sits after the content and would cost a full-line read; the difference is the duration of one response. The file's own mtime is not a substitute, because branching from a session appends to it hours after its last message. `name` comes from re-reading the newest rename entry at its recorded offset rather than from the scan itself.

`allMessagesText` is returned empty and refilled by a detached backfill over the same objects the picker holds, newest first. Search matches session ID, name, and working directory immediately, and message bodies as the backfill reaches them; a new listing cancels the previous backfill. Nothing else cancels one, so the final backfill of a session runs to completion in the background. Its cost is the read pi already performed before drawing the picker, moved after it rather than added.

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

The first Ctrl+R saves the current draft and cursor, exits Pi's native history-browsing state — restoring the large-paste registry entries the draft still references, because pi-tui's `setText()` clears that registry and would otherwise orphan the draft's `[paste #N]` markers — and shows the newest recorded prompt. Typing adds a case-sensitive substring query, Backspace removes query characters, and repeated Ctrl+R moves to the next older match. New recorder-approved submissions join the searchable list immediately, which stays bounded by the same 200-entry lifecycle limit.

While searching, the editor's bottom border becomes `(reverse-i-search)\`query':`; a failed lookup keeps the last match visible and changes the label to `failing reverse-i-search`. Enter accepts and submits the match, Esc accepts it for editing, and Ctrl+G restores the original draft and cursor. Other control or navigation input accepts the match before delegating to the editor.

The wrapper owns Ctrl+R only while the main prompt editor is focused, so session-picker rename and other modal controls keep their native shortcuts. Starting search closes active autocomplete, repeated editor-factory installation refreshes the bounded prompt list without stacking wrappers, and compatible custom editors retain their own submission and rendering behavior beneath the search layer.

## Submission interception

Recording wraps the editor instance's `onSubmit` property rather than relying on pi's input event.

The property descriptor wraps both an existing handler and handlers assigned later by pi. A preparation step expands display-only image markers before recording and delegation, so history and Pi receive usable paths. Recording occurs before delegation and immediately appends the trusted text through the history guard; Pi's later `addToHistory()` call is ignored. The `Recallable submissions` filter decides whether the prepared text reaches the store, and symbol markers prevent wrapper stacking.

The early-cancellation capture keeps its own narrower rule: any leading `/` or `!` disqualifies a submission from restore, regardless of whether history would recall it.

## Clipboard images

Clipboard image paths use compact editor markers while their source paths remain visible and available to agents.

proper-base binds Pi's `app.clipboard.pasteImage` action to Ctrl+V and Ctrl+Shift+V; either chord invokes Pi's native image-or-text clipboard handler when the terminal forwards it. Every insertion route detects readable absolute `pi-clipboard-*` GIF, JPEG, PNG, or WebP paths and replaces each with `[image N]`. Active markers render in a non-capturing overlay above the editor. Image-capable terminals show compact previews, text-only terminals show full-width marker and source-path rows, and multiple entries stack. An autocomplete description temporarily hides the image overlay to avoid overlap. The overlay's bottom margin — measured by re-rendering the components below the editor — is computed only while a preview is visible, so frames without one skip that traversal.

At extension load, `TERM_PROGRAM=Scribe` promotes Pi's detected image capability to Kitty and enables OSC 8 hyperlinks before the fullscreen renderer snapshots them. This restores previews now that Scribe preserves Kitty placement inside synchronized output, and makes Pi render markdown links as OSC 8 hyperlinks. Pi reopens the OSC 8 sequence on every wrapped physical row, so Scribe's ctrl+click resolves the full URL on any row of a hard-wrapped link instead of that row's text fragment. Other terminals retain Pi's native capability detection.

Before creating a terminal image, proper-base compares the source dimensions with the 24-by-6-cell preview's current pixel envelope. A larger PNG, JPEG, GIF, or WebP source is decoded and auto-oriented asynchronously by the declared `sharp` runtime dependency, resized with `fit: inside` and `withoutEnlargement`, and encoded as a bounded PNG; animated inputs use the first page. The original clipboard file remains untouched and still expands into submitted prompts. `sharp` performs work through libuv/libvips rather than synchronously blocking Pi, and its five-second pipeline timeout bounds damaged or pathological input. Its npm optional artifacts cover macOS arm64, macOS x64 (10.15+), glibc/musl Linux, and other supported platforms under the package's Node 20.9+ floor, which proper-base's Node 22.19+ requirement exceeds.

While conversion runs, the overlay renders pi-tui's existing accent-coloured braille `Loader` with no message, matching Pi's native working animation instead of flashing the marker path. If decoding, resize, encoding, or timeout fails, the animation stops and the overlay shows the marker-and-path fallback. Deletion, submission, clear, disposal, and overlay release destroy the active `sharp` pipeline and stop the loader timer; late promise results are ignored. This keeps focus-triggered terminal scene replay below bounded queue limits without an external `magick` or `convert` command.

Scribe can lose its painted scene across pane focus while Pi's fullscreen renderer still caches the Kitty source as uploaded. proper-base guards the current pi-tui private compatibility point by wrapping `handleViewportInput`; on focus-in (`CSI I`) with an active preview, it clears only pi-tui's uploaded-Kitty cache and requests a forced redraw. The existing `Image` lines then retransmit their bounded sources. Disposal restores the exact prior input handler, and incompatible TUI implementations skip the hook.

Left and Right treat every syntactically intact `[image N]` marker as one prompt token: Left from the end or interior lands at its start, and Right from the start or interior lands after it. proper-base wraps Pi's private editor segmenter so the renderer receives the complete marker as one grapheme; when the cursor is at that token position, Pi's native inverse cursor style highlights the full marker. Backspace at the highlighted start first moves to the token end and delegates to Pi's native atomic deletion, preserving its undo snapshot and `onChange` path. Backspace after the marker also deletes the full segment natively. Movement outside a marker and malformed marker-like text delegate to Pi's normal character behavior.

A one-character deletion inside an intact marker removes the whole marker and its path entry. Path-to-marker replacement maps the pre-rewrite cursor offset onto the shorter marker, while marker deletion restores the marker's former start offset; neither rewrite leaves the cursor at prompt end. Both rewrites go through pi-tui's `setText()`, which clears its large-paste registry, so the rewrite restores the `[paste #N]` entries the new text still references — otherwise pasting an image after a large text paste would orphan the paste marker and submit the literal tag instead of the pasted content. When history recall supplies an image path, replacement updates Pi's active history state in place instead of calling its public `setText()`, which would exit history browsing and make repeated Up presses recall the same entry. Submission preparation expands every intact marker back to its source path before recorder storage and Pi dispatch, so agent input never receives the display-only tag. Preview state survives an unprocessed early cancellation, then clears once assistant processing begins or a normal turn settles — but only for markers no longer present in the editor. An image pasted while the agent runs registers a marker the user has not yet submitted; the clear at the next assistant message or settle spares it, so its later submission still expands to the source path instead of sending the literal `[image N]` tag to the model. Disposal always drops every preview.

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

The wrapper measures the rows beneath the editor — which re-renders the components below it — only while a selected description exists, so ordinary frames skip that traversal.

The overlay is full-width, square-bordered, and anchored above the editor plus any widgets and footer rows beneath it. Description text uses the same theme-selected accent as the active autocomplete item, while the border retains its normal theme color. It expands upward over transcript content, so descriptions of different lengths never move the prompt, autocomplete list, or footer. Newlines are normalized and text wraps inside the box; descriptions exceeding the terminal area above the prompt end with an ellipsis.

Cursor movement updates the selected item before the next render. The overlay exists only while its editor remains mounted and a selected description exists. Losing either condition calls the overlay handle's `hide()` method, removing the entry rather than merely making it invisible. Unmount detection queues removal after the current overlay-visibility pass so the stack is not mutated while pi iterates it.

This lifecycle matters when pi changes renderers: its regular/fullscreen switch refuses to run while any overlay entry exists, including invisible non-capturing entries. Releasing the detail overlay keeps that switch available, and the next editor render recreates the box against the active renderer. Editors without pi's autocomplete-list state render exactly as before.

This scope covers editor autocomplete, including skills and slash commands. proper-base triggers command completion for a slash segment at the beginning of the first line, after whitespace anywhere in a line, or at the beginning of later prompt lines. The provider evaluates only the active slash segment, including command arguments, and completion splices the result back into that segment without changing surrounding prompt text. Slashes embedded in paths or URLs are not command boundaries. Accepting a command completion also reopens suggestions immediately: pi's editor cancels the list on acceptance and re-triggers only from typed characters, so an accepted command's argument menu — `/model`'s list — stayed hidden until another keystroke. Acceptance is recognized as a prompt change during the list's open-to-closed transition that leaves a one-segment `/command ` token before the cursor; a dismissal changes no text and must not reopen the list just closed, and a completed multi-segment file path is not a command token, so no menu pops behind it. The reverse gap is patched the same way: pi refreshes an open list only from single printable keys and backspace, so word and line deletes — alt+backspace, ctrl+w, ctrl+u, ctrl+k — edited the prompt while the menu lingered on stale text. When such a key changes the prompt under a still-open list, the wrapper re-requests suggestions with the current text, and an emptied context closes the list through the editor's own no-suggestions path. Custom editors without Pi's autocomplete state and trigger method remain untouched.

The same provider wrapper sorts every `/model ` result by displayed model ID descending using case-insensitive, numeric-aware comparison through one shared collator, so the per-keystroke sort does not construct a collator per comparison. For a non-empty query, whitespace-delimited terms must each occur in the candidate's label, value, or description; when strict matches exist, unrelated fuzzy candidates are removed before sorting. If strict matching finds nothing, Pi's fuzzy candidate set remains available but is still sorted descending. Non-model suggestions retain provider order. When Enter or Tab accepts a model completion, the editor wrapper verifies that Pi produced the exact selected `provider/model` command and immediately invokes Pi's submission path. Enter reuses its confirm key; Tab calls the editor's native submit routine, with an Enter fallback for compatible custom editors. Tab remains completion-only outside `/model ` arguments, and editors without Pi's autocomplete internals are untouched. Built-in modal selectors do not pass through the editor factory and are outside the extension API.

## Prompt newline keys

Alt+Enter joins Pi's own newline chords instead of queuing a follow-up.

Shift+Enter and Ctrl+J are already Pi's `tui.input.newLine` defaults, so proper-base does not restate them; a user who rebinds that action keeps exactly the aliases they chose. Only Alt+Enter is added, and only because it must first leave `app.message.followUp`, whose application-level handling would otherwise consume the chord before the editor can insert a line. The binding is reapplied after native keybinding reloads.

Whether Shift+Enter reaches Pi at all is a terminal concern, not an extension one: the chord is distinguishable only when the terminal reports modifiers through the Kitty keyboard protocol or a compatible xterm encoding. Alt+Enter is the alias that survives terminals without it.

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

Extension entry components that carry expansion state are driven from the same per-item state and register their first non-blank rendered row as a click target. Their renderers draw their own header and disclosure marker, so proper-base neither relabels them nor adds a bottom collapse control; without the hit row those markers would move only under `app.tools.expand`.

Each detail summary has independent expansion state. Summary headers use a bold `›` or `⌄` disclosure marker in the theme's brighter `borderAccent` color; click and keybinding instructions are omitted. Type remains explicit in text and also receives a stable semantic color: tools use `mdLink`, and failures use `error`. The same semantic color carries onto that item's bottom collapse control, while labels and disclosure markers keep meaning available without color. Rendering records each header and collapse control's document row and clickable width without emitting an OSC 8 URI, so terminals do not expose internal controls as hyperlinks.

In fullscreen mode, a mouse listener converts a left click into the primary scroll view's content row, confirms that the expected control is visible there, toggles only that item, fully expands a selected tool card, and consumes the press and release before Pi begins text selection. Pi advances the scroll offset the moment a wheel or keyboard scroll arrives but repaints on a throttle, so a click that follows a scroll can map to a content row the painted frame never showed. When the mapped row does not carry the expected control, the listener falls back to the painted screen line and toggles it only when exactly one control matches that text. Expanded detail ends with a compact left-aligned inverse-video `collapse` control, so long items can close without returning to their header. Pi's configured `app.tools.expand` binding remains a global expand/collapse fallback and resets per-item overrides when used.

The transformation is display-only. Session messages and component order remain unchanged, active rendering never loses live output, and unloading proper-base restores Pi's original chat-container renderer and `invalidate` hook. The wrapper installs only when Pi's current document/chat container shape is present; an incompatible custom renderer keeps its native transcript.

Pi re-renders the full component tree every frame and relies on each component's internal cache, so the wrapper must not rebuild component content per frame. Rendering a subset of an assistant message swaps content via `updateContent`, which recreates the component's Markdown children and discards their caches; those subset renders are therefore memoized per component, message identity, width, and content-part indices, and recomputed only when one of these changes. Tool detail rows call `setExpanded` only when the desired state differs from the component's current state, because a redundant call rebuilds the tool's result renderer and re-sanitizes full outputs. A `chat.invalidate` wrapper drops the memoized lines whenever Pi invalidates components (theme or terminal cell changes), keeping stale styling out of settled rows. Without this, long sessions pinned the event loop at full CPU: every 16ms frame re-parsed the entire transcript's markdown.

## Pinned transcript scrolling

Pinned scrolling comes from pi's native fullscreen renderer; proper-base keeps that renderer switch available and changes which keys target it.

With `tuiMode` set to `fullscreen`, pi owns transcript scrolling while queued messages, status, widgets, editor, and footer remain fixed at the bottom. proper-base does not implement a second transcript viewport; it releases inactive overlays so renderer changes remain unblocked. Mouse selection, wheel routing, scrollbar dragging, and link clicks remain under Pi's native fullscreen renderer; only the wheel's per-event line step changes, per the wheel scroll rate below.

A non-empty interactive submission calls the native `scrollToBottom()` before input processing continues, restoring follow mode so the new user message and response are visible. Extension-origin input leaves viewport position unchanged.

Pi normally gives fullscreen transcript actions priority on unmodified Home, End, PageUp, and PageDown. The editor factory rewrites those four `tui.altScreen` action bindings on pi's shared keybinding manager to Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown. The unmodified and Shift-only keys therefore remain available to the terminal and pi's native editor actions.

Pi reloads `keybindings.json` after extension `session_start` handlers, so proper-base wraps the manager's `reload()` method once and reapplies its four overrides after the native file load. The wrapper delegates through a symbol-stored mutable controller: hot reload replaces the controller's apply callback, preventing a closure from an older extension version from restoring obsolete bindings after the new `session_start`. A legacy boolean marker is upgraded by wrapping its stale reload handler so the newest apply pass runs last. Unrelated user bindings are preserved, repeated factory installation cannot stack current wrappers or drift values, and these four transcript bindings intentionally override user values while proper-base is active.

## Wheel scroll rate

A mouse-wheel event moves the fullscreen transcript three lines by default instead of pi's one, matching how terminals scroll their native scrollback.

Pi's fullscreen renderer constructs itself with a one-line wheel step: the `wheelScrollLines` option defaults to 1, and pi neither passes an override nor exposes a setting for it. Terminals typically multiply a wheel notch to about three lines with acceleration, so pi's fullscreen transcript scrolls noticeably slower than every other terminal surface. No escape sequence lets an application query the terminal's own wheel configuration, so the editor factory raises the renderer's numeric `wheelScrollLines` field to the 3-line application convention shared by vim and less.

A `PROPER_WHEEL_SCROLL_LINES` environment variable overrides the step per terminal — each terminal's profile can export the value matching its native behavior — and any non-positive or unparseable value falls back to the default, with fractional input floored. SGR wheel reports cannot distinguish one discrete mouse notch from one line of a high-rate trackpad stream, so a terminal that emits one report per native line scrolls proportionally faster; exporting an override of 1 there restores pi's original pace. Only a renderer already exposing a numeric `wheelScrollLines` is touched: regular mode owns no wheel input, and a renamed upstream field fails open to pi's native behavior.

## Smart fullscreen selection

Double-clicking transcript text expands common terminal tokens while retaining Pi's native selection, drag, highlight, viewport, and clipboard behavior.

Pi's fullscreen renderer already maps mouse coordinates into scroll-view content, detects double clicks, and asks its internal word-range resolver for a selection. proper-base wraps only that resolver. For points inside a scroll view above the prompt, one visual-line URL, file path, command flag, dotted or qualified identifier, or matching quoted value becomes the range. ANSI and OSC sequences do not affect visible columns.

Unrecognized text, prompt and footer rows, regular TUI mode, and renderer shapes without both internal selection methods use Pi's native word selection unchanged. The wrapper restores the original method during session shutdown and refuses to stack on repeated editor-factory installation.

This is deliberately a guarded compatibility layer over private pi-tui methods because the extension API exposes no selection-range hook. A future rename disables token expansion rather than mouse selection. Tokens split across rendered rows remain separate, and proper-base's clickable compact tool and error rows keep their single-click expansion behavior instead of participating in double-click selection.

## Hyperlink identity

Every physical row of one wrapped transcript hyperlink shares one OSC 8 id, so id-aware terminals hover-highlight and activate the whole link as a unit.

Pi emits OSC 8 hyperlinks without an id and reopens the sequence on each wrapped row, so a terminal following the OSC 8 spec assigns every row its own link identity: activation still resolves the full URI, but hovering highlights only the row under the pointer. proper-base wraps the fullscreen renderer's terminal `write` and gives each anonymous open an `id=` parameter derived from an FNV-1a hash of its URI. Rows of one logical link then compare equal, which is the exact condition Scribe's existing adjacent-row OSC 8 span join and kitty-style id grouping key on. Two distinct links to the same URI share an id; they open the same target, so broader hover grouping is the accepted trade-off.

Closes, opens that already carry params, and writes without an anonymous open pass through untouched — a sequence split across writes simply goes untagged. Terminal shapes without a `write` method install nothing, repeated editor-factory installation reuses the live wrapper, and disposal restores the original method only while the wrapper is still installed.

## Selection dismissal

A fullscreen mouse selection disappears on the next keystroke or paste instead of surviving typing as a stale highlight.

Pi's renderer clears its selection on focus loss and on the next mouse press, but never on keyboard input, and the highlight is anchored to screen rows rather than content: left standing, it repaints whatever each new frame places on those rows while typing changes the transcript beneath it. The clipboard copy already happened on mouse release, so dropping the highlight loses nothing.

An input listener registered after the renderer's constructor-installed viewport listener sees only input the viewport declined, so mouse gestures, wheel events, and viewport scroll keys keep the selection, matching terminal convention. Input without an escape prefix, a bracketed paste, and any parseable key dismiss it; key-release events and terminal reports such as cell-size responses do not, and a selection still being dragged is left to its own gesture. Keys currently bound to Pi's `app.message.copy` action are also preserved: since Pi 0.84.4 that action copies the active selection when `fullscreenCopyOnSelect` is disabled, and it fires at the editor after this listener runs, so dismissing on its keystroke would clear the selection before the copy reads it. Dismissal resets the same private fields the renderer's focus-loss branch resets and never consumes the input, so the keystroke still reaches the editor.

Like smart selection, this is a guarded compatibility layer over private renderer state: regular mode and renderer shapes without the selection surface install nothing, and a field rename disables dismissal rather than breaking selection. The renderer outlives an extension reload, so installation takes over the previous instance's listener and a stale disposer is identity-guarded into a no-op.

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

Directly beneath the chips, a `position/total` reading appears while the viewport is scrolled away from output and disappears once it follows the newest output again. It centres on the chip pair rather than the right margin, because each chip carries a padding column that would otherwise pull the reading off to one side, and it clamps to the same right gap when it grows wider than the chips. An odd-width reading sits half a cell off an even-width chip pair, which is the closest a character grid allows. The reading uses the theme's dim foreground against the chips' muted one, so it reads as secondary rather than as a second control. Both numbers come from the same prompt scan the chips navigate with, counting every user prompt in the transcript and treating the last one at or above the viewport top as the current position. Scrolling above the first prompt reads position zero, so one down click always advances the reading by one, and a transcript with no prompts shows no reading at all. The scan reuses the renderer's previous-frame layout, so a forced full redraw hides the reading for that one frame. The scan is also cached on the transcript's line count and viewport position and reruns only when either changes, so a scrolled-up viewport does not rescan every transcript line each frame; an in-place rewrite that keeps the line count can show a stale reading until the next scroll or append.

A jump scans the primary scroll view's content lines outward from the current scroll position for the next OSC 133 zone start that opens a user prompt. Pi marks both user and assistant blocks with the same zone sequence, so a prompt is recognized by the background-padded box row that follows its markers; assistant blocks open with an empty spacer row instead. The up chip stops at the first prompt above and otherwise does nothing, while the down chip past the last prompt scrolls to the transcript end.

Installation, listener priority, and press/release consumption match the jump-to-bottom button. Renderers without the viewport scroll surface, including regular mode, install nothing.

The renderer instance outlives an extension reload, unlike the editor the jump-to-bottom button attaches to, so installation takes over any wrapper a previous extension instance left behind instead of yielding to it. Because a reload runs the incoming instance's editor factory before the outgoing instance shuts down, disposal is identity-guarded and a stale disposer arriving afterwards is a no-op; a live disposal restores the renderer's own flash compositor and drops the extension's property when it was inherited.

## Session action rail

A one-cell stack of clickable, uniquely colored, type-relevant symbols along the transcript's right edge marks each action in the session; clicking one scrolls the viewport to that action.

The action list comes from the settled-transcript renderer rather than from screen text. While it assembles the chat container's lines, it records one outline entry per visible action — user prompt or skill invocation, assistant reply, tool call, failed tool or errored reply — at the scroll-content row where that action's first line lands, in both the collapsed and the live regions. Screen scanning cannot supply this: tool rows carry no zone markers, and the compact renderer re-renders one assistant message per content subset, which would multiply its marker rows. An assistant message whose reply was only tool calls emits no lines of its own and gets no entry, so a long tool loop reads as its tools instead of marker pairs. The entries carry the same document-row offset as the compact renderer's click targets, so a recorded row is directly a scroll position.

Each entry also carries the action's short type name: `prompt` for user turns, `reply` for assistant text, and the tool's own name for tool calls and failures. The name travels in the outline because only the transcript renderer holds the components; the rail never reaches into them, and it derives both a symbol and a color from that name.

The rail paints inside the same guarded flash-compositor decoration as the prompt jump chips — a second `compositeFlashes` wrapper would defeat that decoration's identity-guarded reinstall — as a single cell per action, one column clear of the scrollbar. Each action shows a symbol relevant to its type, from code points common monospace fonts carry: the transcript's own `›` marks prompts, `‹` mirrors it for replies, and `×` marks failures, while tool names map by family — `/` for search and lookup, `≡` for reads, `±` for edits, `+` for writes, `$` for shell commands, `@` for web and fetch, `&` for agent delegation — with a plain `·` for anything unmapped. Every type wears its own color so kinds tell apart at a glance: following the footer's fixed-truecolor precedent, prompts are blue, replies sage, and failures red, while each tool name hashes through the same FNV-1a the OSC 8 id tagging uses into an eight-color palette, so one tool always wears one color in every session and theme. Distinct tools can share a palette slot or a family symbol; the color-symbol pair still separates them from prompts, replies, and failures. Symbols replay the covered row's active style the way the chips do, so a colored transcript band keeps its background beneath the rail.

The rail rests faint — the SGR faint attribute over the per-type colors, the closest a character grid comes to transparency — and underneath the session text: a resting symbol paints only when its cell is blank, so a transcript row running through the column keeps its text and hides that symbol, while blank margin rows show theirs. Hovering the column lifts the whole stack to the top at full intensity and expands each row to its symbol followed by the action name — still flush against the gap, capped at sixteen cells with an ellipsis — painting over whatever sits beneath. The hit band widens with the longest expanded row, so the pointer can travel along the names without collapsing them, and the stack returns underneath, faint, and one cell wide when the pointer leaves. The no-motion fallback keeps the compact fully lit column; only a real hover expands names. Pure no-button pointer motion drives the hover and doubles as the capability probe: Pi's fullscreen renderer enables all-motion tracking except under terminal multiplexers, which forward button-motion only, and there no such motion ever arrives, so the rail keeps full intensity instead of resting permanently dim. Until the first pure motion event proves hover tracking works, the rail is likewise fully lit. Pi hands listeners raw stdin chunks, and a moving pointer coalesces several SGR events into one read, so motion is scanned per escape-split sequence with the last position winning — a whole-chunk match would miss every batched stream and leave the probe permanently unsatisfied. Terminals also disagree on the no-button encoding: xterm reports hover motion with button base 3, while Scribe reports it with base 0, the left button's, making it byte-identical to a left drag. The scan therefore tracks press and release in the same stream — wheel reports excluded, since they say nothing about held buttons — and reads base-0 motion as hover only while no press is unreleased, so a real drag out of the column cannot flicker the sharpened rail and both encodings drive the hover. The faint rail remains a live control — clicks in the band always jump — and intensity transitions request one repaint each. Motion events are never consumed, because the renderer needs them for its own hover surfaces.

The stack anchors to the bottom of the transcript viewport and grows upward in session order — the newest action always sits at the bottom edge — and is deliberately independent of transcript scrolling. When every action fits, the whole session is always visible above that edge. Once the stack reaches the chips' rows and overflows, it shows the newest tail while the viewport follows output; scrolling up slides the window only far enough to keep the action the viewport currently sits in on screen — the last entry at or above the viewport top, which also carries an inverse-video highlight as the current-position marker. A left press on a symbol's cell scrolls its recorded row to the viewport top, and press and release are both consumed so the renderer never starts a text selection there.

The renderer assigns a frame's layout only after compositing its decorations, so the rail is always placed with the previous frame's viewport rect. A settled session repaints often enough that this is invisible, but the one frame drawn right after a reload composites against the outgoing layout — taller by the reload notice's rows — and can be the last frame for a while, leaving the stack floating above the bottom until a scroll forces a repaint. The decoration therefore queues a microtask per painted frame; it runs after the renderer stores that frame's own layout, and when the viewport moved against the rect the rail was placed with, it requests one corrective repaint. The repaint re-runs the same check, which goes quiet as soon as the rects agree, and an empty outline or a thrown decoration queues nothing that could loop.

The rail can be turned off from Pi's native `/settings` menu. Pi exposes no extension hook into that menu, so this is a guarded compatibility layer in the house style: selectors mount into the editor's own parent container, whose `addChild` is wrapped once per session, and every settings selector that appears receives one extra `Session action rail` item spliced into its `SettingsList`, with the list's instance-held change callback wrapped so the toggle never reaches Pi's own switch while native items still do. The choice takes effect immediately — the outline source returns empty while disabled, so the rail paints nothing and the chips keep working — and persists as `sessionRail` in the agent directory's `proper-base.json`, preserving unrelated keys, failing open to enabled on missing or damaged config, and reaching other sessions at their next start. A renamed selector component or list shape injects nothing and the rail simply stays enabled.

Installation, failure containment, listener priority, and reload takeover are the chips' own: a thrown decoration drops the rail for the frame and clears its hit region, renderers without the viewport surface — including regular mode, where the terminal owns scrolling — install nothing, and a missing or empty outline simply paints no rail while the chips keep working.

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

If Esc arrives before assistant processing, the prompt text is restored to the editor immediately. After the aborted run settles, proper-base invokes an internal extension command with command-context access and navigates back to the session leaf the submission started from. Navigating to that entry moves the active leaf onto it, rebuilds agent context, and rerenders the transcript; when it is already the leaf, a hidden custom anchor first makes navigation non-no-op. The append-only JSONL retains the abandoned branch, but the active transcript and future model context exclude it.

The origin leaf is read at editor submission rather than on the `input` event, because an extension that wraps Pi's input dispatch, such as proper-pacify, has already appended its own transcript entry by the time that event arrives. Those entries are the prompt entry's parents, so navigating to the prompt alone would strand them as rows describing a prompt no longer in the session. The origin is used only when it is still an ancestor of the cancelled prompt and is not itself a user or custom message, whose navigation semantics would drop an earlier turn; otherwise navigation falls back to the cancelled user entry. A submission that begins at an empty session has no origin entry, so entries appended ahead of that first prompt remain as the branch root.

The pre-input submission capture also covers cancellation during llm-router judging, when no Pi user entry exists yet: the router discards the prompt, and proper-base restores its text without branch navigation. Streaming steering or follow-up submissions clear this early capture and remain owned by Pi's native queue restoration. Streaming opens the assistant message with a `pending` partial as soon as response headers arrive — instantly behind a local proxy, with zero tokens produced — so that start alone does not count as processing and a cancelled connection-only turn is still removed. Once assistant content streams, a completed assistant message arrives, or a tool executes, cancellation keeps Pi's normal behavior and does not remove the turn. Escape used by autocomplete or another focused component is ignored.

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

## Fast tier scopes

`/fast` turns CLIProxyAPI's priority service tier on for the current session only, while `/fast-global` turns it on live for every session.

The CLIProxyAPI provider's own `/fast` persists one flag and reads it back only at extension load, which is neither scope: it changes the running session immediately, changes other sessions only after their restart, and silently becomes every future session's default. proper-base owns the final decision instead. A `before_provider_request` handler — which pi's agent loop runs for its own requests while `modelRegistry.complete` side calls such as proper-llm-router's judge never pass through it — rewrites only payloads for the configured provider id: when Fast is effective and the provider's cached catalog marks the model capable it adds `service_tier: "priority"`, and when Fast is off it strips exactly that value, so a provider instance still injecting from a stale in-memory flag is corrected on its next request. Because the provider applies its own injection before pi's payload hooks, the correction holds regardless of extension load order.

Effective Fast is the session flag or the global flag. The session flag lives in extension memory, is never written to disk, and resets on `session_start`, so a new, cleared, or restored session always starts without it. The global flag is the provider's own persisted `fast` key in `cliproxyapi.json`, re-read on every request exactly as the provider's pause gate re-reads its flag: `/fast-global` in one session reaches every running session's next request, and a newly started session seeds the provider's native Fast — including its pricing refresh and footer chip — from the same key. `CLIPROXYAPI_FAST` keeps the provider's boolean grammar and overrides the file when set, and the toggle write preserves the config file's other keys and format.

pi resolves extension commands before the `input` event and suffixes duplicate command names, so the provider's global `/fast` can be neither re-registered nor intercepted downstream. The submit recorder therefore consumes a bare `/fast` at the editor, before pi parses commands, and flips the session flag; `/fast-global` is an ordinary new command with no collision. Both report the scope they changed, warn when the current model cannot use the tier, and name the other scope when it keeps Fast effectively on after a disable. `/fast` with arguments falls through to the provider's usage error, and non-editor input paths such as RPC still reach the provider's original command. Toggling through the overlay leaves the provider's model-pricing refresh and footer chip on their own lifecycle: requests carry the right tier everywhere immediately, while a running session's cost metadata and chip catch up only when the provider itself reloads.

## Reload and composition

A global symbol tags the editor factory and remembers the factory it wrapped.

The editor and recorder symbol keys retain their legacy `pi-proper-history` namespace so recorded behavior survives both package renames. The fullscreen keybinding installer also recognizes the prior `pi-proper-customs.fullscreen-keybindings` marker and migrates its mutable controller to the `pi-proper-base` namespace.

Because `session_start` runs on reload, resume, and fork, the next pass unwraps proper-base's previous factory before wrapping again. This prevents duplicate seeding and an ever-growing wrapper chain. Separate editor, TUI, and footer symbols prevent wrappers, overlays, and timers from stacking; repeated footer installation refreshes its live context, while `session_shutdown` removes it before context invalidation. Extensions loaded later may still replace the editor or footer, so load order controls the final renderer and keybindings.

# proper-base

Baseline [Pi](https://pi.dev) behavior for quieter transcripts, automatic
session titles, model-preserving `/clear`, project prompt history, prompt
editing, fullscreen navigation, image handling, cancellation, autocomplete,
footer layout, context-window and Fast-mode control, commit message checks,
proactive subagent delegation, and deferred automatic updates.

## User-facing features

### Sessions and transcript

- Completed tools and errors collapse into separate one-line rows once later
  output appears, or when the run settles. In fullscreen mode, click a row to
  expand it and its `collapse` control to close it. Pi's tool-output shortcut,
  Ctrl+O by default, expands or collapses every row, and every row returns to
  collapsed when a run settles. Thoughts, tool-calling text, direct replies,
  and agent status updates remain fully visible and in their original order.
- A fresh unnamed session gets a hidden 3 to 7 word title from the first
  successful assistant response. Existing, resumed, and already-named sessions
  keep their names.
- `/clear` starts an empty session but preserves the current provider, model,
  thinking level, session Fast setting, and session context window. Global
  Fast and the global context window stay unchanged.
  No messages, name, or branch state carry over.
- The model you pick with `/model` or Ctrl+P and the level you pick with
  `/thinking`, Shift+Tab, or `/model <model> <level>` become Pi's startup
  defaults, so the next session opens on them. Pi otherwise saves
  those only when you press Ctrl+S in the picker, and because Pi re-derives the
  thinking level from the saved default on every model switch, an unsaved level
  is otherwise lost mid-session at the next `/model` or Ctrl+P.
  Automatic model-switch clamps do not redefine that choice, and the router's
  `llm-router/auto` placeholder persists neither itself nor its forced `off`.
  Resuming a session does not redefine the model. Set `"stickyDefaults": false`
  in `~/.pi/agent/proper-base.json` to turn this off.
- Prompt-template expansions remain model-facing, while the transcript shows
  the slash command you typed, such as `/implement-ready epic-1 4`.
- `/resume` builds its session list from a raw byte scan of each session file
  instead of parsing every message, then loads message text in the background.
  Search matches session names, IDs, and working directories at once, and
  message text as it arrives.
- CLIProxyAPI `empty_stream` failures and `Selected model is at capacity`
  overload errors become normal retryable network errors, so Pi applies its
  existing retry budget and backoff.
- `/tokens max` raises an OpenAI model's context window from its 272K default
  to the backend's 922K input cap for this session, through `openai-codex`,
  CLIProxyAPI, or the `openai` API. `/tokens default` returns to
  the default. Append `global` to set it for every session (saved as
  `contextTokens` in `~/.pi/agent/proper-base.json`); a session choice
  overrides the global one. Bare `/tokens` shows the current window. Tab on
  `max` or `default` opens the scope menu, where `global` is one arrow away.
  Auto-compaction then triggers at the new window minus your `reserveTokens`,
  including per-model `compaction.modelOverrides`. Input above 272K bills at
  the long-context rate.

### Fast mode

With the CLIProxyAPI provider (`@router-for-me/pi-cliproxyapi-provider`),
proper-base takes over its `/fast` command and splits the priority-tier Fast
mode into two scopes:

- `/fast` toggles Fast for the current session only. proper-base never saves
  it, so new, resumed, and reloaded sessions start with it off; `/clear` keeps
  it.
- `/fast-global` toggles Fast for every session by saving the provider's
  `fast` key in `~/.pi/agent/cliproxyapi.json`. Running sessions pick up the
  change on their next request.

Fast applies when either scope is on, and only to models the provider's
catalog marks as Fast-capable. Turning one scope off tells you when the other
still keeps Fast on, and turning Fast on warns when the current model cannot
use it. While `CLIPROXYAPI_FAST` is set, `/fast-global` refuses to change the
saved setting and reports the environment value. The footer shows the `fast`
tag whenever Fast applies to the current model.

### Automatic updates

- Pi's native background checks record available updates. proper-base installs
  them on the next supported launch, with live progress and safe restart.
- No recorded updates means no additional update checks or inventory at startup.
- `/settings` → **Automatic updates** persists enable/disable. `--no-auto-update`
  and `PROPER_UPDATER_OFF=1` still override it for a launch.
- Automatic updating requires npm Pi on Linux/macOS with Node 22.19+; automation
  and unsupported installations are skipped. No separate package is needed.

See [update behavior, safety limits, and migration](./UPDATES.md).

### Prompt editing and cancellation

| Input | Behavior |
| --- | --- |
| Alt+Enter | Insert a newline instead of queuing a follow-up. Pi's own Shift+Enter and Ctrl+J stay intact. |
| Home | Move to the current visible-row start, then the full prompt start. |
| End | Move to the current logical-line end, then the full prompt end. |
| Ctrl+C with text | Clear the prompt without arming exit. |
| Ctrl+C on an empty prompt | Show `Press Ctrl+C again to exit`; repeat within 500 ms to quit. |
| Esc before assistant work starts | Restore the submitted prompt and remove that turn from the active branch. |
| Esc after assistant work starts | Keep Pi's normal abort behavior. |

Dismissing an `ask_user_question` dialog with Esc aborts the run instead of
spending another model turn acknowledging the dismissal. Tool or host failures
still reach the model so it can ask in plain text.

### Project prompt history

proper-base records eligible editor submissions on a best-effort basis, not
transformed Pi session messages. History uses an encoded key derived from the
current working directory.

- Up and Down recall prompts from previous sessions in the same project. Up
  recalls only from an empty prompt; with a draft it only moves the cursor,
  so Home then Up can no longer replace what you typed.
- Ctrl+R starts case-sensitive reverse substring search. Press Ctrl+R again for
  an older match, Backspace or Shift+Backspace to broaden the query, Enter to
  submit, Esc to keep the match for editing, or Ctrl+G to restore the original
  draft.
- Prompt templates and skills remain in their submitted slash form.
- Built-in and extension UI commands such as `/model`, `/new`, and
  `/llm-router-config` are not recallable.
- Duplicate prompts keep their newest timestamp. The editor receives at most
  200 entries.

History lives under `~/.pi/agent/proper-history/`. One private JSONL file is
created per encoded working-directory key. Unusual paths that produce the same
hyphen encoding can share a file. Prompts over 4096 characters are skipped
rather than truncated. Startup reads only the newest 512 KiB; stores above
2 MiB compact to the newest 2000 valid entries. A concurrent append during that
rare compaction can lose one entry. Delete one file to forget one key, or the
directory to forget all proper-base history.

### Autocomplete

- The selected autocomplete description appears in a non-capturing bordered
  panel above the prompt without moving the editor, list, or footer.
- Slash-command completion works after whitespace and on later prompt lines.
  It replaces only the active slash segment and ignores slashes inside paths
  and URLs.
- Accepting a slash command completion opens that command's argument menu
  right away, such as the model list after `/model`.
- Word and line deletes (Alt+Backspace, Ctrl+W, Ctrl+U, Ctrl+K) refresh an
  open menu instead of leaving suggestions for text that no longer exists.
- `/model ` results sort by displayed model ID in descending numeric-aware
  order. Typed terms must all match when strict matches exist.
- `/model` takes an optional thinking level after the model name, as in
  `/model anthropic/claude-opus-4 high`. Once the model name carries a
  provider slash, the next word completes against Pi's thinking levels; a
  word naming no level keeps searching models.
- Tab-completing a model name submits nothing. It leaves the name, a
  trailing space, and an open level menu led by the level already in
  effect, so you can type a level straight away or press Enter to keep the
  current one.
- Tab or Enter on a level completion switches immediately: the level is
  the last argument, so `/model gp<Tab>lo<Tab>` picks the model and `low`
  without a further Enter. Either key switches only when the complete
  prompt is a single-line `/model ...` command.

### Fullscreen navigation and selection

Enable Pi's native fullscreen mode with `/settings` or:

```json
{
  "tuiMode": "fullscreen"
}
```

Pi keeps the prompt, queued messages, status, and footer pinned while the
transcript scrolls above them. Submitting a prompt scrolls the transcript back
to the newest output.

| Input | Behavior in fullscreen mode |
| --- | --- |
| Home, End, PageUp, PageDown | Stay assigned to the prompt editor. |
| Ctrl+Shift+Home or End | Jump the transcript to its top or bottom. |
| Ctrl+Shift+PageUp or PageDown | Scroll the transcript by one page. |
| Mouse wheel | Scroll three lines per notch instead of Pi's one. |
| Double-click | Select a complete one-line URL, path, flag, qualified identifier, or quoted value when possible. |

Set `PROPER_WHEEL_SCROLL_LINES` to a positive integer to change the wheel step,
for example `1` in a terminal that already sends one report per scrolled line.
Wheel and transcript scroll keys keep working while an `ask_user_question`
questionnaire or other overlay has focus, so earlier context stays reachable.

Typing or pasting clears a mouse selection, so a stale highlight never sits
over changing text. The copy shortcut leaves the selection in place, so it can
still be copied.

Copying fullscreen Markdown paragraphs and blockquotes removes display margins,
quote borders, and screen-width line breaks. Real newlines, paragraph boundaries,
and code indentation stay intact. Works with copy-on-select and Pi's configured
copy shortcut. Lists, tables, and unmatched custom output keep native copying.

Scrolling away from current output adds a `↓ jump to bottom` row above the
prompt. Clicking it returns to the newest output without disabling scrollbar
dragging.

Extension widgets that Pi would pin above the prompt (for example the
pi-subagents async-agents card) render at the end of the transcript instead, so
they scroll with the session and shrink as their content does rather than
holding rows they no longer need.

The transcript's top-right corner carries muted `↑` and `↓` arrows that walk
the viewport between your own prompts. Clicking `↓` past the last prompt scrolls
to the bottom. While you are scrolled up, a dimmer `position/total` reading sits
centred under the arrows and counts the prompts in the session; it disappears
once the viewport is following output again.

A column of colored symbols along the transcript's right edge marks each
prompt, reply, and tool call in session order, newest at the bottom. `›` marks
your prompts, `‹` replies, and `×` failures. Tools show `/` for search, `≡`
for reads, `±` for edits, `+` for writes, `$` for shell commands, `@` for web
requests, `&` for agents, and `·` for anything else. Click a symbol to scroll
to that action. The action the viewport sits in shows in inverse video. At
rest the rail is faint and gives way to transcript text in its column, and
hovering it brings it to full strength with each action's name. Under a
terminal multiplexer, where Pi receives no hover events, it stays fully lit.

Pi 0.85.0 moves the prompt cursor to wherever you click in the prompt. If you
click the prompt area to focus the terminal or to select text, turn off
`Prompt mouse clicks` in `/settings`: clicks on the prompt text then leave the
cursor alone while drag-to-select keeps working. The same menu holds the
`Session action rail` toggle. Both persist in `~/.pi/agent/proper-base.json`
as `editorMouse` and `sessionRail`.

### Clipboard and model image context

Ctrl+V and Ctrl+Shift+V both use Pi's image-or-text clipboard action. Readable
clipboard image paths appear as short `[image N]` markers. Image-capable
terminals render compact previews; text-only terminals show marker source paths.
Source metadata and bytes are read asynchronously; oversized sources become
pixel-bounded PNG thumbnails through `sharp` instead of blocking the editor or
transmitting the full image for a tiny preview. `sharp` ships prebuilt macOS arm64/x64 and Linux binaries, so
no external image command is required. Pi's accent braille loader animates while conversion runs; the
marker and path appear only if conversion is unavailable or fails. When terminal
focus returns, active Kitty previews are retransmitted so a lost terminal-side
scene cannot remain blank behind Pi's upload cache. Left and Right treat each
intact `[image N]` marker as one cursor token. When the cursor lands on it, Pi
inverse-highlights the complete marker; Backspace removes the whole highlighted
token. On submit, each marker expands back to the original path the agent can
read.

Images remain in model context for every tool loop in the turn that introduced
them. A later user message replaces older image blocks only in the outbound
context copy, so saved sessions, exports, resumes, and branches retain the
originals.

Under `TERM_PROGRAM=Scribe`, proper-base enables Kitty images and OSC 8
hyperlinks before Pi's renderer starts, so previews render and Ctrl+click on
any row of a wrapped link opens the full URL. Other terminals keep Pi's
detected capabilities. Every row of a wrapped link carries the same OSC 8 id,
so terminals that group links by id highlight and open it as one link.

On Linux, proper-base reads clipboard text through `wl-paste`, `xclip`, or
`xsel`, the tools Pi already uses to copy, instead of Pi's native clipboard
addon. That addon leaks two X connections on every read, and a long session
eventually hits the X server's client limit, after which paste silently stops
working. Image paste is unchanged, and macOS and Windows keep the addon.

### Skill context

Load several skills before one request:

```text
/skill:security /skill:testing fix the login flow
```

Only complete `/skill:name` tokens matching Pi's discovered catalog activate
skills. Matching is exact and case-sensitive; duplicate selections load once.
The first unknown or malformed token starts the literal request, with all
remaining text preserved. URLs, paths, queries, fragments, filename suffixes and
punctuation do not partially match names. Ambiguous, unreadable or malformed
registered selections reject the whole request. Explicit `/skill-context load`
and model-tool loads still report unknown names.

Use `--` after the command chain when the request itself starts with a literal
`/skill:` example. Inline, quoted, escaped, and fenced mentions are not commands.
Pi autocomplete completes partial input to `/skill:name`; submitted `/name`,
`$name`, `/skill name` and `/ skill:name` are not Pi skill aliases and remain
untouched. Other registered commands keep their own behavior. Pi's explicit
expansion opt-out remains respected, including RPC and queued prompts.

Each expanded skill appears as a collapsible section in terminal history,
including skills loaded through `skill_context`. Use Pi's tool-expansion shortcut
or click an individual section in fullscreen mode to view its instructions.
The request stays visible; the model still receives the full skill bodies.

Each selected skill retains a full snapshot and SHA-256 identity. Unchanged
instructions appear once in outbound context; repeating a workflow command
still submits its new request. Explicit reinvocation or refresh loads the current
file and supersedes older instructions. Compaction restores the selected
snapshots, never silently rereads changed files, and never replays the original
request. Normal task progress determines which workflow steps remain to do.

Manage the working set without starting a model turn:

```text
/skill-context
/skill-context load security testing
/skill-context remove testing
/skill-context refresh security
/skill-context clear
```

The list shows selected and removed snapshots, their version hashes, source
paths, changes on disk, character count, and confirmation threshold. Selections follow the current
session branch through resume, forks, context edits, and repeated compaction.
New sessions start empty. There is no guessed task expiry: reference instructions
apply only where relevant, and removal explicitly ends a selection. Removing a
skill omits its instruction blocks from future managed requests without deleting
historical user requests or the saved transcript. Conflicts are reported rather
than resolved by mention order; loading never grants extra tool permissions.

The model can use `skill_context` to list or load the smallest relevant set from
Pi's catalog. Explicit-only skills require the user's `/skill:` invocation.
Ordinary file reads remain available but do not automatically pin every skill
file inspected. Supporting resources load on demand; their files are not
snapshotted or version-pinned by this feature.

Selected instructions above 200,000 characters trigger a confirmation dialog.
Continue to keep every skill, or cancel to leave new selections unloaded.
Approval is remembered for the unchanged selection during the session, including
compaction. Changing the selection or reloading can require another confirmation.
There is no hard character cap or model-scaled limit; Pi and provider context
limits still apply. This count includes skill markup and separators, not tokens.

Restored selections are checked before reaching the model. Cancelling that check
stops the run; use `/skill-context remove <name>` or `/skill-context clear` to
reduce the selection, or retry and confirm. Runs without an interactive or RPC
confirmation UI stop with an explanation. No skill is silently truncated or
dropped.

**Skill context management** in `/settings` enables or disables the feature.
The preference is enabled by default and saved as `"skillContext"` in
`~/.pi/agent/proper-base.json`. `/skill-context on` and `/skill-context off`
provide a fallback when the native menu adapter is unavailable. Changes apply
to the next agent run. Disabled mode restores Pi's normal expansion and context
behavior; it does not erase instructions already delivered. Malformed or
unreadable configuration disables skill management until repaired.

Native menu integration and multi-command expansion use guarded Pi compatibility
adapters. `/skill-context load` remains available if expansion internals change.
The rest uses public command, tool, context, and session APIs. No new dependencies
or external registry are required.

### Commit message guard

proper-base checks each `git commit` the agent runs through the `bash` or
`quill_execute` tool, and blocks the call unless all of these hold:

- The command is one direct `git commit` call. Chains (`&&`, `||`, `;`, `|`),
  wrappers such as `sh -c`, `env`, `sudo`, or `timeout`, variable-assignment
  prefixes, and dynamic text (`$(...)`, backticks, `$VAR`) are rejected.
- The message comes only from literal `-m` or `--message` text. `-F`, `-e`,
  `-c`, `-C`, `-t`, `-s`, `--fixup`, `--squash`, `--trailer`, `--cleanup`,
  `--allow-empty-message`, and `--no-verify` are rejected.
- The subject and every body line fit in 72 columns, the second line is blank,
  and no line carries a `Co-Authored-By`, `noreply@anthropic`, or
  `Generated with Claude` attribution. A final block of `Key: value` trailers
  may exceed the length limit.

A blocked call lists every problem at once, so the agent can fix the whole
message in one retry. Commands that do not contain both `git` and `commit` skip
the check, and a commit command the guard cannot parse is blocked. There is no
setting to turn the guard off.

### Proactive delegation

When pi-subagents' `subagent` tool or its `subagents_enable` loader is active,
proper-base replaces its rule to delegate only when needed with a proactive
multi-agent mode. The agent hands independent work that is large enough to
justify a fresh context to subagents without waiting to be asked. It keeps sequential steps, small tasks, and edits
to the same area in the main session, and writes the final answer itself. Your
own instructions still take priority.

If the session has scoped models (from `--models`, `enabledModels`, or
`/scoped-models`), the prompt names them as the only models subagents may use
and asks the agent to pick one per task by difficulty and cost. The
`llm-router/auto` placeholder is left out. Sessions without either tool keep
their system prompt unchanged. Set `"proactiveDelegation": false` in
`~/.pi/agent/proper-base.json` to keep pi-subagents' ask-first policy.

### Footer

The built-in footer keeps path, branch, cumulative input, output, cache, cost,
context use, model, and thinking effort visible in two compact rows. Stable
colors separate the metrics; context changes color above 70% and 90%.
Supported `max` and router-provided `ultra` effort levels use a slow rainbow
highlight. Custom replacement footers are not changed.

## Install

Node 22.19 or newer is required. The package is tested against Pi 1.0.1.

From npm:

```bash
pi install npm:proper-base
```

From a local checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-base
```

Pi supplies the core `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui` peer packages. `sharp` is a runtime dependency for
image previews. Run `npm install` for a local checkout; it also prepares the
development checks below. There is no build step or install-time npm script.

This package replaces the former local `proper-customs` identity. Keep only one
registration. Existing data under the legacy `proper-history` path remains
compatible.

## Configuration

proper-base needs no configuration. Optional settings live in
`~/.pi/agent/proper-base.json`, and a missing or unreadable file keeps every
default.

| Key | Default | Effect |
| --- | --- | --- |
| `stickyDefaults` | `true` | `false` stops model and thinking choices from becoming Pi's startup defaults. |
| `contextTokens` | unset | Global `/tokens` window, `"max"` or `"default"`. `/tokens <mode> global` writes it. |
| `sessionRail` | `true` | Shows the session action rail. Toggle it with `Session action rail` in `/settings`. |
| `editorMouse` | `true` | Lets prompt clicks move the cursor. Toggle it with `Prompt mouse clicks` in `/settings`. |
| `proactiveDelegation` | `true` | `false` keeps pi-subagents' ask-first delegation policy. |

The **Automatic updates** entry in `/settings` is stored separately, as
described in [UPDATES.md](./UPDATES.md#disable).

| Environment variable | Effect |
| --- | --- |
| `PROPER_WHEEL_SCROLL_LINES` | Lines per mouse-wheel notch in fullscreen mode. Default `3`. |
| `PROPER_UPDATER_OFF=1` | Skips automatic updates for one launch, like `--no-auto-update`. |
| `CLIPROXYAPI_FAST` | The provider's Fast override. While it is set, `/fast-global` refuses to write. |
| `CLIPROXYAPI_PROVIDER_ID` | Provider ID that Fast mode and `/tokens` treat as CLIProxyAPI. Otherwise `providerId` from `cliproxyapi.json`, then `cliproxyapi`. |
| `TERM_PROGRAM=Scribe` | Set by the Scribe terminal. Enables Kitty image previews and OSC 8 links. |

## Compatibility

Restart Pi once when upgrading from releases with permanent host patches.
Those releases did not retain original methods or bindings for restoration.
New installations restore owned patches on unload and support reload takeover.

- Fullscreen behavior uses Pi's native `tuiMode: "fullscreen"` renderer.
- Questionnaire cancellation activates only when `ask_user_question` is
  installed.
- Editor and footer wrappers compose with existing providers when their Pi
  interfaces are compatible. Private Pi TUI changes or custom renderers may
  disable individual enhancements; later-loaded replacements still win.
- Ctrl+Shift fullscreen keys require a terminal that reports modifiers
  distinctly.
- Slash commands beginning with `__proper-` are reserved for internal session
  recovery.

## Development

```bash
npm install
npm test
npm run typecheck
npm run test:coverage
npm pack --dry-run
npm publish --dry-run
```

`prepack` runs tests and strict type checking before a tarball or publish. Tests
use Node's built-in runner. There is no build step.

## License

MIT

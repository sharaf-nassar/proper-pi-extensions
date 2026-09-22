# proper-pacify

proper-pacify is a Pi package whose extension rewrites user prompt tone before the main agent runs, preserving the prompt's content and recording both forms in the session.

## Architectural boundary

The package uses Pi's extension API and authenticated model registry without a service, runtime dependency, or build step.

`pacify.ts` owns configuration, model completion, commands, cancellation, and transcript links. `host.ts` isolates reversible Pi adapters tested against 0.87.1 for pre-command dispatch and message-aware rendering. The published `host-interop.ts` carries the shared submission and wrapper-ownership protocol; it is source-shipped so each package remains independently installable. `test/` includes real-host offline regressions. The package is registered in `.release-me.json` and the npm publishing workflow, so it releases through the same path as every other package; see [[proper-pacify#Installation status]] for the first-publish constraint.

## Tone-only contract

The extension rewrites wording into a clear, direct, neutral-professional, cooperative tone without altering meaning or structure.

An immutable instruction requires preservation of facts, requests, constraints, conditions, priorities, examples, names, numbers, paths, URLs, commands, code, quotations, markup, and ordering. It forbids answering, summarizing, explaining, correcting, inferring, adding, removing, or reorganizing content. It travels in the user turn rather than the system prompt, for the reason in [[proper-pacify#Instruction placement]].

The user-configured tone prompt is additional guidance. It cannot replace the immutable rules. Each eligible prompt makes one rewrite model call. Aborted, non-stop, or empty responses fail instead of becoming the user prompt.

Raw provider options preserve configured thinking: Anthropic receives adaptive effort or a numeric budget; Bedrock retains its `reasoning` field with bounded budgets; Google receives supported uppercase levels or numeric budgets. Thinking allocations reserve answer room and respect model and estimated context ceilings. Small mapping helpers remain package-local because bundled Pi exposes public module roots, not internal pi-ai option modules. Authentication and transport still belong to the host registry. Requests use Pi 0.86's leading system message followed by the text-only user turn, not legacy top-level context fields; the package therefore requires Pi and pi-ai 0.86 or newer.

## Rewrite integrity

A rewrite is accepted only when the model returns it inside a `<rewrite>` envelope and its length stays near the input's.

The parser removes envelope-formatting boundary line breaks in excess of the input's counts, including multiple LF or CRLF lines. It does not trim spaces, indentation, or the input's own boundary lines, and rejects a whitespace-only body.

Some models carry a system identity injected by their provider, so the tone rules arrive as secondary instructions to an agent that already believes it is a coding assistant. Such a model treats the prompt as a task and answers it. Without a check, that answer becomes the user's prompt: automatic mode transforms it in place, and no later stage can tell an answer from a rewrite.

The envelope makes the distinction binary rather than a judgement. A model in answer mode is not following the rewrite protocol, so it does not emit the envelope, while a model performing the rewrite emits it as instructed.

The length bound is a second gate for an answer that arrives inside an envelope anyway. Both failures raise `PacifyError`, which fails open to the original prompt, so a false rejection costs one wasted call rather than a lost prompt.

The envelope is the backstop, not the cure. [[proper-pacify#Instruction placement]] is what makes a model comply in the first place; the check exists for the model that still does not.

## Instruction placement

The operative rewrite instructions travel in the user turn, and the system prompt declares only the role.

The system slot is not reliably the extension's. A provider that fronts a subscription endpoint may prepend its own agent prompt to every request, because the upstream credential requires it. Instructions placed in the system slot are then outranked by an identity that answers prompts and calls tools, and no wording in that slot overrides it: an explicit instruction to disregard the prior identity changed nothing.

Disabling that injection at the provider is not an option either. It is what makes the upstream credential valid, so turning it off breaks the provider for every model. Measured with it off, the rewrite failure did not improve regardless.

The user turn is left intact by such providers. Moving the contract there, and marking the prompt as data, takes a cloaked model from rejecting every prompt to rewriting all of them correctly.

The prompt occupies the end of the message rather than sitting inside a fence. Any fence is forgeable: a prompt containing the closing delimiter would end the data region early, and everything after it would read as instructions. A trailing region has no closing token to forge, and it is also less to explain to the model.

Both halves must agree. While the system prompt still said the user message was itself the text to rewrite, a compliant model correctly rewrote the instructions instead of the prompt. The system prompt therefore names everything after the `TEXT` marker as the only data.

Few-shot examples were measured and rejected. They did not help a compliant model and slightly degraded a cloaked one.

## Attachments

Images are never sent to the rewrite model.

Tone is a property of text. An image carries no wording, so it cannot change what the rewrite should be, and sending one would spend image tokens on every prompt in automatic mode for no tone signal.

Sending images also makes the failure in [[proper-pacify#Rewrite integrity]] more likely rather than less. The observed failure was a model asking to open a pasted screenshot; supplying that screenshot removes the obstacle to it solving the task instead of rewriting the sentence.

Pi writes a pasted image to a temporary file and inserts that path into the prompt as ordinary text, so the rewrite model receives the path with no image behind it. The path needs no special handling: it is content, the tone contract already requires paths to survive verbatim, and the envelope catches any reply that acts on one instead. Masking paths behind placeholders was tried and rejected, because the placeholder became a new object for the model to ask about.

Automatic mode reattaches the prompt's images to the transformed result, so the agent still receives them.

## Dispatch priority

Pacification runs before registered command handlers and the input-handler chain for prompts submitted through Pi's `AgentSession.prompt`, `steer`, or `followUp`.

Pi 0.87.0 executes registered commands before `emitInput`, and has no pre-command extension hook. An input-runner patch cannot provide this ordering. `installHostHooks` therefore wraps all three public `AgentSession` submission boundaries and calls the original only after rewriting. Pi supplies the actual host classes through its virtual coding-agent module, without private filesystem imports.

The adapter checks the owning session manager, preserves images and prompt preflight callbacks, and leaves Pi responsible for dispatch, expansion, queueing, authentication, and agent execution. An idle-prompt admission reservation covers preparation only until Pi accepts or rejects its native preflight. A competing idle prompt then fails before it can spend a rewrite call or append an original; the reservation never covers an agent turn. All registered commands bypass that reservation because their handlers may synchronously submit a nested prompt; they still pass through preparation and retain Pi's command-before-busy-check behavior. Cancellation releases the reservation, and unload releases both current and waiting reservations even if a rewrite transport ignores abort. A resumed waiter checks ownership before touching context or starting work. Preflight callbacks report at most once. No foreign package is named and installation order does not determine priority.

An `AsyncLocalStorage` scope marks one prepared dispatch. The ordinary input handler skips that scope, avoiding duplicate work without suppressing concurrent prompts. Direct `steer` and `followUp` calls now receive the same scope, so their transformed queue messages reach preceding input handlers and persisted diff links with their exact origin. Direct low-level SDK calls to `emitInput`, outside `AgentSession`, still reach the ordinary input handler but do not acquire host pre-command semantics.

`host-interop.ts` carries a versioned original-input symbol on copied dispatch options and a method-wrapper disposal protocol also shipped by proper-base. The original invocation survives rewriting regardless of installation order, without a global current-input slot or runtime dependency between packages. Root integration tests require the helper copies to match.

Each runtime owns its adapters. Shutdown aborts pending rewrites, clears message/bypass state and stale context references, and restores methods only while it still owns them. Restoration skips inactive participating wrappers underneath it and reinstates the original property descriptor or inheritance, so load-order shutdown cannot reintroduce dead callbacks on repeated reloads. A later foreign wrapper is never overwritten; an inactive wrapper becomes pass-through. Reload installs fresh code and carries only the session override, checked against the continuing manager. Disabling the extension leaves no active rewrite callback. Migration from older releases clears their global runtime so their historical unremovable input wrapper becomes inert.

Remove the dispatch adapter when Pi exposes a public pre-command input hook with ordering guarantees. Real-host tests pin this compatibility boundary to the lockfile's resolved Pi version, currently 0.87.1. Development dependencies follow latest Pi releases.

## Automatic mode

Automatic mode transforms each non-empty interactive or RPC input before skill and prompt-template expansion.

Interactive, RPC, and extension-origin inputs are eligible, but only in the TUI and RPC run modes. Print and JSON runs are headless: `pi -p` scripts and subagent children receive machine-authored task text, and Pi labels a prompt carrying no explicit source as `interactive`, so the run mode is the only thing that separates a person typing from an agent dispatching. Rewriting those spends a rewrite call per run and edits instructions their sender expects verbatim, so automatic mode returns them untouched and writes no transcript entry. A one-shot exact-text guard skips only the user message already produced by `/pacify`. A leading slash-command token and its separating whitespace remain exact; only its argument body is rewritten. A command with no argument returns before the transcript entry is written, so internal dispatches such as proper-base's cancelled-prompt repair command never log a phantom rewrite onto the branch they are about to abandon. Attached images pass through unchanged.

A trivial argument body takes the same early return. [[proper-pacify/pacify.ts#isTrivialInput]] treats text as trivial when it has at most two whitespace-separated tokens or every token is at most three characters: a single-letter or numbered choice, a yes/no answer, a shortcut alias, a URL, an option set such as `1A 2B 3C`, or a two-word acknowledgement. Such text carries no tone the contract permits editing, so the rewrite would return it unchanged after a round trip, and skipping it keeps the transcript free of entries whose diff is empty.

Esc cancels an in-flight rewrite and discards that input. Other failures fail open to the original prompt so unavailable models or provider errors do not block the session.

## Explicit command

`/pacify <prompt>` performs one rewrite and sends the result through `pi.sendUserMessage()` as the next real user message.

The command waits for the current agent to settle, rejects an empty argument, and does not send a prompt when pacification fails or is cancelled. Prompt-template expansion stays enabled for the sent message, except for this package's own command names to avoid recursive dispatch.

## Bypass commands

`/unpacify <prompt>` and `/unpacify-session` skip the rewrite when automatic mode is on.

Automatic mode transforms input above command dispatch, so a bypass command typed by the user would otherwise have its own argument rewritten before the command ever ran. Input whose leading token is `/unpacify` or `/unpacify-session` is therefore excluded from automatic mode before any configuration is read.

`/unpacify` sends its argument through `pi.sendUserMessage()` verbatim, reusing the one-shot exact-text guard that already exempts `/pacify` output. It writes no transcript entry, because nothing was rewritten. `/unpacify-session` is the off half of [[proper-pacify#Session override]].

## Scheduled automatic mode

Automatic mode is off, always on, or restricted to a daily time window.

The three states are one union value in `auto`: `false`, `true`, or `{ "start": "HH:MM", "end": "HH:MM" }`. Modelling them as a union rather than a separate schedule field keeps "always on" and "scheduled" mutually exclusive by construction, so no combination of stored fields can express both at once. Existing boolean configurations remain valid.

Times are 24-hour local clock times. The window includes `start` and excludes `end`, so a prompt sent exactly at `end` is not pacified. A window whose `start` is later than its `end` wraps midnight, which is how an overnight window such as `22:00` to `06:00` is expressed.

Evaluation is per prompt, so a window opens and closes during a running session without a restart. It reads the machine's local clock and follows local time changes.

A malformed, non-string, incomplete, or zero-length window is rejected during loading and falls back to off. Automatic mode never fails open, because failing open would silently spend model calls on every prompt.

## Session override

`/pacify-session` turns automatic mode on for the current session, and `/unpacify-session` turns it off, without changing the stored default.

The override is three-valued. Unset follows `auto` from the configuration file, including a schedule's current state; `true` and `false` replace it for this session only. Neither command writes to disk.

Each command sets one state rather than flipping the effective one. A single toggle would name only half of what it does, and its outcome would depend on the stored default and, under a schedule, on the current time, so the user would have to know the effective state before typing it. Two named commands are idempotent and read the same whatever the session is currently doing.

An override outranks a schedule for the rest of the session, so a window that opens or closes later does not resume control until the override is cleared by a replacement session.

The override resets when Pi starts a replacement session through `/new`, `/resume`, `/fork`, or `/clone`, so a new session never inherits it. It survives `/reload`, because the session itself continues across a reload.

The configuration menu title appends the active override so the stored value and the session value can never appear to contradict each other.

## Configuration

`/pacify-config` edits `~/.pi/agent/pacify.json` through Pi's standard UI dialogs.

The menu selects an authenticated scoped model, model-supported reasoning effort, priority service tier, additional tone prompt, automatic mode, and whether the rendered user message shows the rewrite diff. It filters effort through the model's `thinkingLevelMap`; unsupported stored values clamp to the lowest supported level. Configuration is read before each rewrite.

Missing files, invalid JSON, and invalid field values use built-in defaults; saves create the parent directory. The default model is `gpt-5.6-luna`, effort is `medium`, fast and automatic modes are off, and the diff display is on.

Default tone guidance enumerates the span categories the model may edit — profanity and contempt, exasperation markers, flattery, pleading, deference frames, and feeling-only drama — and declares everything else content that must be copied verbatim.

That allowlist framing replaced an earlier blocklist of protected content. Under the blocklist, spans that were simultaneously tone-bearing and content-bearing gave the model contradictory instructions, and it resolved the conflict by deleting the clause or restructuring the sentence, losing questions, hedged action verbs, and claims about past behavior.

The default effort is `medium` because this guidance measurably degrades at `low`, where the model applies the span list inconsistently.

## Session transcript

Each eligible prompt appends a visible `proper-pacify` custom entry holding the original text and the model it is being sent to, headed `pacifying with <model>`.

The entry is written before the model call rather than after it, so the prompt appears the moment it is sent instead of after a round trip. It doubles as the progress indicator, which is why no separate progress notification exists: a notification carrying the same text would print it twice, once plainly and once inside the entry.

The original and model remain in the visible entry; the rewrite is stored only as the real user message. When that message is persisted, an invisible `proper-pacify-link` custom entry records its entry ID and the original entry ID. Neither custom entry enters LLM context.

The dispatch scope binds the exact message object at the Agent's `prompt`, `steer`, or `followUp` entry point, after input transformations and expansion. The persistence adapter links that object to its assigned entry ID. Intervening model/thinking changes cannot break the relationship, and identical rewrites, abandoned branches, reordered queued messages, failed submissions, and subsequent unpacified messages cannot borrow another original.

Pi's Markdown transformer lacks message identity. The rendering adapter captures the actual user message while Pi builds its component and binds only this package's transformer to it. Other transformers retain their order and Pi still builds the skill block and user component. On reload, Pi rebuilds chat before `session_start` assigns the runtime's manager. The runner's registered transformer marker identifies ownership during that phase; restoring the identity index then increments the display revision so already-painted components invalidate even at unchanged width. The transformer checks that its input remains the recorded rendered text before applying a cached word diff. Skill arguments compare against the original command body; prompt-template bodies and registered command dispatches remain excluded.

Session start rebuilds the identity index once in O(entries), using explicit links. Live submissions add their own pair without scanning history. Each pair computes its bounded LCS diff once; resize/render does no history scan, config-file read, or diff recomputation. The active theme styles cached spans at render time. `/pacify-config` updates the cached display setting and invalidates same-width Markdown when it changes. External file edits are picked up at the next eligible input or session start.

Legacy logs remain readable, but have no explicit link and cannot prove which user message belongs to them. Their text is not guessed into a diff. New links restore exact identity after reload/resume. The expanded original entry and the stored user content are unchanged by display settings.

Remove the rendering adapter when Pi's public Markdown context carries message identity. Until then, real host user components exercise both construction and cached rendering in the regression suite.

The entry follows Pi's global tool-expansion state: collapsed it is the header alone, expanded it adds the original prompt beneath it. A bold `›` or `⌄` disclosure marker in `borderAccent` opens the header, matching the summaries proper-base renders, so a run of prompts reads as one line each until `app.tools.expand` opens them. Reusing that host state keeps the behavior free of the per-item click machinery that would otherwise have to be duplicated here, and leaves the package independent of proper-base. When proper-base's settled transcript is installed, it drives that same state per entry and makes the header clickable; without it the entry still opens under `app.tools.expand`.

The entry renders as progress output rather than as a message: no background fill, and an italic unbolded header whose fixed label and varying model name take separate theme colors. A terminal cell has no size, so weight and slant are the only levers for making the header subordinate to the prompt beneath it. Colors come from the theme's custom-entry tokens rather than fixed intents, so the entry follows whichever theme is active.

A failed transcript write is swallowed. The record is worth less than the prompt, and an error raised while logging a failure would otherwise escape the dispatch and discard the user's input.

Cancellation and failure use `ctx.ui.notify()` beside the original entry. A fail-open request adds no link. A cancelled rewrite or unsuccessful `/pacify` command appends a `cancelled` marker for its visible outcome. Neither can bind a subsequent message. Non-skill command inputs are flagged at logging time because dispatch may append no user message, or may expand a template rather than preserve the rewritten argument. The extension sets no footer status, because such a message in the footer competes with other extensions for one truncated line.

Custom entries remain durable in Pi's JSONL session and render in the transcript, but `buildSessionContext()` excludes them from LLM context. After a failure the user message below the entry equals the recorded original, so the transcript itself proves the prompt was sent unchanged and no diff markup appears.

## Installation status

The repository directory and public npm package are both named `proper-pacify`.

Install the published package with `pi install npm:proper-pacify`, or install the checkout with `pi install /path/to/proper-pi-extensions/proper-pacify`. Installation order does not matter because `Dispatch priority` guarantees ordering at runtime.

The manifest registers `pacify.ts`, limits the tarball to runtime source, user documentation, and the license, and declares Pi's coding-agent, pi-ai, and TUI APIs as host-supplied peers. Coding-agent and pi-ai require 0.86 or newer. Releases run from the repository root with `./tools/release-me/release.sh bump <part> proper-pacify`, which creates the `proper-pacify-vMAJOR.MINOR.PATCH` tag that [[lat#Package releases]] verifies and publishes. The maintainer-authenticated initial publish is done, but the package does not yet trust the release workflow, so npm rejects workflow publishes until that trusted publisher is registered.

## Documentation map

Package documentation separates runtime behavior from verification expectations.

- [tests](./tests.md) — offline fixtures for configuration, nested model requests, commands, auto mode, and transcript entries.

<!-- lat-index
- [[tests]] — package verification entry
-->

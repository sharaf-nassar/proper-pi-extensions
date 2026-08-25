# proper-pacify

proper-pacify is a Pi package whose extension rewrites user prompt tone before the main agent runs, preserving the prompt's content and recording both forms in the session.

## Architectural boundary

The package uses Pi's extension API and authenticated model registry without a service, runtime dependency, or build step.

`pacify.ts` owns configuration, nested model completion, prompt interception, commands, cancellation, and transcript rendering. `test/` contains offline fixtures. The package stays absent from `.release-me.json` and npm publishing workflows until publication is deliberately enabled.

## Tone-only contract

The extension rewrites wording into a clear, direct, neutral-professional, cooperative tone without altering meaning or structure.

An immutable system instruction requires preservation of facts, requests, constraints, conditions, priorities, examples, names, numbers, paths, URLs, commands, code, quotations, markup, and ordering. It forbids answering, summarizing, explaining, correcting, inferring, adding, removing, or reorganizing content.

The user-configured tone prompt is additional guidance. It cannot replace the immutable rules. Each eligible prompt makes one rewrite model call. Aborted, non-stop, or empty responses fail instead of becoming the user prompt.

## Dispatch priority

Pacification runs above Pi's extension handler chain, so no other extension can observe an unpacified prompt.

Pi chains `input` handlers in extension load order, and load order follows the user's settings. Pi exposes no priority argument, no manifest ordering field, and no other hook between submission and the chain, so an extension registered earlier would otherwise receive the raw text.

The package therefore wraps the host's single input-dispatch funnel, `ExtensionRunner.prototype.emitInput`. Pi supplies extensions with its own instance of the coding-agent package through a virtual module, so importing the class yields the object the running host instantiates, in both the plain and bundled host layouts, without resolving any path or filename.

The wrapper pacifies the text, then invokes the original dispatch so every handler receives the rewritten prompt. A `handled` result from cancellation stops the dispatch entirely, and a downstream `handled` or `transform` result is returned unchanged.

This mechanism names no other package. It works identically whether other input-transforming extensions are installed, absent, or ordered before this one.

The patch installs once per process behind a global symbol, so `/reload` cannot stack wrappers. Because a reload replaces this module while leaving that wrapper in place, the wrapper resolves the live extension through shared global state rather than closing over the module instance that installed it. Closing over module scope would strand it on the previous instance, whose `pi` handle is already invalid, and would split the double-pacification guard across two module copies. Session-scoped state carries across the same boundary, which is what lets an override survive a reload.

A command with no argument is entirely dispatch syntax, so it passes through untouched. There is no prose to rewrite, and any edit would break the command. When the host layout does not expose the expected funnel, the extension keeps working through its own registered `input` handler and falls back to load-order behavior. That registered handler also keeps Pi's `hasHandlers("input")` gate open, which is what causes the funnel to run at all, and it skips work while the wrapper is active so a prompt is never pacified twice.

## Automatic mode

Automatic mode transforms each non-empty interactive or RPC input before skill and prompt-template expansion.

Interactive, RPC, and extension-origin inputs are eligible. A one-shot exact-text guard skips only the user message already produced by `/pacify`. A leading slash-command token and its separating whitespace remain exact; only its argument body is rewritten. Attached images pass through unchanged.

Esc cancels an in-flight rewrite and discards that input. Other failures fail open to the original prompt so unavailable models or provider errors do not block the session.

## Explicit command

`/pacify <prompt>` performs one rewrite and sends the result through `pi.sendUserMessage()` as the next real user message.

The command waits for the current agent to settle, rejects an empty argument, and does not send a prompt when pacification fails or is cancelled. Prompt-template expansion stays enabled for the sent message, except for this package's own command names to avoid recursive dispatch.

## Scheduled automatic mode

Automatic mode is off, always on, or restricted to a daily time window.

The three states are one union value in `auto`: `false`, `true`, or `{ "start": "HH:MM", "end": "HH:MM" }`. Modelling them as a union rather than a separate schedule field keeps "always on" and "scheduled" mutually exclusive by construction, so no combination of stored fields can express both at once. Existing boolean configurations remain valid.

Times are 24-hour local clock times. The window includes `start` and excludes `end`, so a prompt sent exactly at `end` is not pacified. A window whose `start` is later than its `end` wraps midnight, which is how an overnight window such as `22:00` to `06:00` is expressed.

Evaluation is per prompt, so a window opens and closes during a running session without a restart. It reads the machine's local clock and follows local time changes.

A malformed, non-string, incomplete, or zero-length window is rejected during loading and falls back to off. Automatic mode never fails open, because failing open would silently spend model calls on every prompt.

## Session override

`/pacify-session` turns automatic mode on or off for the current session without changing the stored default.

The override is three-valued. Unset follows `auto` from the configuration file, including a schedule's current state; `true` and `false` replace it for this session only. The command flips the effective state, so it enables automatic mode when the stored setting is currently off and suspends it when the stored setting is currently on. It never writes to disk.

An override outranks a schedule for the rest of the session, so a window that opens or closes later does not resume control until the override is cleared by a replacement session.

A single toggle is deliberate. An enable-only command would leave no way back, because the only remaining control edits the stored default and therefore changes every future session.

The override resets when Pi starts a replacement session through `/new`, `/resume`, `/fork`, or `/clone`, so a new session never inherits it. It survives `/reload`, because the session itself continues across a reload.

The configuration menu title appends the active override so the stored value and the session value can never appear to contradict each other.

## Configuration

`/pacify-config` edits `~/.pi/agent/pacify.json` through Pi's standard UI dialogs.

The menu selects an authenticated scoped model, model-supported reasoning effort, priority service tier, additional tone prompt, and automatic mode. It filters effort through the model's `thinkingLevelMap`; unsupported stored values clamp to the lowest supported level. Configuration is read before each rewrite.

Missing files, invalid JSON, and invalid field values use built-in defaults; saves create the parent directory. The default model is `gpt-5.6-luna`, effort is `medium`, and fast and automatic modes are off.

Default tone guidance enumerates the span categories the model may edit — profanity and contempt, exasperation markers, flattery, pleading, deference frames, and feeling-only drama — and declares everything else content that must be copied verbatim.

That allowlist framing replaced an earlier blocklist of protected content. Under the blocklist, spans that were simultaneously tone-bearing and content-bearing gave the model contradictory instructions, and it resolved the conflict by deleting the clause or restructuring the sentence, losing questions, hedged action verbs, and claims about past behavior.

The default effort is `medium` because this guidance measurably degrades at `low`, where the model applies the span list inconsistently.

## Session transcript

Every successful rewrite appends a visible `proper-pacify` custom entry containing complete before and after text plus model, effort, fast, and source metadata.

A failed transcript write is swallowed. The record is worth less than the prompt, and an error raised while logging a failure would otherwise escape the dispatch and discard the user's input.

Progress, cancellation, and failure messages are reported through `ctx.ui.notify()` so they appear in the session transcript beside that entry. The extension sets no footer status, because a progress message in the footer competes with other extensions for one truncated line.

Custom entries remain durable in Pi's JSONL session and render in the transcript, but `buildSessionContext()` excludes them from LLM context. Automatic failures append the same before and after text plus the error, proving that the original prompt was sent unchanged.

## Installation status

The repository directory and public npm package are both named `proper-pacify`.

Install the published package with `pi install npm:proper-pacify`, or install the checkout with `pi install /path/to/proper-pi-extensions/proper-pacify`. Installation order does not matter because `Dispatch priority` guarantees ordering at runtime.

The manifest registers `pacify.ts`, limits the tarball to runtime source, user documentation, and the license, and declares Pi's coding-agent and TUI APIs as host-supplied peers. Releases run from the repository root with `./tools/release-me/release.sh bump <part> proper-pacify`, which creates the `proper-pacify-vMAJOR.MINOR.PATCH` tag that [[lat#Package releases]] verifies and publishes. The package has no published version yet, so the first release needs one maintainer-authenticated publish before npm can trust the workflow.

## Documentation map

Package documentation separates runtime behavior from verification expectations.

- [tests](./tests.md) — offline fixtures for configuration, nested model requests, commands, auto mode, and transcript entries.

<!-- lat-index
- [[tests]] — package verification entry
-->

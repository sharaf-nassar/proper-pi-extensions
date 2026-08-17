# Routing lifecycle

Routing is a one-shot session state machine around pi's startup, model-selection, prompt, and agent-start events.

## Session state

A module-local `routed` flag records whether the current session has already chosen a model.

Every `session_start` resets the flag, including resumes and runs with `LLM_ROUTER_OFF=1`. Only the `startup` and `new` reasons also switch the session to `llm-router/auto`, and only when the current model does not already belong to the `llm-router` provider. Selecting any model from that provider clears the flag as well, so `/llm-router` and manual selection re-arm routing.

Resumed sessions are never forcibly moved to `llm-router/auto`. Routing only intercepts input while the current provider is `llm-router`, so a resumed session stays on the model it was left with.

## Eligible input

The input handler routes the first non-empty, non-extension input received while the current model belongs to provider `llm-router`. `auto` is the configured model, but the eligibility check is provider-wide rather than ID-specific.

Inputs emitted by another extension and inputs with no text continue unchanged. Image attachments do not affect the verdict; when text is transformed, the handler preserves the images.

The router's own `/llm-router` and `/llm-router-config` commands bypass routing so their UI work never changes the selected arm. The matcher reserves any command token beginning with `/llm-router` at a word boundary, so similarly prefixed unknown commands also bypass routing.

## Input precedence

Direct and judged paths run in a fixed order.

1. A configured slash-command pin runs first.
2. An unpinned bare slash command with no arguments uses the fallback model because it has no task text to judge.
3. A `[[llm-router: <model>]]` sentinel forces a resolved arm.
4. Every other eligible input runs the judge.

A pin wins over a sentinel when both appear in one command. Because the pin path returns before sentinel parsing, the marker is not stripped in this mixed form. An unknown sentinel emits a warning, removes the marker, and sends the remaining task to the judge.

## Judged route

`route()` combines the measured rubric, optional exemplar note, judge verdict, and concurrent availability probe.

The judge receives seven stable arm selection keys. Configured model overrides replace source-arm labels throughout the rubric and exemplar note, but the schema still returns the source key. After the verdict, `resolveVerdictModel()` keeps the slot, swaps it to a fixed partner, or throws when both choices are unavailable.

The final slot is then mapped to its configured CPA target. An overridden verdict exposes the target in `model` and `cpa_model`, records the slot in `overridden_from`, and updates `harness` only when the target resolves to a known arm. The down-arm list remains keyed by semantic slots and combines missing effective CPA models, zero credential counts, threshold blocks, and simulated unavailability.

The measured latency covers both the judge request and the concurrent availability work because routing waits for both. Lazy exemplar loading and note construction happen before the timer and are excluded.

## Judge protocol

The judge endpoint must implement OpenAI-compatible chat completions with strict JSON Schema output.

The request requires `harness`, `model`, and `rationale`, rejects extra fields, and limits `model` to the seven stable arm keys. Override targets appear only in the system-message labels, paired with their required selection keys. The user task is truncated to 4,000 characters. The rationale schema permits 500 characters; the UI displays at most 150.

The router trusts the parsed response rather than validating it locally. It does not verify that `harness` agrees with the selected slot. A quota swap recomputes the harness from the partner slot, while a known-arm override recomputes it from the target; an arbitrary target keeps the judge's value.

The router adds `reasoning_effort` only when configured. It makes at most two 60-second attempts. Empty content, invalid JSON, HTTP errors, and transport errors consume an attempt; user cancellation does not.

## Direct routes

Command pins and sentinels skip the judge and its model overrides but still consult availability.

`commandPin()` runs only while the session is armed. A pinned command on a later turn does not change models; reselect `llm-router/auto` first when the command must route a new session choice.

A successful pin applies its configured thinking level after the model switch. A `null` effort preserves the session level. Older pi versions without `setThinkingLevel` still complete the model pin. Sentinels have no effort field and never change the session thinking level. A successful sentinel returns transformed input with the marker removed.

Sentinel parsing consumes only the first marker, wherever it appears in the text. Later markers remain part of the task. The first marker is also removed before judged fallback when its name is unknown or its direct model cannot be selected.

Pins and sentinels share `quotaFinal()`, so their quota failure policy is identical. The helper deliberately fails open: if the probe fails or both the requested arm and its partner are down, the direct path keeps the requested arm and shows a warning instead of blocking the prompt.

If a resolved pinned model is absent from the registry or cannot be selected, routing resumes at the remaining precedence rules. A bare command then uses `fallbackModel`; a command with arguments proceeds to sentinel handling or the judge.

## Bare commands

An unpinned command with no arguments uses `fallbackModel` without a judge call or availability check.

Slash commands with arguments are ordinary task text unless a pin matches them. This keeps commands such as `/review <scope>` eligible for routing while avoiding a judge call for a command name alone.

This is the one path that fails silently. If the fallback model is missing from the registry the command continues unrouted and without a notice, which is the placeholder exposure described under `Placeholder safety` in `operations.md`.

## Registry lookup

Every switch path resolves an arm's CPA model ID through pi's model registry with one tolerance for dated identifiers.

The lookup asks for the exact ID under provider `cliproxyapi`, then accepts a registered model whose ID begins with that ID followed by a hyphen. A registry entry such as `claude-sonnet-5-20250929` therefore satisfies the `claude-sonnet-5` arm without editing the arm catalog.

A judged verdict whose effective target has no registry entry retries the lookup with `fallbackModel`. The route notice is composed before this registry fallback, so it can name an overridden target while pi's model footer shows the fallback actually selected.

This retry applies only when lookup returns no target. If the verdict model exists but `pi.setModel` rejects it, the handler reports failure and does not try `fallbackModel`.

Pinned and forced picks do not retry; an unresolvable model reports an error and returns them to the remaining precedence rules.

## Cancellation and fallback

Pressing Esc during judging aborts the active request, consumes the terminal input, discards the prompt, and leaves the session unrouted.

Cancellation depends on `ctx.ui.onTerminalInput`. On a pi build without it the handler subscribes to nothing and judging always runs to completion. Esc aborts only the judge request; the concurrent availability probe is not passed that signal and may continue until its own timeout.

Any other judged-path failure selects `fallbackModel` and shows an error notice. This includes judge failure, CPA availability failure, an invalid verdict, and the case where both a verdict arm and its swap target are unavailable. Fallback selection uses registry lookup only; it does not re-run availability or quota checks for `fallbackModel`.

The registry must contain a switchable target or fallback CPA model. If neither can be found, the extension reports an error and leaves `routed` false; the placeholder-avoidance invariant then depends on correcting the registry before retrying.

## Subagent behavior

Each pi-subagents child loads the extension and receives a fresh routing decision for its task.

Startup forcing replaces the model chosen by the spawner, so `runs.run(..., { model })` is not a reliable override. The sentinel is carried in task text, survives child creation, is removed before generation, and remains subject to quota swapping.

Before the agent starts, the extension adds sentinel instructions to orchestrating sessions. It omits the suffix in leaf children that cannot spawn more agents, but keeps it in fanout children.

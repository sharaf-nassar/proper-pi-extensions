# Routing lifecycle

Routing is a one-shot session state machine around pi's startup, model-selection, prompt, and agent-start events.

## Session state

The selected provider is the routing state: input is armed only while the current model belongs to `llm-router`.

On `startup` and `new`, `session_start` switches to `llm-router/auto` only when the current model belongs to another provider. A successful route selects any authenticated non-router provider, which naturally disarms later input. `/llm-router` or manual placeholder selection re-arms it.

Resumed sessions are never forcibly moved to `llm-router/auto`, so they stay on the model they were left with.

## Eligible input

The input handler routes the first non-empty input received while the current model belongs to provider `llm-router`. `auto` is the configured model, but the eligibility check is provider-wide rather than ID-specific.

Extension-origin inputs are eligible because `sendUserMessage()` aliases can start an agent turn and must leave the placeholder before inference. Inputs with no text continue unchanged. Image attachments do not affect the verdict; transformed input preserves them.

The router's own `/llm-router` and `/llm-router-config` commands bypass routing so their UI work never changes the selected arm. The matcher reserves any command token beginning with `/llm-router` at a word boundary, so similarly prefixed unknown commands also bypass routing.

## Input precedence

Direct and judged paths run in a fixed order.

1. A configured slash-command pin runs first.
2. An unpinned bare slash command with no arguments uses the fallback model because it has no task text to judge.
3. A `[[llm-router: <model>]]` sentinel forces a resolved arm.
4. Every other eligible input runs the judge.

A pin wins over a sentinel when both appear in one command. Because the pin path returns before sentinel parsing, the marker is not stripped in this mixed form. An unknown sentinel emits a warning, removes the marker, and sends the remaining task to the judge.

## Judged route

`route()` combines the measured rubric, optional exemplar note, judge verdict, and concurrent registry and optional CPA availability checks.

The judge receives seven stable arm selection keys. Configured model overrides replace source-arm labels throughout the rubric and exemplar note, but the schema still returns the source key. After the verdict, `resolveVerdictModel()` keeps the slot, swaps it to a fixed partner, or throws when both choices are unavailable.

The final slot maps to a resolved provider and model. The verdict exposes `arm`, `provider`, and `model`; an override records the source slot in `overridden_from`. `arms_unavailable` stays keyed by semantic slots and combines missing registry targets, CPA serving or quota failures, and simulation.

The measured latency covers both the judge request and the concurrent availability work because routing waits for both. Lazy exemplar loading and note construction happen before the timer and are excluded.

## Judge protocol

The judge can run through Pi's configured provider runtime or an OpenAI-compatible chat-completions endpoint.

Both transports require `model` and `rationale`, reject extra fields, and limit `model` to the seven stable arm keys. Override targets appear only in system-message labels, paired with their selection keys. The task is truncated to 4,000 characters. Rationale permits 500 characters; UI displays 150.

A provider-qualified judge model always uses `ctx.modelRegistry.complete()`. When CPA is absent, an unqualified judge model also uses Pi if it resolves among authenticated models. This path forces one strict `route_model` tool call and delegates auth, endpoint, and provider serialization to Pi.

Otherwise the router preserves the raw HTTP path at `<judge.baseUrl>/chat/completions` with strict `response_format` JSON Schema. This keeps existing CPA and compatible custom endpoint configurations working.

The router maps configured effort and optional priority service to the selected judge transport. It makes at most two 60-second attempts. Missing or invalid structured output, provider errors, HTTP errors, and transport errors consume an attempt; user cancellation does not.

## Direct routes

Command pins and sentinels skip the judge and its model overrides but still resolve authenticated targets and consult optional CPA checks.

`commandPin()` runs only while the selected provider is `llm-router`. A pinned command on a later turn does not change models; reselect `llm-router/auto` first when the command must route a new session choice.

A successful pin applies its configured thinking level after the model switch. A `null` effort preserves the session level. Older pi versions without `setThinkingLevel` still complete the model pin. Sentinels have no effort field and never change the session thinking level. A successful sentinel returns transformed input with the marker removed.

Sentinel parsing consumes only the first marker, wherever it appears in the text. Later markers remain part of the task. The first marker is also removed before judged fallback when its name is unknown or its direct model cannot be selected.

Pins and sentinels share `directFinal()`, so their failure policy is identical. If no swap is usable, the direct path keeps the requested target when it exists and shows a warning instead of blocking the prompt.

If a resolved pinned model is absent from the registry or cannot be selected, routing resumes at the remaining precedence rules. A bare command then uses `fallbackModel`; a command with arguments proceeds to sentinel handling or the judge.

## Bare commands

An unpinned command with no arguments uses `fallbackModel` without a judge call or availability check.

Slash commands with arguments are ordinary task text unless a pin matches them. This keeps commands such as `/review <scope>` eligible for routing while avoiding a judge call for a command name alone.

This is the one path that fails silently. If the fallback model is missing from the registry the command continues unrouted and without a notice, which is the placeholder exposure described under `Placeholder safety` in `operations.md`.

## Registry lookup

Every switch path resolves model IDs through Pi's authenticated model registry.

A `provider/model-id` value resolves only under that provider. An unqualified ID prefers `cliproxyapi`, then the direct provider for its model family, with a stable provider/name tie-break. Exact IDs beat `-suffix` and `@suffix` dated variants.

A judged verdict whose effective target cannot be selected retries lookup with `fallbackModel`. The fallback may also be provider-qualified.

This retry applies only when lookup returns no target. If the verdict model exists but `pi.setModel` rejects it, the handler reports failure and does not try `fallbackModel`.

Pinned and forced picks do not retry; an unresolvable model reports an error and returns them to the remaining precedence rules.

## Cancellation and fallback

Pressing Esc during judging aborts the active request, consumes the terminal input, discards the prompt, and leaves the session on `llm-router/auto` for the next attempt.

Cancellation depends on `ctx.ui.onTerminalInput`. On a pi build without it the handler subscribes to nothing and judging always runs to completion. Esc aborts only the judge request; the concurrent availability probe is not passed that signal and may continue until its own timeout.

Any other judged-path failure selects `fallbackModel` and shows an error notice. This includes judge failure, invalid structured output, and both a verdict arm and its swap target being unavailable. Fallback selection uses authenticated registry lookup only; it does not re-run CPA checks for the fallback.

The registry must contain a switchable target or fallback model. If neither can be found, the extension reports an error and remains on the placeholder provider; correct model authentication or configuration before retrying.

## Subagent behavior

Each pi-subagents child loads the extension and receives a fresh routing decision for its task.

Startup forcing replaces the model chosen by the spawner, so `runs.run(..., { model })` is not a reliable override. The sentinel is carried in task text, survives child creation, is removed before generation, and remains subject to quota swapping.

Before the agent starts, the extension adds sentinel instructions to orchestrating sessions. It omits the suffix in leaf children that cannot spawn more agents, but keeps it in fanout children.

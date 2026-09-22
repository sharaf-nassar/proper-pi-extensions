# Routing lifecycle

Routing is a one-shot session state machine around pi's startup, model-selection, prompt, and agent-start events.

## Session state

The selected provider is the routing state: input is armed only while the current model belongs to `llm-router`.

On `startup` and `new`, `session_start` switches to `llm-router/auto` only when routing is active per [[configuration#Routing switch]], the active branch has no conversation entry, and the current model belongs to another provider. Conversation entries are non-system messages, injected custom messages, compactions, and branch summaries; system-prompt, model-only, or thinking-only persisted state is still fresh and may be armed. A successful route selects any authenticated non-router provider, which naturally disarms later input. `/llm-router` or manual placeholder selection re-arms it.

Interactive `/resume` emits `resume`, while CLI `-c` and `--session` load an existing conversation with `startup`. Both preserve the restored model because the active conversation check, not the event reason alone, distinguishes continuation from a genuinely new session.

## Eligible input

The input handler routes the first non-empty input received while the current model belongs to provider `llm-router`. `auto` is the configured model, but the eligibility check is provider-wide rather than ID-specific.

Extension-origin inputs are eligible because `sendUserMessage()` aliases can start an agent turn and must leave the placeholder before inference. Inputs with neither text nor images continue unchanged. Image-only inputs use the trivial-input fallback without a judge call. Image attachments do not affect the verdict; transformed input preserves them.

The router's own `/llm-router` and `/llm-router-config` commands bypass routing so their UI work never changes the selected arm. The matcher reserves any command token beginning with `/llm-router` at a word boundary, so similarly prefixed unknown commands also bypass routing.

## Input precedence

Direct and judged paths run in a fixed order.

1. A configured slash-command pin runs first.
2. A `[[llm-router: <model>]]` sentinel forces a resolved arm.
3. Trivial input, including an image-only prompt or unpinned bare slash command, uses the fallback model because it has no task text to judge.
4. Every other eligible input runs the judge.

A pin wins over a sentinel when both appear in one command. Because the pin path returns before sentinel parsing, the marker is not stripped in this mixed form. An unknown sentinel emits a warning, removes the marker, and sends the remaining task through the trivial-input check and then the judge.

## Judged route

`route()` combines the measured rubric, optional exemplar note, registry judge verdict, and concurrent registry plus optional CPA quota availability checks.

The judge receives seven stable arm selection keys. Configured model overrides replace source-arm labels throughout the rubric and exemplar note, but the schema still returns the source key. After the verdict, `resolveVerdictModel()` keeps the slot, swaps it to a fixed partner, or throws when both choices are unavailable.

The final slot maps to a resolved provider and model. The verdict exposes `arm`, `provider`, and `model`; an override records the source slot in `overridden_from`. `arms_unavailable` stays keyed by semantic slots and combines missing registry targets, CPA quota failures, and simulation.

The measured latency covers both the judge request and the concurrent availability work because routing waits for both. Lazy exemplar loading and note construction happen before the timer and are excluded.

## Judge protocol

The judge always runs through Pi's configured provider runtime.

Pi 0.86 declares the judge prompt and tool schema in a leading system message, using `toolsAdded`; the task follows as a user message. Legacy top-level `systemPrompt` and `tools` fields are not used.

The strict `route_model` tool requires `model` and `rationale`, rejects extra fields, and limits `model` to the seven stable arm keys. Override targets appear only in system-message labels, paired with their selection keys. The task is truncated to 4,000 characters, and exemplar retrieval scores the same slice. Rationale permits 500 characters; UI displays 150.

Qualified and unqualified judge names resolve against `ctx.modelRegistry.getAvailable()`. `ctx.modelRegistry.complete()` delegates credentials, endpoint selection, headers, provider serialization, and OAuth refresh to Pi. It intentionally remains the raw, tool-capable registry call: Pi 0.86 exposes `streamSimple()`, but its provider-neutral options do not retain priority service and all managed-effort controls. The raw call retains those provider-specific options. An unresolved judge fails visibly and the input handler uses `fallbackModel`; llm-router has no raw endpoint or provider-key fallback.

The `route_model` tool carries `constrainedSampling: { type: "json_schema", strict: "require" }`. Pi's `openai-completions` adapter defaults `supportsStrictMode` to false for unknown custom endpoints; with `strict: "require"`, the adapter throws before producing a request payload rather than silently relaxing the schema. A custom `openai-completions` judge must either use a supported endpoint (such as the built-in Codex Responses APIs) or explicitly advertise `compat.supportsStrictMode: true` in its model entry -- only set this for endpoints that have been verified to accept strict JSON-schema tools. Setting it for unverified endpoints risks silent schema relaxation on the provider side. The default Responses and Codex judges are unaffected by this requirement.

The router maps configured effort and optional priority service to the registry request. Raw Anthropic requests mirror Pi's simple-thinking mapping: adaptive models receive enabled thinking and their mapped effort, budget models expand the 512-token answer cap by the thinking budget while reserving answer room, and host-managed-effort models retain Pi's mandatory adaptive/high policy while receiving the selected effort through its message policy. Manual budget thinking and managed-effort models use automatic tool choice, because forcing a tool can be rejected by those APIs. The instruction requests `route_model`; strict argument sampling and the validated retry loop still reject missing or invalid verdicts. Bedrock keeps its separate `reasoning` mapping, bounded token budgets with answer room, and automatic tool choice when reasoning is requested. Small option mappings remain package-local, avoiding internal pi-ai runtime imports unavailable in bundled Pi. Google's raw API receives supported uppercase family levels or numeric 2.5 budgets, with answer room in the shared output ceiling. Providers without strict schema support fail visibly rather than silently relaxing the schema contract. OpenAI Responses (including Azure Responses) receives flat `{ type: "function", name: "route_model" }`; Chat Completions keeps its nested function form; Codex Responses APIs, including provider-specific IDs ending in `codex-responses`, receive `"required"`. It makes at most two 60-second attempts. Missing or invalid tool output and provider errors consume an attempt; user cancellation does not.

## Direct routes

Command pins and sentinels skip the judge and its model overrides but still resolve authenticated targets and consult the optional CPA quota gate.

`commandPin()` runs only while the selected provider is `llm-router`. A pinned command on a later turn does not change models; reselect `llm-router/auto` first when the command must route a new session choice.

A successful pin applies its configured thinking level after the model switch. A `null` effort preserves the session level. Older pi versions without `setThinkingLevel` still complete the model pin. Sentinels have no effort field and never change the session thinking level. A successful sentinel returns transformed input with the marker removed.

Sentinel parsing consumes only the first marker, wherever it appears in the text. Later markers remain part of the task. The first marker is also removed before judged fallback when its name is unknown or its direct model cannot be selected.

Pins and sentinels share `directFinal()`, so their failure policy is identical. If no swap is usable, the direct path keeps the requested target when it exists and shows a warning instead of blocking the prompt.

If a resolved pinned model is absent from the registry or cannot be selected, routing resumes at the remaining precedence rules. A bare command then uses `fallbackModel`; a command with arguments proceeds to sentinel handling, the trivial-input check, or the judge.

## Trivial input

Input a judge cannot usefully rank uses `fallbackModel` without a judge call or availability check.

[[proper-llm-router/llm-router.ts#isTrivialInput]] treats text as trivial when it has at most two whitespace-separated tokens or every token is at most three characters. That covers a bare command name, a single-letter or numbered choice, a yes/no answer, a shortcut alias, a URL, an option set such as `1A 2B 3C`, and a two-word acknowledgement. The judge's verdict on such text is noise, and the same input later in the session would run on whichever model the session already has.

The check runs on the task text after sentinel stripping, so a trivial reply carrying an unknown marker still has the marker removed. Slash commands with arguments are ordinary task text unless a pin matches them, so `/review <scope>` stays eligible for routing while a command name alone never spends a judge call.

This is the one path that fails silently. If the fallback model is missing from the registry the input continues unrouted and without a notice, which is the placeholder exposure described under `Placeholder safety` in `operations.md`.

## Registry lookup

Every switch path resolves model IDs through Pi's authenticated model registry.

A `provider/model-id` value resolves only under that provider. An unqualified ID prefers `cliproxyapi`, then the direct provider for its model family, with a stable provider/name tie-break. Exact IDs beat `-suffix` and `@suffix` dated variants.

A judged verdict whose effective target cannot be selected retries lookup with `fallbackModel`. The fallback may also be provider-qualified.

This retry applies only when lookup returns no target. If the verdict model exists but `pi.setModel` rejects it, the handler reports failure and does not try `fallbackModel`.

Pinned and forced picks do not retry; an unresolvable model reports an error and returns them to the remaining precedence rules.

## Cancellation and fallback

Pressing Esc during judging aborts the active request, consumes the terminal input, discards the prompt, and leaves the session on `llm-router/auto` for the next attempt.

Cancellation depends on `ctx.ui.onTerminalInput`. On a pi build without it the handler subscribes to nothing and judging always runs to completion. Esc aborts only the judge request; a concurrent CPA quota probe is not passed that signal and may continue until its own timeout.

Any other judged-path failure selects `fallbackModel` and shows an error notice. This includes judge failure, invalid structured output, and both a verdict arm and its swap target being unavailable. Fallback selection uses authenticated registry lookup only; it does not re-run CPA checks for the fallback.

The registry must contain a switchable target or fallback model. If neither can be found, the extension reports an error and remains on the placeholder provider; correct model authentication or configuration before retrying.

## Subagent behavior

Each pi-subagents child loads the extension and receives a fresh routing decision for its task.

Startup forcing replaces the model chosen by the spawner, so `runs.run(..., { model })` is not a reliable override. The sentinel is carried in task text, survives child creation, is removed before generation, and remains subject to quota swapping.

Before the agent starts, the extension adds sentinel instructions to orchestrating sessions through `systemPromptOptions.sections.proper_llm_router`, not a full prompt replacement. Later structured contributions therefore remain effective. A prior opaque `forceSystemPrompt` stays explicit and receives the instructions directly, without restoring excluded defaults. Leaf children that cannot spawn more agents omit these instructions; fanout children keep them.

proper-base's delegation guidance requires an advertised task-text override alongside its chosen model argument. The router owns the sentinel syntax and enabled-state decision; base does not guess routing activity from the registered placeholder or selected model, so either extension load order works.

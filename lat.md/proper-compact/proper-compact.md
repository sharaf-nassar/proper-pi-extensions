# proper-compact

proper-compact replaces Pi's summary policy while preserving native compaction boundaries, retained messages, persistence, and branch navigation. It adds bounded read-only recall from existing session history.

<!-- lat-index
- [[tests]]: Offline lifecycle, evidence, recall, provider, and packaging verification.
-->

## Architectural boundary

The package uses public Pi 0.87.0 hooks and authenticated registry streaming, with no runtime dependencies, private host patches, pruning pipeline, or new memory store.

`compact.ts` owns configuration, prompt contracts, request planning, output validation, usage, and lifecycle hooks. `context.ts` owns public-text serialization and branch-scoped recall. Pi alone appends successful compaction and branch-summary entries. Ordinary `context` events are untouched.

Stock Pi 0.87.1 limits serialized tool results to their first 2,000 characters. Supplying complete selected public text avoids that pre-summary clipping, while recall lets an agent check original evidence after a lossy summary. These mechanisms do not establish improved task success or lower cost.

## Evidence input

Summarizer input preserves complete public text, tool arguments, result status, and available source IDs. Thinking, signatures, and image bytes are excluded explicitly.

Ordinary compaction maps prepared messages to Pi's canonical projected source entries. Context-edit omissions stay omitted; replacement content retains its original source ID. Original message objects map directly, while fresh native projections are matched structurally within role/timestamp groups; ambiguous matches expose candidate IDs instead of inventing provenance. Normal history and split-turn prefixes carry separate phase labels. Previous checkpoints are untrusted prior state. Branch summaries intentionally receive raw abandoned-path entries, including existing summaries and context-edited originals, without native newest-only truncation. This matches stock Pi's raw-history branch-summary policy, not ordinary compaction's edited-context policy. Repeated tool arguments never justify discarding results. Failed tools may still have side effects; artifact descriptions must distinguish attempts from confirmed outcomes.

Prior state, conversation data, and instructions occupy separate labeled sections. Continuation-oriented instructions preserve the current request and observed progress without reconstructing later messages or declaring unfinished work complete. This follows Pi 0.87.1's split-turn prompt fix, while retaining our public-text-only source policy and checkpoint format. Offline prompt checks do not establish live-model refusal rates.

JSON serialization makes source structure explicit, not immune to prompt injection. The summarizer has no tools, is instructed not to follow source instructions, and cannot return executable tool output.

## Bounded summarization

One request handles source that fits. Otherwise, sequential chunks cover every serialized character, carrying validated state between calls under a preflighted call ceiling.

The input estimate uses UTF-8 bytes divided by three. Automatic capacity leaves the selected output ceiling, 4,096 tokens, and 10% headroom; explicit input limits can only reduce it. Multi-call planning reserves the maximum accepted encoded checkpoint before choosing contiguous Unicode-safe chunks. Over-budget plans fail before inference rather than silently dropping source.

The default output allowance is 8,192, thinking is low, the operation allows four calls, and its deadline is 120 seconds. These are configurable starting points, not measured optima. Pi's trigger `reserveTokens` and `keepRecentTokens` remain independent.

Pi's provider-neutral stream maps reasoning. A request-local model descriptor limits additive Anthropic/Bedrock thinking room. Codex-style transport can omit a wire cap, so requested output size is not a universal billing ceiling. Checkpoint validation additionally bounds encoded bytes; timeouts bound local waiting, not remote charges.

## Checkpoint validation

Only successful-stop text with a complete summary envelope and ordered, nonempty required sections becomes a checkpoint. Length stops, tool calls, malformed structure, and oversized text fail explicitly.

Required sections cover goals, constraints, progress, decisions, next steps, critical context, and artifacts/evidence. Structural validity does not prove factual correctness. All serialized text can reach a summarizer while its generated state remains lossy, particularly across repeated compactions.

## Provider routing and usage

Model selection uses the current model or an exact authenticated provider/model within session scope. Requests use the host registry's provider-aware stream, never extracted credentials or a separate HTTP client.

Each request gets a fresh routing session ID, disables retries, and requests no cache retention. Runtime auth retains endpoint, headers, environment, and provider routing. Successful response usage is aggregated across chunks and returned to Pi with the checkpoint.

Hidden attempt entries contain only status, selected model, request count, estimates, and returned usage. Delivered response usage is added before checking cancellation. No receipt is appended after shutdown or session replacement. They also preserve known usage after failed generation, which Pi's ordinary session totals do not aggregate. Generated status is not a persistence claim when another hook overrides the result. Interrupted providers can leave usage unknown.

## Lifecycle and fallback

The extension participates in native manual, threshold, overflow, and ordinary branch summaries. Abort signals, shutdown, and deadlines stop local work without persisting partial checkpoints.

Returned compaction boundaries and pre-compaction token counts exactly match Pi's preparation. A lifetime controller prevents late completions from writing into a replacement session. Every session start aborts the prior controller before renewing it, even if shutdown was not delivered. Branch summarization requires explicit user opt-in; replacement-format branch prompts delegate to Pi unchanged.

Expected errors warn and use configured stock fallback or cancellation. Stock fallback deliberately reintroduces stock serialization limitations. User abort and shutdown never trigger fallback. Unexpected errors surface through Pi's extension runner and remain subject to its policy. Multiple replacement extensions are unsupported: last truthy result wins and cancellation short-circuits.

The installed CLIProxyAPI proactive-compaction controller clears pending synthetic overflow in its own before hook. It must load before proper-compact, or the summarizer must use a different provider/model. Otherwise, its same-model stream wrapper can consume pending overflow on a summary request before the clearing hook runs. Fresh request session IDs do not bypass that behavior. No private vendor-state workaround is installed; load-order independence requires an upstream fix.

## Transcript recall

The compact_recall tool searches and pages original public text through native session APIs, restricted to the current branch and explicitly referenced source branches.

Search is literal, case-insensitive, and limited to eight matching entries per page. Entry reads return at most 16,000 serialized UTF-16 characters with continuation offsets. Source images, private thinking, hidden custom state, unrelated branches, arbitrary files, and other sessions are inaccessible.

Recall exposes original public text even when context edits omit or replace it for future model requests. No copies of history are stored. Branch references absent after fork/export are reported unavailable. The summary carries a deterministic recall reminder, but storage access does not guarantee that an agent will retrieve the right evidence.

## Configuration

The compact-config command opens a settings menu or merges a JSON patch into proper-compact.json under Pi's agent directory. Configuration writes remain validated and atomic; opening or cancelling the menu does not create a file.

Configuration controls enablement, exact model, thinking, independent input/output budgets, maximum calls, operation timeout, and stock-or-cancel behavior. Unknown keys and invalid values fail visibly. Missing files use defaults; malformed files are not overwritten by command updates. In-flight requests keep their captured configuration.

## Settings menu

The no-argument command uses native Pi select and input dialogs for every setting. Rows show current values, accepted edits save immediately, and Done or Escape closes the menu.

Model choices are authenticated and session-scoped, with an option to follow the current model. Thinking can inherit session effort. The input limit accepts blank or auto for automatic budgeting; other numeric inputs use existing bounds. Cancelled dialogs do not save; invalid input warns and returns to the menu. Unexpected errors still surface.

Each edit rereads disk settings before merging its selected field, preserving unrelated changes made while a dialog was open. This does not provide cross-process locking. Dialogs receive the extension lifetime signal; late replies after shutdown or session replacement cannot save. Active summaries retain captured settings.

The menu uses only dialogs supported by TUI and RPC, not custom terminal components. Headless modes print settings and a JSON-update hint to stderr without attempting a dialog. Explicit JSON patches remain supported in all modes.

## Packaging and evaluation

proper-compact is an independently installable source package with offline tests, strict typechecking, bundled-loader coverage, and repository release/gate integration. Initial publication and trust setup remain maintainer actions.

Research behind the policy is recorded in the package README. Installed Pi contracts and executable regression tests support mechanical guarantees; vendor evaluations and preprints motivate, but do not establish, quality or cost superiority. A fixed-model task-level pilot is still required to measure retention, retrieval behavior, prompt-injection outcomes, latency, and total successful-task cost.

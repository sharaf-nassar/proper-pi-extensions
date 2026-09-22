# proper-compact

[Pi](https://pi.dev) summarizes older conversation to make room for new work.
In Pi 0.87.1, stock summarization clips each tool result to its first 2,000
characters. The final error or test outcome in a long log may never reach the
summarizer.

proper-compact sends the full public text selected for compaction to the
summarizer and lets the agent retrieve original evidence afterward. Use it for
long debugging and implementation sessions where an exact failure, constraint,
or earlier decision matters. Pi's context edits are still respected.

Choose the summarizer model, reasoning effort, input/output budgets, call limit,
timeout, and fallback behavior through `/compact-config`. Pi still owns when
compaction happens and which recent messages remain verbatim. No separate
history database or service is needed.

Summaries remain lossy. Complete input and access to original evidence do not
guarantee factual retention, lower cost, or better task performance.

Requires Pi **0.87.0+** and Node **22.19+**.

## Install

Install an npm release:

```bash
pi install npm:proper-compact
```

Or install from the repository root of this checkout:

```bash
pi install ./proper-compact
```

Then run these commands inside Pi to load the extension and open its settings:

```text
/reload
/compact-config
```

Defaults enable compaction with the current session model and low reasoning
effort. Configuration is optional; continue working normally or run `/compact`
to compact manually.

Pi supplies the peer packages. `npm install` is needed only for development.
Do not run another custom compaction replacement alongside this package:
Pi's last truthy before-hook result wins, and cancellation short-circuits.

**CLIProxyAPI compatibility:** the installed `@router-for-me/pi-cliproxyapi-provider`
proactive-compaction controller clears pending synthetic overflow in its own
before-compaction hook. Load that provider extension **before proper-compact**,
or configure a different summarizer provider/model. Otherwise, pending overflow
for the active model can intercept a summary request before the clearing hook
runs, causing stock fallback or cancellation. A fresh summary session ID does
not prevent this provider behavior. The extension does not modify vendor state;
load-order-independent compatibility needs an upstream provider fix.

## Behavior

Native `/compact`, automatic compaction, overflow recovery, and ordinary
`/tree` summaries use the extension. Pi still owns triggering, retained recent
messages, cut boundaries, history persistence, and navigation.

The summarizer receives complete text, tool arguments, result status, and source
IDs instead of Pi's first-2,000-character tool-result previews. One request is
used when the source fits. Otherwise, bounded sequential chunks cover every
serialized character, carrying the validated checkpoint between calls. Input
that would exceed the configured call count is rejected before inference.

Ordinary compaction uses Pi's context-edited projection: omitted messages stay
omitted, replacement content keeps its original source ID, and the latest edit
on the active branch wins. Branch summaries deliberately describe raw abandoned
history, matching stock Pi, so they can include text omitted from model context.

The checkpoint is structured and prompted to preserve goals, constraints,
progress, decisions, next steps, critical context, and artifact/evidence
references. Split-turn prefixes are identified separately from completed
history. Prior checkpoints, conversation data, and instructions have separate
sections. The instructions request a continuation checkpoint without
reconstructing later messages or declaring unfinished work complete. Partial,
empty, tool-bearing, malformed, and oversized checkpoints are rejected.
No ordinary outbound context is pruned, deduplicated, or rewritten.

Images are represented by omission markers; private thinking and provider
signatures are not sent to the summarizer. Summaries remain lossy. Full input
coverage and a valid format do **not** guarantee factual retention or resistance
to malicious instructions in source text.

## Recall original evidence

The model can call `compact_recall` without another database or service:

```text
compact_recall({"query":"expected owner=42"})
compact_recall({"entryId":"returned-entry-id","offset":0,"limit":8000})
```

Recall reads original history, not context-edit replacements or omissions.
Search is literal and case-insensitive over serialized public text. It returns
at most eight matching entries and a `nextOffset`. Reading an entry returns
paged serialized text, `totalChars`, and `nextOffset`; the default page is 8,000
characters and the maximum is 16,000. JSON decoding recovers the original text
content, including escaped newlines. Offsets count UTF-16 characters in the
serialized representation. Search offsets count matching entries instead.
Public-text projections retain their originating `entryId`. If several entries
have indistinguishable projections, `entryIds` lists candidate sources rather
than assigning a potentially incorrect ID.

Access is limited to the current session's branch and source branches explicitly
referenced by its branch summaries. No arbitrary files, unrelated branches,
other sessions, hidden custom state, private thinking, or image bytes are read.
A fork/export may omit a referenced branch's original entries; recall reports
unavailability rather than reading a different session file. Mechanical access
does not guarantee that the model will request the right evidence.

## Configuration

`/compact-config` opens a native settings menu showing every current value.
Choose a setting to edit it; valid changes save immediately. Select Done or
press Escape to close. Cancelling a submenu or input leaves that setting alone;
invalid limits show a warning and return to the menu.

The model picker lists authenticated models within the session scope and offers
Current session model. Thinking offers Inherit session. For the input token
limit, enter `auto` or leave the input blank to restore automatic budgeting.
Numeric inputs use tokens, calls, and milliseconds as labelled.

Settings live in `~/.pi/agent/proper-compact.json` (or the corresponding
`PI_CODING_AGENT_DIR` location). No reload is needed; active summary requests
keep their captured settings. Without a UI, the command prints the settings
and an update hint to stderr. JSON updates remain available for automation:

```text
/compact-config {"maxOutputTokens":8192,"thinking":"low"}
/compact-config {"model":"provider/exact-model-id"}
/compact-config {"model":null,"onError":"cancel"}
/compact-config {"enabled":false}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Use custom summaries; false delegates to Pi. |
| `model` | `null` | Current model, or an exact authenticated `provider/model` within session model scope. |
| `thinking` | `"low"` | Independent effort; null inherits the session; off disables explicit reasoning. |
| `maxInputTokens` | `null` | Automatic request budget; explicit values further restrict it. |
| `maxOutputTokens` | `8192` | Requested response ceiling, independent of Pi's trigger reserve. |
| `maxCalls` | `4` | Maximum sequential summary requests per operation, no internal retries. |
| `timeoutMs` | `120000` | Deadline for the complete summarization operation. |
| `onError` | `"stock"` | Warn and use stock Pi, or cancel and retain original context. |

Automatic input budgeting reserves output room, 4,096 tokens, and 10% additional
headroom. UTF-8 bytes divided by three estimate input size; this is not an exact
provider tokenizer. Later chunks reserve the maximum accepted JSON-encoded
checkpoint size. Choose a larger-context summarizer, increase an explicit input
budget/call ceiling, or reduce the output budget when preflight cannot fit.

### Budget and provider limits

Requests go through Pi's authenticated `modelRegistry.streamSimple`, preserving
request-time credentials, endpoint overrides, headers, environment, and provider
selection. The extension never handles API keys or implements HTTP transports.

The model descriptor's output ceiling is constrained for summary calls so
Anthropic/Bedrock's additive thinking allowance cannot exceed it. Pi 0.87.1's
Codex-style transport may omit the wire output cap. Accordingly,
`maxOutputTokens` is **not a guaranteed spending limit** on every backend.
Accepted checkpoint text has an additional JSON-encoded byte bound of four
times that setting. The deadline bounds local waiting, including a provider
that ignores cancellation, but cannot guarantee cancellation of remote billing.

Each request has a fresh routing session ID and requests no cache retention.
Backend caching policy can differ. No cost or quality superiority is claimed
without a fixed-model task-level comparison.

### Failure and accounting

With the default `onError: "stock"`, expected failures visibly delegate to Pi.
**Stock's tool-output truncation applies on that fallback.** Use `"cancel"` if
that degradation is unacceptable. User cancellation or session shutdown never
starts stock fallback. Unexpected programming/I/O errors are surfaced through
Pi's extension runner, whose own fallback policy remains authoritative.

Returned response usage is summed across chunks and passed to Pi for successful
checkpoint accounting. Hidden `proper-compact:attempt` entries record generated,
failed, or cancelled attempts without transcript content or credentials.
`generated` means returned by this hook, not necessarily committed: another
extension can override it. Failed-attempt usage is retained in those entries,
but Pi's normal session totals do not aggregate custom metadata. Responses
delivered before cancellation are accounted before checking the signal. No
attempt entry is appended after session shutdown/replacement, to avoid writing
into a different session. Providers may not report final usage when interrupted.

Custom replacement-format `/tree` requests delegate untouched to stock Pi;
ordinary branch focus instructions stay under the checkpoint contract.

## Development

```bash
npm install
npm test
npm run typecheck
npm run test:coverage
```

Tests use Pi 0.87.1 compaction/persistence and registry routing with mocked model
responses. They cover trailing/interior failures, chunk coverage, repeated
compaction, continuation prompts, thinking exclusion, context-edit provenance,
plain-text refusals, invalid output, cancellation,
raw branch-summary/recall semantics, branch-scoped recall, skill recovery,
and bundled-module loading. No credentials or live provider calls are required.

From the repository root, both pre-commit gates include this package. Release
configuration uses `proper-compact-v*` tags. First publication requires
maintainer authentication, environment/tag-policy setup, then npm
trusted-publisher registration; no publication happens during development.

## Design evidence

- [Pi compaction](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/compaction.md): native lifecycle and structured checkpoints. Tested against released 0.87.1, not unreleased main.
- [Pi split-turn prompt fix](https://github.com/earendil-works/pi/pull/9908): continuation wording and conversation/instruction separation address reported Fable 5.1 refusals. Our offline tests check the prompt contract, not live-model refusal rates.
- [Factory compression evaluation](https://factory.com/news/evaluating-compression): motivation for structured task state and artifact tracking; vendor-reported, not an independent ranking.
- [The Complexity Trap](https://arxiv.org/abs/2508.21433): compare complete task cost, not context reduction alone.
- [Addressable Recall Compaction](https://arxiv.org/abs/2607.25066): mechanical recoverability and successful agent recall are distinct. This package reuses Pi's existing session history, not the paper's external storage system.

Defaults are starting points, not empirically established optima for every model.

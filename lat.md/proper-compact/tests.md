---
lat:
  require-code-mention: true
---
# Verification

Offline tests exercise real Pi compaction and session persistence, registry routing, source coverage, recall, and lifecycle safety with deterministic model replies. They do not establish live-model summary quality.

## Configuration and validation

Configuration rejects invalid types, ambiguous models, unknown fields, and unsafe budgets. Malformed configuration is not overwritten. Checkpoints require complete bounded text, a valid envelope, and ordered nonempty sections.

## Settings menu

Menu fixtures exercise the registered command's native dialogs, covering all settings, current values, scoped models, automatic defaults, invalid input, cancellation, fresh-disk merging, shutdown, and headless JSON updates.

Fixtures verify no model calls or writes on dismissal, and no replacement of malformed configuration. Dialog behavior is tested without an interactive terminal or credentials.

## Evidence and chunking

Interior and trailing errors, result status, IDs, and distinct repeated results survive serialization.

Native custom-message, branch-summary, and compaction projections retain provenance; indistinguishable projections return candidate IDs. Native compaction tests replace user, assistant, tool-result, and custom-message content, verifying latest-edit source IDs, omitted-attempt exclusion, and unchanged original entries. Multi-call chunk plans cover the source contiguously without splitting surrogate pairs and reject excessive call counts before inference.

## Native compaction lifecycle

Pi 0.87.1 AgentSession compaction methods persist hook summaries, native cut boundaries, and usage while preserving original entries.

The offline prototype fixture supplies the host's message-provenance map. Split focus and previous state survive three cycles; outgoing prompts separate conversation data from continuation instructions, include public progress, and exclude private thinking, signatures, and retained later messages. Chunk usage is summed across calls.

## Failure and cancellation

Rejected output delegates visibly to stock or cancels according to configuration. Preflight spends nothing on impossible plans.

Plain-text refusals never become custom checkpoints: stock policy persists only the fallback, while cancel policy retains the prior context. Both preserve returned failed-attempt usage.

Shutdown, repeated session start, uncooperative completions, and deadlines cannot persist partial state or silently start fallback inference. A deterministic queued-abort race verifies that delivered usage is retained without checkpoint persistence.

## Provider routing

The native registry/runtime path retains request-time endpoint, header, and environment overrides. Summary calls constrain the request-local model ceiling without changing the active model or exposing tools.

A simulated pending-overflow wrapper proves the documented hook-order limitation and different-model escape hatch, not live CPA transport compatibility.

## Branch summaries and recall

Branch summaries require opt-in and retain focus. Recall pages original public text after compaction, follows explicit source-branch references, excludes unrelated branches and private data, and paginates search without repeating matches.

Context-edit replacements and omissions affect ordinary compaction but deliberately do not rewrite branch summaries or recall. A native branch-collection regression verifies that those raw-history paths preserve original evidence.

Native disk resume retains original entries and compaction usage. Branch extraction keeps the active path but drops abandoned source entries; recall cannot follow missing references into the parent session file.

## Skill interoperability

proper-base restores explicitly invoked skills exactly once after custom compaction using unchanged session history. Compaction does not replace its context transform or require an installation order.

## Bundled loading

Distributed runtime files load with Pi's public virtual module roots and register only the intended hooks, command, and recall tool. No private provider-module imports or ordinary context-pruning handlers are introduced.

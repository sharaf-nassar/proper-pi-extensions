---
lat:
  require-code-mention: true
---
# Verification

proper-pacify uses Node's built-in test runner for offline configuration, model-call, command, automatic-mode, and transcript checks.

## Configuration and model resolution

The fixture verifies defaults, sanitized configuration, provider-qualified lookup, deterministic provider preference, model-supported effort filtering, and unsupported-level clamping.

## Model request contract

The fixture verifies one-call rewriting, immutable tone-only instructions, unchanged model input, configured effort and priority options, text extraction, and rejection of truncated output.

It also asserts that the operative contract and the prompt travel in the user turn, that the prompt occupies the end of that turn so a forged fence cannot end the data region early, that the system prompt carries only the role declaration and the tone guidance, and that the request carries text only, with no images attached.

## Rewrite integrity fixture

The fixture drives envelope parsing directly, with no model call.

It asserts that a well-formed envelope yields the trimmed rewrite, and that verbatim replies recorded from two provider-injected agent identities are rejected, including a bare tool call and a refusal. It also asserts that an envelope alone is insufficient: an over-long body and a blank body both raise `PacifyError`, which fails open to the original prompt.

## Scheduled automatic mode fixture

The fixture covers time parsing, window evaluation, storage, and rejection of unusable windows.

It asserts an inclusive start and exclusive end, a window that wraps midnight, zero-length and malformed windows never enabling automatic mode, a schedule surviving a save and load round trip, invalid stored windows falling back to off, and a boolean setting ignoring the clock.

## Reload and dispatch safety fixture

The fixture registers the extension twice against one installed wrapper, standing in for the module replacement a reload performs.

It verifies that the wrapper routes to the newest instance rather than the one that installed it, that a command with no argument reaches the chain without being sent to the model, and that a transcript write which throws still returns the rewritten prompt instead of failing the dispatch.

## Session override fixture

The fixture drives `/pacify-session` against a stored default of off and asserts that it enables pacification for the next input while the configuration file keeps its stored value.

It also verifies that repeating `/pacify-session` leaves automatic mode on, that `/unpacify-session` suspends it, that a reload keeps the override, that a replacement session clears it, and that neither command writes to disk.

## Bypass command fixture

The fixture drives `/unpacify` with automatic mode on and a model registry that throws if it is called.

It asserts that input beginning with either bypass command reaches dispatch untransformed, that the command sends its argument verbatim with template expansion enabled, that the re-sent extension-origin prompt passes the one-shot guard, that no transcript entry is written, and that an empty argument reports usage instead of sending a prompt.

## Dispatch priority fixture

The fixture installs the wrapper on a fake runner whose own handler records the text it receives, standing in for an extension registered ahead of this package.

It verifies that the foreign handler observes only pacified text, that the wrapper returns the rewritten prompt, that exactly one transcript entry is written, and that repeated installation does not stack wrappers.

## Extension flow

The fixture verifies commands, automatic mode, transcript entries, and failure behavior.

It covers slash-token preservation, interactive and extension-origin input, one-shot recursion avoidance, template expansion, and cancellation.

It asserts that the entry holds exactly the original text and the target model, that a successful rewrite emits no notification beside it, and that a provider failure reports the error without appending a second entry.

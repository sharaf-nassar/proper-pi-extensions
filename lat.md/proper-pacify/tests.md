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

## Scheduled automatic mode fixture

The fixture covers time parsing, window evaluation, storage, and rejection of unusable windows.

It asserts an inclusive start and exclusive end, a window that wraps midnight, zero-length and malformed windows never enabling automatic mode, a schedule surviving a save and load round trip, invalid stored windows falling back to off, and a boolean setting ignoring the clock.

## Reload and dispatch safety fixture

The fixture registers the extension twice against one installed wrapper, standing in for the module replacement a reload performs.

It verifies that the wrapper routes to the newest instance rather than the one that installed it, that a command with no argument reaches the chain without being sent to the model, and that a transcript write which throws still returns the rewritten prompt instead of failing the dispatch.

## Session override fixture

The fixture drives `/pacify-session` against a stored default of off and asserts that toggling enables pacification for the next input while the configuration file keeps its stored value.

It also verifies that a second toggle suspends automatic mode, that a reload keeps the override, and that a replacement session clears it.

## Dispatch priority fixture

The fixture installs the wrapper on a fake runner whose own handler records the text it receives, standing in for an extension registered ahead of this package.

It verifies that the foreign handler observes only pacified text, that the wrapper returns the rewritten prompt, that exactly one transcript entry is written, and that repeated installation does not stack wrappers.

## Extension flow

The fixture verifies commands, automatic mode, transcript entries, and failure behavior.

It covers slash-token preservation, interactive and extension-origin input, one-shot recursion avoidance, template expansion, cancellation, and fail-open logging.

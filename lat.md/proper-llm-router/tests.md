# Verification

The proper-llm-router package uses one executable smoke file because the extension has no build system or separate unit-test framework.

## Harness structure

`smoke.ts` imports the extension and its public pure functions, runs deterministic assertions, then calls one live route.

A deterministic assertion failure stops before network work. The harness first loads a guaranteed-missing config path and verifies that `exemplarsPath` resolves beside the moved extension, then uses normal config, accepts an optional CLI task, calls `route()`, and requires non-empty verdict fields.

## Quota aggregation fixtures

The quota fixtures verify lane averaging and fail-open handling for missing data.

They cover model-specific Claude usage overriding lower general usage, shared Codex account usage blocking all Codex arms, no-data producing no blocked arms, averages above and below configured thresholds, and the difference between average usage and any-account-under logic. No fixture lands exactly on the threshold.

These assertions exercise `quotaBlockedArms()`.

## Swap fixtures

The swap fixtures build a complete availability map with selected arms marked down.

`availWith()` supports assertions that an available pick stays unchanged, Fable swaps to Sol, Terra swaps to Opus, Sonnet swaps to Luna, Luna swaps to Haiku, and a request throws when Fable and Sol are both unavailable.

These assertions exercise `resolveVerdictModel()` without network calls.

## Sentinel fixtures

The sentinel fixtures verify marker parsing and loose arm-name resolution.

They cover no marker, CPA ID syntax, case and whitespace tolerance, seam whitespace collapse, exact arm keys, unique fragments, dated Claude IDs, ambiguous names, and unknown names.

These assertions exercise `parseSentinel()` and `resolveArm()`.

## Judge override fixtures

The override fixtures verify prompt replacement and stable arm-slot execution mapping without network calls.

They cover arbitrary CPA target IDs, simultaneous replacement when one target names another source arm, preserved selection keys, unchanged labels for unconfigured slots, overridden CPA lookup, and default CPA lookup.

These assertions exercise `applyJudgeModelOverrides()` and `judgeCpaModel()`. They do not exercise live target availability, quota behavior for arbitrary targets, registry switching, or persistence from the override picker.

## Command pin fixtures

The command fixtures verify that configured slash commands bypass the judge only when their model resolves.

They cover keys with and without `/`, case-insensitive matching, CPA IDs in pin values, nullable effort, invalid models falling through, rejection of prefix matches, and rejection when a command token is not at the start of the prompt.

These assertions exercise `commandPin()` as pure matching logic. They do not prove that the pi input event skips the judge, applies quota swapping, switches the model, or sets thinking effort; those behaviors remain integration-only.

## Config menu fixture

The config-menu fixture registers the extension against a minimal pi API and records the real command handler's select menus.

It verifies that the top-level menu has one `Judge` entry and that entry opens `Model`, `Effort`, and `Overrides` choices. The fixture stubs only the management-key HTTP probe and exits before any picker performs provider work or writes config.

## Live route

The final check runs the complete rubric, exemplar, judge, availability, quota, and swap path.

Its default task is a README typo. Passing a CLI argument replaces that task. The script prints the full verdict as formatted JSON after validating required fields.

This check is intentionally live and can fail because of credentials, CPA health, judge health, strict-schema support, quota, exemplar data, or configuration. The live route itself does not read pi's model registry or call `pi.setModel`.

There is no fixture-only flag. Every invocation that passes the deterministic assertions proceeds to the external live route, which prevents an offline CI job from using the current harness unchanged.

## Current coverage gaps

The smoke harness does not exercise every extension behavior.

There are no automated fixtures for management API response parsing, exact CPA ID matching, cache expiry and cached failures, config schema errors, exemplar similarity thresholds, malformed corpus handling, exact threshold equality, judge retries, network timeouts, Esc cancellation, repeated or empty sentinels, router-command namespace bypass, notice text, pi event ordering, registry fallback and failed `setModel`, thinking-level application, live override availability, override picker persistence, judge picker persistence, masked secret input, JSON editor behavior, or placeholder safety when models are absent.

The live route proves one integrated verdict, but it does not isolate which external contract failed. The repository has no CI workflow to run it. Changes in these uncovered areas need focused manual checks or new pure fixtures.

## Required validation

Documentation-only changes must pass lat.md link and section validation.

Run `lat check` after editing `lat.md/`. Behavior changes should also run the smoke command documented in `operations.md` when configured services are available.

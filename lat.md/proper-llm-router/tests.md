# Verification

The proper-llm-router package uses Node's built-in test runner for offline compatibility fixtures and an executable smoke file for routing logic plus one live verdict.

## Harness structure

`npm run test:unit` runs `test/*.test.ts`, while `npm run test:smoke` runs `smoke.ts`. Both use Node's experimental TypeScript type stripping; `npm test` runs them in that order. Unit tests include a no-CPA provider route and conditional config UI.

`smoke.ts` imports the extension and its public pure functions, runs deterministic assertions, then calls one live route. A deterministic assertion failure stops before network work. The harness first loads a guaranteed-missing config path and verifies that `exemplarsPath` resolves beside the moved extension, then uses normal config, accepts an optional CLI task, calls `route()`, and requires non-empty verdict fields.

## Quota aggregation fixtures

The quota fixtures verify lane averaging and fail-open handling for missing data.

They cover model-specific Claude usage overriding lower general usage, shared Codex account usage blocking all Codex arms, no-data producing no blocked arms, averages above and below configured thresholds, and the difference between average usage and any-account-under logic. No fixture lands exactly on the threshold.

These assertions exercise `quotaBlockedArms()`.

## Usage rate-limit fixture

The usage rate-limit fixture verifies that a definitive upstream 429 blocks the exhausted account's lane instead of disabling the threshold gate.

`test/quota-rate-limit.test.ts` runs the real `armAvailability()` path with CPA HTTP responses stubbed at the external boundary. A Claude usage 429 must make Claude arms unavailable at an 80% threshold while leaving listed Codex arms available.

`test/quota-burst-throttle.test.ts` covers the burst-throttle variant in its own file because `armAvailability()` caches usage in module state and each test file gets its own process. A Codex usage body with `allowed: false` and `limit_reached: true` but only 70% window usage must block Codex arms at an 80% threshold while leaving listed Claude arms available.

## Judge fast fixture

The judge fast fixture verifies that `judge.fast` controls the `service_tier` field on the judge request.

`test/judge-fast.test.ts` asserts the loaded default is off, then runs the real `route()` path with the CPA listing and judge completion stubbed at the fetch boundary. With `judge.fast` enabled the captured judge body must carry `service_tier: "priority"`; with defaults it must omit the field entirely. The verdict also omits the redundant harness field.

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

They cover arbitrary target IDs, simultaneous replacement when one target names another source arm, preserved selection keys, unchanged labels for unconfigured slots, overridden target lookup, and default lookup.

These assertions exercise `applyJudgeModelOverrides()` and `judgeModelName()`. They do not exercise live target availability, quota behavior for arbitrary CPA-backed targets, or persistence from the override picker.

## Command pin fixtures

The command fixtures verify that configured slash commands bypass the judge only when their model resolves.

They cover the built-in `/refine` pin, keys with and without `/`, case-insensitive matching, CPA IDs in pin values, nullable effort, invalid models falling through, rejection of prefix matches, and rejection when a command token is not at the start of the prompt.

These assertions exercise `commandPin()` as pure matching logic. They do not prove that the pi input event skips the judge, applies quota swapping, switches the model, or sets thinking effort; those behaviors remain integration-only.

## Extension-origin input fixture

The extension-origin fixture invokes the registered input handler with the same `/skill:ponytail-audit` message produced by an extension command alias.

It verifies that an extension-origin first input switches away from `llm-router/auto` instead of continuing to the placeholder, and that a second input does not route again after the provider changes. The fixture uses the real input handler with a minimal model registry and pi API; it does not call the judge because the alias is a bare slash command.

## Config menu fixture

The config-menu fixture registers the extension against a minimal pi API and records the real command handler's select menus.

It verifies that the top-level menu has one `Judge` entry plus a top-level `Overrides` entry, and that the `Judge` entry opens `Model`, `Effort`, and `Fast` choices. It exits before any picker performs provider work or writes config.

## Non-CPA routing fixture

The non-CPA fixture verifies provider-aware model resolution and one complete first-input route without CPA.

It checks that unqualified duplicate IDs prefer CPA when available, provider-qualified values resolve exactly, and direct Anthropic/OpenAI Codex models handle judge selection, availability, pinned commands, and `pi.setModel()` while the judged fixture rejects every raw network request.

It also verifies that the factory self-registers exactly one `llm-router` provider whose model list contains `auto` and whose base URL stays on the dead port-1 placeholder.

## Non-CPA config fixture

The non-CPA config fixture verifies that CPA-only controls disappear when Pi has no authenticated `cliproxyapi` model.

It records the real `/llm-router-config` menu, requires quota and management-key actions to be absent, opens the JSON editor, and requires `cpaBase`, `cpaKeyEnv`, quota, and management-key fields to be omitted. Its TUI picker case proves Up wraps from the first menu entry to `Done`, and Enter accepts the stored direct judge model and `off` fast setting rather than the first displayed choice.

## Ultra compatibility fixtures

`test/ultra-thinking.test.ts` exercises the reload-safe prototype helpers against fake classes without editing pi internals. Its payload check imports the Pi 0.84.2 runtime pinned by the package lock.

It verifies the shared thinking-level list ends in `ultra`, model capability filtering requires a non-empty `thinkingLevelMap.ultra`, native available-level discovery appends `ultra` only for supported models, unsupported transitions clamp to the highest available level, repeated installation does not stack patches, and the editor border reuses pi's maximum-effort theme color. A second fixture captures Pi's bundled OpenAI Responses payload before network I/O and verifies the model mapping sends `reasoning.effort: "ultra"`.

The fixture does not instantiate a complete `AgentSession`, settings selector, or interactive mode. A host-process smoke check is still required when pi changes its module layout or method names.

## Live route

The final check runs the complete rubric, exemplar, judge, availability, quota, and swap path.

Its default task is a README typo. Passing a CLI argument replaces that task. The script prints the full verdict as formatted JSON after validating required fields.

This check is intentionally live and can fail because of credentials, CPA health, judge health, strict-schema support, quota, exemplar data, or configuration. The live route itself has no Pi registry context, so it retains the legacy CPA target path and does not call `pi.setModel`.

There is no fixture-only flag. Every invocation that passes the deterministic assertions proceeds to the external live route, which prevents an offline CI job from using the current harness unchanged.

## Strict validation

Strict compiler, lint, and coverage checks prevent new dynamic-data shortcuts from weakening router guarantees.

`npm run typecheck` enables strict mode, exact optional properties, unchecked-index diagnostics, unused checks, fallthrough checks, and no-emit compilation. Exact development pins for the coding-agent and TUI host packages resolve the extension's direct Pi imports, while runtime installation uses peer instances supplied by Pi. Biome rejects explicit `any` in runtime source. `npm run test:coverage` requires at least 40% lines, 55% branches, and 52% functions from the focused unit fixtures. Package `prepack` runs `test:unit` plus type checking and deliberately excludes the credentialed live smoke.

## Current coverage gaps

The smoke harness does not exercise every extension behavior.

There are no automated fixtures for successful management API usage parsing, cache expiry and cached failures, config schema errors, exemplar similarity thresholds, malformed corpus handling, exact threshold equality, judge retries, network timeouts, Esc cancellation, repeated or empty sentinels, router-command namespace bypass, notice text, full pi dispatch ordering, failed `setModel`, complete native thinking-picker interaction, live override availability, override-picker persistence, judge-picker persistence, masked secret input, JSON editor saving, or placeholder safety when models are absent.

The live route proves one integrated verdict, but it does not isolate which external contract failed. The repository has no CI workflow to run it. Changes in these uncovered areas need focused manual checks or new pure fixtures.

## Required validation

Documentation-only changes must pass lat.md link and section validation.

Run `lat check` after editing `lat.md/`. Behavior changes should run strict type diagnostics, unit fixtures, and the smoke command documented in `operations.md` when configured services are available.

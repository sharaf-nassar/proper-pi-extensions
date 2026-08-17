# Availability and quota

Availability combines CPA model listing, optional per-credential model counts, optional account usage, and a test-only deny list.

## Model listing

`armAvailability()` treats CPA's `/v1/models` response as the base availability signal.

A model listed by CPA has at least one serving account. The request uses the key named by `cpaKeyEnv`; an empty value sends no useful credential but still performs the request. Direct routes check each arm's built-in CPA ID, while judged routes check the effective target ID for each semantic slot.

When a management key is available, `/v0/management/auth-files/models` adds a second check. A listed model must also appear under at least one credential. Failure of this optional endpoint discards credential counts and keeps listing-only behavior.

Both checks compare exact CPA IDs. The dated-suffix tolerance used for pi registry lookup does not apply to CPA listing or credential counts; the registry-lookup section in `routing.md` documents that separate rule.

## Usage collection

The threshold gate reads active Claude and Codex credentials through CPA's management API passthrough.

The management key comes from `cpaManagementKey`, then from the environment variable named by `cpaManagementKeyEnv`. Disabled and unavailable credentials are ignored.

For Claude, the router calls `api.anthropic.com/api/oauth/usage`. It records the maximum account-wide percentage and maps weekly model windows from named fields and `limits[]` entries to Claude arms. Unscoped `limits[]` values can also raise the account-wide figure; Haiku depends on the display-name mapping because it has no named window key.

For Codex, the router calls `chatgpt.com/backend-api/wham/usage`. It records the maximum `used_percent` or `usedPercent` across `rate_limit`, with `rate_limits` accepted as a compatibility fallback. All Codex arms share that account-wide value.

An upstream 429 is definitive exhaustion, so that credential contributes 100% account-wide usage instead of being dropped. Other failed credential probes are dropped. A successful 2xx response with no recognized usage fields still becomes a zero-valued account, which can lower the lane average and prevents the gate from being marked skipped. If no credential returns any parsed account object, the threshold gate has no data and must not block an arm.

## Threshold aggregation

`quotaBlockedArms()` blocks an arm when average effective usage across accounts in its lane is greater than or equal to `quotaMaxPct`.

An account's effective usage for one arm is the larger of its account-wide usage and that arm's model-specific usage. Claude and Codex accounts are averaged separately. A lane with no parsed accounts cannot block any of its arms.

For an override target that resolves to a known arm, threshold blocking follows that target arm's lane and model-specific usage. An arbitrary target has no usage mapping, so only live listing and credential-count checks gate it; the percentage threshold fails open for that slot.

This is lane averaging, not a minimum-free-account rule. Two accounts at 100% and 80% produce 90%; they are blocked at an 85% threshold and allowed at 95%.

## Swap resolution

A down verdict moves once to a fixed cross-harness target.

| Requested arm | Swap target |
| --- | --- |
| `claude-fable-5` | `gpt-5-6-sol` |
| `gpt-5-6-sol` | `claude-fable-5` |
| `claude-opus-5` | `gpt-5-6-terra` |
| `gpt-5-6-terra` | `claude-opus-5` |
| `claude-sonnet-5` | `gpt-5-6-luna` |
| `claude-haiku-4-5` | `gpt-5-6-luna` |
| `gpt-5-6-luna` | `claude-haiku-4-5` |

The graph is intentionally asymmetric at the lower tiers. Luna returns to Haiku, while both Haiku and Sonnet can fall to Luna.

Every swap crosses the Claude/Codex lane boundary. Availability therefore does not alter the judge's rubric, but it can change the harness that executes the task and accept a weaker fit to keep routing alive.

A judged route swaps semantic slots first, then applies the override configured for the final slot. It throws when both slots are down, then the input handler uses the configured fallback. A direct command or sentinel keeps its requested arm when the check cannot produce a usable choice, as defined by the direct-route contract in `routing.md`.

## Failure policy

Quota probing should reduce avoidable failures, not create a new outage mode.

- Failure of the per-credential model-count endpoint falls back to `/v1/models`.
- An account usage call returning upstream 429 counts as 100% usage because the account cannot currently serve work.
- Other failures of one account usage call drop that account.
- Failure of all usage calls skips only the threshold gate.
- Failure of `/v1/models` rejects a judged route, which then uses `fallbackModel`.
- Failure of the same probe on a direct route keeps the direct arm and reports that the quota check was skipped.
- `fallbackModel` itself is not checked against CPA listing, credential counts, or quota before selection.

When a threshold is configured but no usage data is available, judged verdicts set `quota_gate_skipped` so the user sees that the management key or API needs attention.

## Caches and simulation

Account usage is cached in process memory for 60 seconds to avoid several upstream calls on every prompt.

The cache is global rather than keyed by CPA URL, management key, or threshold. Config changes involving those fields may therefore use old usage data for up to 60 seconds.

A failed or no-data usage probe is cached as `null` for the same interval. Fixing a management key or recovering CPA can therefore leave the gate visibly skipped until the entry expires.

`CPA_SIMULATE_UNAVAILABLE` adds exact arm keys to the down set after live probes. It is a deterministic test hook for swaps and fallback, not a substitute for the management quota gate.

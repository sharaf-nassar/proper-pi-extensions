# Model arms and rubric

The router exposes seven stable arm keys and maps each key to the CPA model identifier used for the session switch.

## Arm catalog

Arm keys are internal routing names; CPA identifiers are provider model IDs.

| Arm key | CPA model ID | Lane | Intended tier |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | `claude-haiku-4-5-20251001` | repository and agentic | narrow fixes and mechanical edits |
| `claude-sonnet-5` | `claude-sonnet-5` | repository and agentic | routine multi-file work and test suites |
| `claude-opus-5` | `claude-opus-5` | repository and agentic | cross-component diagnosis and high-impact changes |
| `claude-fable-5` | `claude-fable-5` | repository and agentic | ambiguous architecture and protocol-level work |
| `gpt-5-6-luna` | `gpt-5.6-luna` | self-contained | trivial or mechanical standalone edits |
| `gpt-5-6-terra` | `gpt-5.6-terra` | self-contained | well-specified functions, endpoints, or classes |
| `gpt-5-6-sol` | `gpt-5.6-sol` | self-contained | subtle algorithms, performance work, and tricky local logic |

`resolveArm()` accepts an arm key, a CPA ID, or a unique fragment. Unknown and ambiguous names return no arm rather than guessing.

## Lane decision

Lane selection depends on where the missing information lives.

Any task that requires repository inspection, named project files, tests, integration work, or agentic tool use goes to the Claude lane. The Codex lane is limited to standalone tasks whose code and specification are already present in the prompt.

This distinction comes before model strength. A mechanically specified repository edit still belongs to the Claude lane because repository navigation was the measured reliability separator.

## Tier decision

The judge chooses the cheapest tier expected to finish without quality loss.

- Concurrency, distributed correctness, protocol or migration design, and unclear scope route to `claude-fable-5`.
- Cross-component diagnosis, authentication, data-loss risk, and hot-path changes route to `claude-opus-5`.
- Routine multi-file repository work routes to `claude-sonnet-5`.
- Localized, well-reproduced repository work routes to `claude-haiku-4-5`.
- Subtle standalone correctness or performance work routes to `gpt-5-6-sol`.
- Fully specified standalone implementation routes to `gpt-5-6-terra`.
- Trivial standalone edits route to `gpt-5-6-luna`.

When two adjacent tiers both look plausible, the rubric chooses the stronger tier. Quality protection wins the tie.

## Deterministic names

Overrides use the same arm resolver as the judge output checks.

`commandPin()` matches slash-command names case-insensitively and ignores an optional leading slash in config keys. `parseSentinel()` extracts the task-text override before the model switch.

The resolver normalizes dots and spaces to hyphens. It also accepts dated CPA IDs when they contain one complete arm key. Broad fragments such as `claude` remain invalid because they match several arms.

## Judge model overrides

Overrides replace the execution model occupying a semantic arm slot without changing that slot's calibrated lane or tier.

The judge prompt shows the configured target model in every rubric and exemplar position owned by the source arm. A stable selection key remains beside the target because the strict verdict schema still returns one of the seven arm keys. Several slots may point to the same target.

Overrides apply only to judged routes. Command pins and sentinels continue to name and execute their configured arms directly. A quota swap moves between semantic slots first, then applies the target configured for the final slot.

## Availability does not change the rubric

The judge reasons about capability slots, not current subscription state.

The seven semantic arm slots remain fixed. The swap-resolution contract in `availability.md` applies quota and availability after the verdict, using each slot's effective target model when overrides are configured. This keeps the rubric's use cases stable while allowing the execution model set to change.

The lane rule constrains the source slot, not necessarily the final execution model. Fixed swaps cross harnesses, and an arbitrary target can belong to either provider, so the judge's `harness` field is advisory when the target cannot be resolved to a known arm.

## Changing the arm catalog

Adding, renaming, or retiring an arm requires coordinated changes because the catalog is repeated in routing policy, fallback policy, fixtures, and measured data.

Update the `ARMS` mapping, Claude lane membership, fixed `SWAP` graph, rubric menu and tier text, smoke fixture arm list and expectations, exemplar `rates` keys, and the catalog and swap tables in `lat.md/`. Every arm needs a registry-resolvable CPA ID and a deliberate one-hop swap target.

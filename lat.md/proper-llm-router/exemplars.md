# Measured exemplars

The exemplar corpus gives the judge nearby tasks with measured verifier outcomes, not hand-written routing labels.

## Row contract

Each line of `exemplars.jsonl` is one JSON object with `task_id`, `prompt`, and `rates`.

`prompt` is the prior task text. `rates` maps any evaluated arm to a score where `1.0` means reliable, a positive value below `1.0` means flaky, and `0.0` means failure. The current corpus uses only `0`, `0.5`, and `1`. Rows may contain one lane or all seven arms.

`task_id` preserves corpus provenance for offline work. Runtime retrieval uses only `prompt` and `rates`.

## Corpus snapshot

The current file contains 112 unique task IDs and 112 unique prompts.

- 54 rows contain only the three Codex arms.
- 32 rows contain only the four Claude arms.
- 26 rows contain all seven arms.
- Claude arms therefore have 58 measured rows each; Codex arms have 80 each.

| Arm | Pass | Flaky | Fail |
| --- | ---: | ---: | ---: |
| `claude-fable-5` | 55 | 1 | 2 |
| `claude-haiku-4-5` | 34 | 7 | 17 |
| `claude-opus-5` | 51 | 2 | 5 |
| `claude-sonnet-5` | 43 | 7 | 8 |
| `gpt-5-6-luna` | 4 | 23 | 53 |
| `gpt-5-6-sol` | 13 | 31 | 36 |
| `gpt-5-6-terra` | 2 | 26 | 52 |

These columns are not all measured on the same tasks: only 26 rows compare all seven arms directly. The corpus-wide totals must not be read as a head-to-head ranking; the rubric's lane rule comes from the repository-task subset. These are routing evidence, not live health or quota data.

## Snapshot maintenance

The corpus is a checked-in measurement artifact, but this repository has no generator or recount script for the summary above.

`task_id` values retain source prefixes from the upstream measurement assembly. When rows change, recount unique IDs, lane coverage, and per-arm pass, flaky, and fail totals before updating this snapshot; runtime code does not verify these documentation statistics.

## Retrieval

`ExemplarIndex` builds a small in-memory TF-IDF index from the corpus.

Tokenization lowercases words, keeps alphanumeric or underscore tokens beginning with a letter, and drops tokens shorter than three characters. Query and row vectors use normalized term frequency times inverse document frequency.

Retrieval sorts by cosine similarity, excludes scores below `0.05` as unrelated, excludes scores above `0.95` as near-identical answer keys, and keeps at most three rows.

Document vectors are normalized once at index construction, so each query costs one dot product per row instead of re-weighting the whole corpus per call. Queries score only the first 4,000 characters of the task — the same slice the judge reads — so retrieval reflects the text behind the verdict.

## Judge note

`exemplarNote()` turns retrieved rows into a short system-prompt appendix.

Each line includes the first 110 normalized characters of the prior prompt and every measured arm sorted by score. Runtime labels are `PASS`, `flaky`, and `FAIL`; numeric scores are not shown to the judge.

The note tells the judge to weigh reliable outcomes heavily. It augments the static rubric but does not change the allowed arm keys. Judge model overrides rewrite arm labels in this note alongside the rubric so measured source-slot outcomes point at the configured targets.

## Loading and failure behavior

The corpus loads lazily on the first routed prompt that requests exemplars.

A missing file, unreadable file, invalid JSON line, or row that fails during index construction disables exemplars for that path. Routing continues with the static rubric. The index is keyed by `exemplarsPath`, so a changed configured path takes effect on the next routed prompt and a load failure is retried only when the path changes; editing the corpus file in place still requires restarting pi.

The loader does not validate the row schema. A structurally bad row that still indexes, such as one with invalid `rates`, can fail later while building the judge note; that failure follows the normal judged-path fallback rather than cleanly disabling exemplars.

Set `JUDGE_EXEMPLARS=0` to skip loading and omit the note. This is useful for controlled comparisons and for running without the corpus.

# Prompt store

The recorded store preserves submitted prompts independently of pi session persistence while keeping startup work and file exposure bounded.

## Project path

Each working directory maps to one file under `~/.pi/agent/proper-history/` using pi's session-directory encoding.

The store directory is created with mode `0700`, and a new JSONL file is created with mode `0600`. Deleting that project file forgets the project's cross-session prompt history; Pi session messages are intentionally not used as a fallback.

## Entry format and append behavior

Each line is JSON containing prompt text `t` and millisecond timestamp `ts`.

Prompts are trimmed before append. Blank prompts, prompts over 4096 characters, and submissions rejected by `Recallable submissions` in `lifecycle.md` are skipped. Long prompts are not truncated because a recalled partial command could look safe to submit. Multiline text remains one escaped JSON line.

Concurrent sessions append one small line at a time. Append failures return false and never interrupt editor submission.

## Bounded reads

Startup reads only the newest 512 KB by default.

When reading from a tail offset, the partial first line is discarded. Empty, missing, malformed, or structurally invalid entries are skipped. A missing timestamp becomes zero so otherwise valid older data remains usable.

## Compaction

A store larger than 2 MB is replaced with its newest 2000 valid entries.

Compaction writes a process-specific temporary file and renames it over the store. Readers therefore see the old or new file, though a concurrent append during the rename window can lose one history entry. This accepted ceiling favors a small dependency-free implementation over locking.

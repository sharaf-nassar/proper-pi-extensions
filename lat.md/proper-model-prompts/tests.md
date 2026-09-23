---
lat:
  require-code-mention: true
---
# Verification

Offline tests exercise pattern matching, configuration validation, built-in prompts, run modes, prompt composition, and real Pi sessions with a recording provider. An opt-in smoke test covers installed pi-subagents children.

## Model patterns

Patterns match `provider/id` or the bare id case-insensitively. `*` crosses `/`, dots stay literal, and patterns without `*` never match substrings.

A `!` pattern excludes what it matches from any position in the list, and exclusions alone select nothing.

## Configuration

Inline text and prompt files load with the default append position, trimming, configuration-relative paths, `~/` expansion, and optional modes.

A missing file, an empty object, `defaults: true`, or `offerForegroundSubagents: false` yields the built-in prompts; `defaults: false` yields only the file's entries, and otherwise the built-in prompts precede them.

Every invalid shape fails as a located configuration error, including a model list of only exclusions or a bare `!`, as does a prompt or configuration path that names a directory or passes through a regular file.

## Built-in prompts

Every built-in block appends, and each Claude and GPT family receives exactly its blocks across the id forms of Pi's catalog.

Opus 5 and 5.5 share the Opus 5 block but only Opus 5.5 gets its own unattended paragraph, Fable 5 never gets Fable 5.1's block, aliases that name no version get only the Claude-wide blocks or nothing, and older GPT and other models get none.

The unattended blocks appear only in `print` and `json` modes, and the Fable change-versus-assessment block only in `tui` and `rpc`.

The rule that a problem report gets an assessment is stated exactly once where it applies: for Fable 5.1 and GPT-5.6 in every mode and for other Claude models except Opus 5.5 in unattended runs. Opus 5.5, GPT-6, and GPT-5.5 never receive it.

The wording keeps its guarantees: temporary-file cleanup needs no permission while pre-existing files do, the compaction claim is qualified, and the Fable rule exempts thinking. No block uses em dashes, CAPS emphasis, or double-check and re-verify instructions.

## Run modes

A real session applies entries only in their modes: the terminal UI gets the built-in core and model blocks without the unattended one, `print` adds it and print-only entries, and `rpc` excludes both.

A GPT model in the same `print` session gets its own block and the unattended copy without the assessment exception, and no Claude block.

Turning defaults off removes every built-in block from a print session.

## Foreground offer

A real terminal session with a registered `subagent` tool asks once, and a second loaded copy stays quiet.

Yes adds the package directory to the global foreground list and keeps every other setting; No records the answer while keeping the configuration's prompts.

No question appears when the answer is on record, when a `~/` path through a symlink already names the package, without a `subagent` tool, outside the terminal UI, when the configuration is not a JSON object, or when settings.json is not valid JSON. A held settings lock leaves the file unchanged and warns with the entry to add by hand.

## Install scope

Only a personal install counts for the global foreground list: npm and git installs under the agent directory and local checkouts do, while project `.pi/npm` and `.pi/git` installs and `pi -e` copies under `tmp/extensions` do not.

An agent directory that is itself named `.pi` keeps its personal installs, and a real session loaded from a project install never asks.

## Composition

Appended text is always recorded as one section, and append-only prompts never replace the prompt.

Prepends replace it with the full rendered prompt, an earlier replacement is extended rather than discarded, every replacement ends with the appended block, and a prompt build can be claimed only once.

## Live sessions

A real AgentSession with a recording provider sends each model only its own prompts across switches, including a switch away from a replaced prompt, without stale deltas or a repeated block.

The fixture uses an in-memory credential store, so creating its model runtime neither reads nor creates the user's `auth.json`.

The transcript records the appended section under a replacement too.

The same fixture covers a double-loaded extension inserting each prompt and reporting each error once, configuration edits applying on the next prompt, broken configuration reported once and applying nothing, and composition with a replacing extension and a section-adding extension in both load orders. It also pins the documented limit: a later section-adding extension that ignores replaced prompts loses its section while a prepend applies.

## Bundled loading

The distributed runtime file loads through Pi's public virtual package root alone and registers only its two hooks, with no tools or commands.

## Subagent smoke

The opt-in smoke test runs the installed pi and pi-subagents with a fake provider. It stays outside the repository gates because it depends on a local pi-subagents installation.

Background children apply their own model's prepended and appended prompts exactly once, with or without the child-only extension default. Foreground children apply them only with that default. Parent requests never receive child prompts.

The child model is named like a Claude model, so each child that loads the extension must also carry exactly one built-in core block and, because children run in print mode, one unattended block.

pi-subagents 0.71 and later start a parent with only the `subagents_enable` loader active, so the fake parent calls it first whenever the `subagent` tool is missing.

# proper-model-prompts

proper-model-prompts adds configured text and built-in Claude and GPT prompts to Pi's system prompt while a matching model is active, before or after Pi's prompt, in the main session and in subagent children.

<!-- lat-index
- [[tests]]: Offline pattern, configuration, composition, live-session, packaging, and subagent verification.
-->

## Architectural boundary

The package is one public-hook extension with no runtime dependency, build step, command, or tool. It writes files only after the user answers its one-time foreground question.

`model-prompts.ts` registers `before_agent_start`, which reads configuration, matches `ctx.model` and `ctx.mode`, and edits that run's prompt options, and `session_start`, which resets error deduplication and makes the [[proper-model-prompts#Foreground subagent offer]]. `defaults.ts` holds the built-in prompt text and patterns. Neither imports pi-subagents or any other package.

## Configuration

[[proper-model-prompts/model-prompts.ts#loadPrompts]] reads `proper-model-prompts.json` from Pi's agent directory on every prompt, so edits apply to the next message without a reload.

The file holds optional `defaults` and `offerForegroundSubagents` booleans and an optional `prompts` list. Each entry has `models` patterns, an optional `position` of `append` (default) or `prepend`, optional `modes`, and exactly one of `text` or `file`. Files resolve from the configuration directory, `~/` expands to the home directory, and text is trimmed.

The built-in prompts come first unless `defaults` is false, followed by the file's entries. A missing file means the built-in prompts only.

Unknown keys, wrong types, empty text, unknown modes, and prompt files that are missing or unreadable because of their path or permissions raise a `ConfigError` naming the file and entry index. An invalid file applies nothing, built-in prompts included, because it may be the file that turns them off. It is reported once per distinct message per session; other I/O errors propagate to Pi's extension runner.

Configuration is global only. One file serves the parent and every child session, which share the agent directory, and an untrusted repository cannot inject prompt text.

## Model matching

[[proper-model-prompts/model-prompts.ts#matchesModel]] compares a pattern case-insensitively with `provider/id` or the bare id, with `*` as the only wildcard.

Matching either form follows Pi's own model-pattern convention. A whole-string glob where `*` crosses `/` replaces Pi's fuzzy non-glob resolution and minimatch's slash rules, so ids that contain `/` behave predictably.

[[proper-model-prompts/model-prompts.ts#selectsModel]] applies an entry when one of its patterns matches and none of its `!` patterns does, in any order, so an entry can cover a family minus one model. Configuration rejects an entry whose patterns are all exclusions, and a bare `!`.

Every matching entry applies: built-in prompts first, then the file's entries in order. Prompts stack, so there is no priority or conflict resolution.

## Run modes

[[proper-model-prompts/model-prompts.ts#promptsFor]] also filters entries by `ctx.mode`, so an entry can target only the sessions where its advice holds.

Pi reports `tui` for the interactive terminal, `rpc` for programs such as editor integrations, `print` for `pi -p`, and `json` for `pi --mode json`. pi-subagents binds every child, foreground or background, in `print` mode. An entry without `modes` applies in all of them.

The filter exists for advice that is wrong while a person is watching. Anthropic's unattended-run guidance tells the model nobody can answer mid-task, which is true in `print` and `json` runs and false in the terminal UI and usually in RPC clients.

## Built-in Claude prompts

[[proper-model-prompts/defaults.ts#DEFAULT_PROMPTS]] holds seven appended Claude blocks adapted from Anthropic's prompting guides as published on 2026-09-23. They apply unless the configuration turns them off.

A core block for every Claude model covers reading code before answering, keeping to the requested scope, asking before destructive or shared actions, grounding progress claims in tool results, opening the final message with the outcome, batching independent tool calls, and not stopping over context limits. Its cleanup and risky-action rules agree: temporary files the agent created are removed without asking, while files and branches that existed before the task still need the user's go-ahead. The compaction sentence says "by default", because extensions cannot read Pi's compaction setting and a user can turn compaction off. Model blocks cover Opus 5 and 5.5 verbosity and narration, which the Opus 5.5 guide says carry over, Fable decisiveness, and Fable 5.1 progress updates, surgical edits, single drafts of long deliverables, and literal wording. An unattended block, limited to `print` and `json`, asks the model to finish instead of stopping to ask permission. Opus 5.5 gets its own guide's unattended paragraph instead, which names four ways it ends a turn early and asks for status notes in the same message as the next tool call; `!` patterns keep the general block away from it.

Fable 5 and 5.1 also get the change-versus-assessment rule, which Anthropic's Fable 5 guide recommends because Fable can take unrequested actions: a requested change gets made, while a described problem, a question, or thinking aloud gets an assessment and no fix until the user asks. The general unattended block states the same rule, so the Fable copy is limited to `tui` and `rpc` and each run states it once. The other Claude guides do not ask for it, so other models follow it only in unattended runs, and Opus 5.5, whose own paragraph lacks it, never does.

The selection keeps only guidance that is system-prompt text for a coding agent and that Pi does not already provide. Effort, thinking, and output-limit advice belongs to Pi's thinking level and provider settings. Harness features, task-specific snippets, and advice for writing user prompts stay out, as do instructions the guides say to remove: emphatic CAPS, verification steps, and requests to write out reasoning.

Every block appends. A prepend makes Pi resend the whole prompt as one opening message, so any later change anywhere rewrites the request prefix, losing the prompt cache and, on models that bind thinking blocks to their prefix, earlier thinking. Appended sections change only through Pi's section updates, which it sends as mid-conversation system messages where the model supports them.

Where Anthropic measured a prompt, the text stays close to its published wording; the rest is adapted to Pi's tools and terms. Model patterns are checked against the Claude id forms in Pi's catalog, including Bedrock prefixes, OpenRouter suffixes, and dotted version ids, so Opus 5 never gets Opus 5.5's unattended paragraph and the Fable 5.1 block never reaches Fable 5.

The defaults are on or off as a set. Changing one means turning them off and copying the wanted blocks into the configuration. The core block adds about 960 tokens to every Claude request, cached after the first.

## Built-in GPT prompts

The GPT blocks in [[proper-model-prompts/defaults.ts#DEFAULT_PROMPTS]] restore the per-model guidance that Codex sends and Pi does not, adapted from OpenAI's GPT-6 and GPT-5.6 guides as published on 2026-09-23.

Codex sends each GPT model 18,000 to 21,000 characters of model-specific instructions in the Responses `instructions` field. Pi puts its own system prompt in that field, and proxies such as CLIProxyAPI forward it unchanged, so a GPT model in Pi otherwise receives none of that guidance. The blocks carry only behavior Pi lacks, since OpenAI reports that leaner prompts scored better on GPT-5.6.

A GPT-6 family block uses OpenAI's starting prompts, which its guide applies to Astra, Sol, and Luna alike. It asks the model to infer intent and carry the task to completion, to treat "can you..." as a request to act, and to finish the reviewable work so approval is the last step, without unsolicited warnings or approval flows. User instructions override skills, and a skill or instruction file that causes a pause must be named and quoted. Reversible low-impact changes get no mirror tests, and writing defaults to plain paragraphs without stock phrases. Its update, compaction, and final-answer paragraphs follow Codex's GPT-6 instructions. OpenAI's delegation prompt is left to proper-base, which adds it whenever pi-subagents' `subagent` tool is active.

A GPT-5.6 block uses OpenAI's compact autonomy policy, Codex's dirty-worktree rule, sparse progress updates, validation after changes, and a length rule that keeps required facts, because GPT-5.6 is terser than GPT-5.5 and a blanket request for brevity can cut too much. GPT-5.5 gets the same block without the policy's report-only paragraph, because Codex's GPT-5.5 instructions tell it to fix reported problems.

The rule that a problem report gets an assessment instead of a fix follows each model's own guidance. GPT-5.6 states it in every mode, and GPT-6 and GPT-5.5 never receive it, so GPT models get the unattended block without its exception paragraph.

The GPT blocks stay separate from the Claude ones. The Claude core's ask-first list and blanket reading rule are the style OpenAI says makes GPT-6 stop early, and GPT-6 needs testing reduced while GPT-5.6 is asked to validate, so Anthropic's advice against verification prompts applies to the Claude blocks only.

The patterns `*gpt-6*`, `*gpt-5.6*`, and `*gpt-5.5*` are checked against every versioned GPT id form in Pi's catalog: bare ids, Bedrock `openai.` ids with region prefixes, OpenRouter and Vercel `openai/` ids, and `-pro`, `-fast`, and `:batch` suffixes. Older GPT models get nothing.

Aliases that name no version, such as OpenRouter's `~openai/gpt-sol-latest` and `~anthropic/claude-fable-latest`, are left to user entries, because the model behind them changes over time and a fixed pattern would eventually send the wrong model's prompts. Claude aliases still get the blocks for every Claude model. The GPT-6 block adds about 1,400 tokens and the GPT-5.6 block about 480, cached after the first request.

## Composition

[[proper-model-prompts/model-prompts.ts#applyPrompts]] appends through a named section and prepends through a whole-prompt replacement, extending any replacement an earlier extension made.

Appended text is always recorded as the `proper_model_prompts` section. That keeps other extensions' sections and Pi's section deltas intact, so appending never costs another extension its text.

Pi always renders its preamble first, rejects a custom section named `preamble`, and drops its tool, rule, and documentation sections when `customPrompt` is set. A prepend therefore sets `forceSystemPrompt` to the prepended text followed by the prompt Pi renders with the appended section already in place. Later extensions that add sections without handling replaced prompts lose those sections for that run.

When an earlier handler already replaced the prompt, as Ponytail does in the root session and pi-subagents' prompt runtime does in every child, both positions wrap that text instead of discarding it, and the appended block goes at its end.

Pi sends a replacement instead of the sections but still diffs the sections into the transcript. Recording the appended section under a replacement keeps compaction checkpoints and later section deltas consistent with what the model was sent. The forced-prompt projection drops transcript system messages from that request, so the text is never sent twice.

[[proper-model-prompts/model-prompts.ts#claimBuild]] marks the per-build options object with a `Symbol.for` key. When two copies of the package load, for example from npm and a checkout, or from discovery plus a child-only extension path, the first copy in load order claims every build, so the second neither applies prompts nor reports errors.

Request-time `context_with_system` edits were rejected for prepending. Pi's forced-prompt projection runs after them and would discard the prepended text whenever any extension replaces the prompt, which happens in every pi-subagents child.

## Timing

Prompts are chosen once per user prompt, in `before_agent_start`, for the model that will answer; Pi reuses that choice for the rest of the run.

proper-llm-router switches models in the `input` event, which Pi emits before `before_agent_start`, so a routed first message receives the routed model's prompts. `/model` switches apply to the next message. A model change during a run applies from the next prompt.

Appended sections enter the session transcript like any other section. Without a replacement, providers that accept mid-conversation system messages receive a model switch as Pi's section update after the original opening prompt; others receive a collapsed opening prompt. Replaced prompts always go out as one rebuilt opening message.

## Subagent children

Children apply the prompts for their own model whenever the extension loads in them. pi-subagents decides that per launch mode, so foreground children need one setting.

Background children, the pi-subagents default, run in a detached runner process that discovers installed packages and loads this one automatically.

Foreground children run inside the parent process with package discovery disabled. Listing the package directory in `subagents.defaultSubagentOnlyExtensions`, which the [[proper-model-prompts#Foreground subagent offer]] can do for the user, loads it there, and also in background children of agents whose `extensions` allowlist disables discovery. An agent's own `subagentOnlyExtensions` or an `agentOverrides` entry replaces that default. Loading by both routes in one child is deduplicated by the composition marker.

pi-subagents' child prompt runtime runs before every other extension and replaces the child prompt, so children always take the extend-replacement branch.

Children run in `print` mode, so the built-in unattended blocks and user entries limited to `print` reach them, while the interactive parent never receives those blocks.

Children launched with an extension-denying capability ceiling, external CLI runners, remote machine children, pi-background-tasks Fusion children, and isolated `bg_delegate` children never load extensions. Ambient `bg_delegate` and `bg_run_pi_attested` children do.

pi-subagents' `registerRequiredChildExtensions` was rejected. It is a host API with one registration per parent session, would need an import of pi-subagents' files, and rejects every child launch when the registered path fails to load.

## Foreground subagent offer

The first terminal session that finds pi-subagents without this package in its foreground list asks once whether to add it, and writes nothing without an answer.

Foreground children load only the extensions in `subagents.defaultSubagentOnlyExtensions`, so an npm install otherwise leaves them without prompts. Install scripts are the wrong place to add the entry. npm's guidance reserves install scripts for native compilation, pnpm and bun skip them by default, users can disable them, and npm never runs uninstall scripts, so nothing could remove the entry. Adding it silently at runtime would change pi-subagents' configuration without consent and re-add it after the user removed it.

`session_start` asks only in `tui` mode, when a `subagent` tool is registered, the package is a personal install, the configuration does not set `offerForegroundSubagents` to false, and the global list does not already name the package by an absolute or `~/` path that resolves to its directory.

[[proper-model-prompts/model-prompts.ts#isScopedInstall]] decides the scope from where Pi put the package, because an extension without tools cannot read its own source metadata. A project install under `.pi/npm` or `.pi/git` or a `pi -e` copy under the agent directory's `tmp/extensions` never asks, since the global list would load that copy in every project. npm and git installs under the agent directory and local paths from settings, which Pi loads in place, count as personal. Relative entries never match, because pi-subagents resolves them against each child's working directory. A `Symbol.for` registry keyed by the session manager lets only one loaded copy ask per session.

Yes appends the directory Pi loaded the package from to the list in the global `settings.json`, keeping every other setting and Pi's two-space format. The write takes the directory lock proper-lockfile uses for Pi's own settings writes, so neither update is lost, and gives up after ten short retries. No records `"offerForegroundSubagents": false` in the package configuration, keeping its other keys. Escape counts as No, because Pi's confirm dialog reports both the same way.

A busy lock, a list that is not an array of paths, or an unreadable file ends in a warning that gives the exact entry to add by hand. A settings.json or configuration file that cannot be parsed suppresses the question, because Pi or the prompt loader already reports it. A project's own list replaces the global one in that project and is left to the user. An entry left after the package is removed points at a missing directory, which pi-subagents ignores.

## Packaging

proper-model-prompts is an independently installable source package with offline tests, strict typechecking, bundled-loader coverage, an opt-in subagent smoke test, and repository release and gate integration.

It is not published yet. Initial publication, trusted-publisher registration, and release-environment tag policy remain maintainer actions.

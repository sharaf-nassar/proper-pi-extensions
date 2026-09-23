# proper-model-prompts

[Pi](https://pi.dev) sends every model the same system prompt. Models differ:
one needs a reminder to keep diffs small, another to run the tests before
claiming success. proper-model-prompts adds your own text to the system prompt
only while a matching model is active, either before Pi's prompt or after it.

It also ships built-in prompts for [Claude](#built-in-claude-prompts) and
[GPT](#built-in-gpt-prompts) models, adapted from Anthropic's and OpenAI's
prompting guides. They apply without any configuration, and one setting turns
them off.

It works in the main session and inside pi-subagents children, where each child
gets the prompts for its own model. Foreground children need one setting, which
the extension offers to add for you; see [Subagents](#subagents).

Requires Pi **0.87.0+** and Node **22.19+**.

## Install

Install an npm release:

```bash
pi install npm:proper-model-prompts
```

Or install from the repository root of this checkout:

```bash
pi install ./proper-model-prompts
```

Run `/reload` inside Pi, or restart it, to load the extension.

If pi-subagents is installed, the first terminal session asks once whether
foreground subagents should load the package too. See
[Subagents](#subagents).

## Configure

The configuration file is optional. To add your own prompts or turn off the
built-in ones, create `~/.pi/agent/proper-model-prompts.json` (or the same file
under `PI_CODING_AGENT_DIR`):

```json
{
  "defaults": true,
  "prompts": [
    {
      "models": ["claude-*"],
      "text": "Keep diffs minimal. Explain trade-offs in one or two sentences."
    },
    {
      "models": ["cliproxyapi/gpt-*", "openai-codex/*"],
      "position": "prepend",
      "file": "model-prompts/gpt.md"
    }
  ]
}
```

`defaults` is optional and `true` unless you set it to `false`, which turns off
every built-in prompt. `offerForegroundSubagents` is optional too: `false` stops
the one-time question about [foreground subagents](#subagents), and answering
No sets it for you. `prompts` is optional as well. Each entry has these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `models` | yes | Model patterns this prompt applies to. |
| `position` | no | `"append"` (default) adds the text after Pi's prompt; `"prepend"` puts it before. |
| `modes` | no | [Run modes](#run-modes) the prompt applies in; every mode when absent. |
| `text` | one of | The prompt text itself. |
| `file` | one of | A text or Markdown file holding the prompt. Relative paths resolve from the directory of the configuration file; `~/` means your home directory. |

The file and any prompt files are read each time you send a message, so edits
apply to the next message without `/reload`. Without a configuration file, only
the built-in prompts apply. A configuration problem (invalid JSON, a misspelled
key, a missing or unreadable prompt file) is shown once per session, and no
prompts are added, built-in ones included, until it is fixed.

### Model patterns

A pattern matches a model's `provider/id` or its bare `id`, ignoring case. `*`
matches any run of characters, including `/`; there are no other wildcards.
Without `*`, the whole `provider/id` or `id` must match.

| Pattern | Matches |
| --- | --- |
| `claude-*` | `anthropic/claude-sonnet-5`, `cliproxyapi/claude-opus-5` |
| `cliproxyapi/claude-*` | `cliproxyapi/claude-opus-5` only |
| `gpt-5.6-sol` | exactly that id, from any provider |
| `*sonnet*` | `openrouter/anthropic/claude-sonnet-5` |
| `*` | every model |

An entry applies when any of its patterns matches. A pattern that starts with
`!` excludes the models it matches, wherever it sits in the list, so
`["*claude*", "!*haiku*"]` means every Claude model except Haiku. Each entry
needs at least one pattern without `!`.

Use `/model` to see provider and model ids.

### Run modes

Every Pi session runs in one of four modes, and `modes` limits an entry to some
of them:

| Mode | Session |
| --- | --- |
| `tui` | The interactive terminal. |
| `rpc` | Another program drives Pi, such as an editor integration. |
| `print` | `pi -p`, and every pi-subagents child. |
| `json` | `pi --mode json`, used by scripts and `bg_run_pi_attested`. |

For example, `"modes": ["print", "json"]` targets runs where nobody is watching
to answer questions.

### Order and placement

Every matching prompt is used: the built-in prompts first, then yours in file
order.

- **Appended** prompts are joined with blank lines into one
  `<proper_model_prompts>` block at the end of the system prompt, after Pi's
  sections and those added by extensions that loaded earlier.
- **Prepended** prompts are joined with blank lines and placed before
  everything else, including Pi's opening line ("You are an expert coding
  assistant...").

Prompts are chosen when you send a message, for the model that will answer it.
After switching with `/model`, `Ctrl+P`, or a router, the next message uses the
new model's prompts. proper-llm-router switches models before Pi builds the
prompt, so a routed first message already gets the routed model's prompts. A
model change during a running reply applies from the next message.

## Built-in Claude prompts

The package ships seven prompts for Claude models, adapted from Anthropic's
[prompting guides](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)
as published on 2026-09-23. Where Anthropic measured a prompt, the text stays
close to its published wording. Each block is appended, so Pi's own prompt and
its prompt cache stay intact.

| Models | Modes | What it asks for |
| --- | --- | --- |
| Every Claude model (`*claude*`) | all | Read code before answering. Deliver the requested scope and list unrelated issues as follow-ups. Remove its own temporary files, but ask before destructive, hard-to-undo, or shared actions, including deleting files that existed before the task. Back progress claims with tool results. Open the final message with the outcome, in plain sentences. Batch independent tool calls. Don't stop over context limits. |
| Claude Opus 5 and 5.5 | all | Shorter answers and documents, and one-sentence narration while working. The Opus 5.5 guide says Opus 5's patterns carry over. |
| Claude Fable 5 and 5.1, Mythos 5 and 5.1 | all | Act once there is enough information, and recommend rather than survey options. |
| Claude Fable 5 and 5.1, Mythos 5 and 5.1 | `tui`, `rpc` | Make a requested change, but answer a described problem, a question, or thinking aloud with an assessment and no fix until asked. `print` and `json` runs get the same rule from the unattended block. |
| Claude Fable 5.1 and Mythos 5.1 | all | Progress updates and a closing recap, surgical file edits, one draft of long deliverables, and literal wording. |
| Every Claude model except Opus 5.5 | `print`, `json` | Finish the task without stopping to ask permission, because nobody is there to answer. A described problem still gets an assessment instead of a fix. |
| Claude Opus 5.5 | `print`, `json` | Its own guide's version: don't end a turn on a summary that announces the next step, an offer to wait, a list of decisions that block nothing, or a pause to report, and put status notes in the same message as the next tool call. |

The exact text is in [`defaults.ts`](./defaults.ts). Other Claude models, such
as Sonnet 5 and Opus 4.8, get only the first block, plus the unattended one in
`print` and `json` runs. Their guides say prompts written for the previous
model carry over, and the rest of their advice concerns effort, API settings,
or specific tasks such as frontend design and code review.

To change a built-in prompt, set `"defaults": false` and copy the blocks you
want from `defaults.ts` into your own entries. The core block tells the model
that Pi compacts the context "by default"; if you turn Pi's
`compaction.enabled` setting off, consider copying the blocks without that
sentence.

## Built-in GPT prompts

Codex sends every GPT model a long set of instructions written for that model.
Pi sends its own system prompt in their place, and proxies such as CLIProxyAPI
pass it through unchanged, so GPT models in Pi otherwise get none of that
guidance. The package ships four prompts for GPT models, adapted from OpenAI's
[GPT-6](https://developers.openai.com/api/docs/guides/latest-model) and
[GPT-5.6](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6)
guides and Codex's per-model instructions as published on 2026-09-23. Where
OpenAI published a starting prompt, the text stays close to it.

| Models | Modes | What it asks for |
| --- | --- | --- |
| GPT-6 Astra, Sol, and Luna (`*gpt-6*`) | all | Infer intent and carry the task to completion, treating "can you..." as a request to act. Finish the reviewable work so approval is the last step, without unsolicited warnings or approval flows. Let your instructions override skills, and name the skill or instruction file behind any pause. Skip mirror tests for small reversible changes. Brief updates, continuing after compaction, and a final answer that leads with the outcome. Plain paragraphs without stock phrases. |
| GPT-5.6 Sol, Terra, and Luna (`*gpt-5.6*`) | all | Report on questions, reviews, and diagnoses without changing code. Make requested changes and validate them without asking, but confirm external writes, destructive actions, and scope growth. Preserve uncommitted changes it didn't make. Sparse updates, and answers that lead with the conclusion but keep required facts. |
| GPT-5.5 (`*gpt-5.5*`) | all | The GPT-5.6 block without its first rule, because Codex tells GPT-5.5 to fix reported problems. |
| Every model above | `print`, `json` | The general Claude unattended block without its exception for described problems. |

Only GPT-5.6's own guidance asks for an assessment instead of a fix when you
describe a problem; Codex tells GPT-6 and GPT-5.5 to act on it. Older GPT
models get nothing. OpenAI's delegation prompt for GPT-6 is left out, because
proper-base adds it whenever pi-subagents' `subagent` tool is active. The GPT-6
block adds
about 1,400 tokens and the GPT-5.6 block about 480, cached after the first
request.

## Other extensions

Appended prompts use a named prompt section, the way Pi expects extensions to
add text, so other extensions' sections and Pi's prompt updates keep working.

Pi has no section before its opening line, so a prepended prompt replaces the
whole system prompt with your text followed by Pi's complete prompt, including
everything earlier extensions added. An extension that loads **after** this one
and adds a section without supporting replaced prompts loses that section while
a prepend prompt applies. `pi install` adds new packages at the end of your
list, so installing this package last avoids the problem. Append-only
configurations never replace the prompt.

When an earlier extension has already replaced the prompt (Ponytail does, and
so does pi-subagents inside every child), both positions extend that
replacement instead of discarding it.

Pi sends a replaced prompt instead of the prompt sections, so appended text
goes at the end of any replacement as well. It is still recorded as its section
in the session, where Pi's compaction and later prompt updates read it.

If the package is registered twice, for example from npm and from a checkout,
the first copy in load order handles every message: each prompt is added once
and each configuration problem is shown once.

## Subagents

**Background children** (pi-subagents' default, `async: true`, including
workflow children) load your installed packages. Each child applies the prompts
for its own model, including a model chosen by a router.

**Foreground children** (`async: false`) never load installed packages. They
load only the extensions listed in pi-subagents'
`subagents.defaultSubagentOnlyExtensions` setting. The first time you start
the terminal UI with pi-subagents installed and this package missing from that
list, it asks once whether to add itself:

- **Yes** adds the package directory to the list in the `settings.json` of
  your Pi agent directory (`~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set),
  using the same lock Pi uses for that file. Foreground children load it from
  their next launch.
- **No**, or Escape, sets `"offerForegroundSubagents": false` in
  `proper-model-prompts.json`, so it never asks again. Delete that key to be
  asked again.

Nothing is written without an answer, and nothing runs at install time. A
project install (`pi install -l`) or a one-off `pi -e npm:` or `pi -e git:` run
never asks, because the global list would load that copy in every project. To
add the entry yourself, for an npm install:

```json
{
  "subagents": {
    "defaultSubagentOnlyExtensions": ["~/.pi/agent/npm/node_modules/proper-model-prompts"]
  }
}
```

For a local checkout, use the directory you installed from. A list in a
project's `.pi/settings.json` replaces the global one in that project, so add
the path there too; the question only checks and edits the global list. After
`pi remove`, delete the entry; a leftover path is ignored. The setting also
covers background children of agents that list their own `extensions`, which
turns off package discovery. An agent with its own `subagentOnlyExtensions` list, or an
`agentOverrides.<name>.subagentOnlyExtensions` entry, replaces this default, so
add the path there as well. Loading the package both ways is safe; each prompt
is added once.

Prompts never reach:

- children whose launch denies all extensions through a capability ceiling;
- external CLI agents (`claude-code`, `codex-exec`, `cursor-agent`) and remote
  `machine` children, which are not local Pi sessions;
- pi-background-tasks Fusion children and `bg_delegate` in its default isolated
  mode, which start Pi without extensions. `bg_delegate` with
  `extensionMode: "ambient"` and `bg_run_pi_attested` do apply prompts.

Children run in `print` mode, so the built-in unattended blocks and your own
entries limited to `print` reach them.

Children have no display, so a configuration error there is silent. The main
session shows the same error for the same file.

`npm run test:subagents` runs your installed `pi` and pi-subagents four
times: a background and a foreground child, each with and without the
child-only extension default. It checks that each child gets its own model's
prepended and appended prompts exactly once, plus the built-in core and
unattended blocks (a foreground child only with the setting), and that the
parent never gets the child's prompts. It does not cover
routing, capability ceilings, agent overrides, or other launchers. It uses a
fake provider, so no model is called and no credentials are read. Set
`PI_SUBAGENTS_DIR` if pi-subagents is not installed under
`~/.pi/agent/npm/node_modules`.

## Limits

- Without a replaced prompt, providers that accept system messages
  mid-conversation receive a model switch as a section update ("Updated system
  prompt section ...") after the original opening prompt; other providers
  receive a rebuilt opening prompt. A replaced prompt, including any prepend,
  always goes out as one rebuilt opening prompt.
- Text is inserted as written. There is no templating.
- There is one global configuration file; projects cannot add their own.
- The built-in prompts are on or off as a set; to keep some of them, copy those
  into your own entries.
- Aliases that name no version, such as OpenRouter's
  `~anthropic/claude-fable-latest` and `~openai/gpt-sol-latest`, get no
  model-specific built-in prompts, because the model behind them changes over
  time. Claude aliases get only the blocks for every Claude model, and GPT
  aliases get none. Add your own entry for an alias you use.

## Development

```bash
npm install
npm test
npm run typecheck
npm run test:coverage
npm run test:subagents   # needs pi and pi-subagents installed
```

# Complete Pi setup

This is an agent-facing runbook for installing the public Pi environment used by
this repository. Follow it from the repository root. Do not copy credentials,
auth files, private endpoints, or machine-specific paths from another user.

## Agent contract

1. Read this file and each linked package README before changing user state.
2. Let the user choose. Present the package list below as one multi-select
   question, quoting each package's one-line purpose so the choice is
   informed, and install only what the user picks. `proper-base` is the sole
   exception: it always installs. Pi packages and skills run with the user's
   permissions.
3. Inspect existing Pi settings and `pi list` first. Back up files before edits.
4. Merge JSON settings. Never replace a user's complete settings file.
5. If a required CLI is missing, show the user the verified install command and
   wait for approval. Do not install system tools silently.
6. Ask the user for provider choices and credentials. Never print or commit
   secret values.
7. Remove duplicate registrations. One extension or prompt source must load
   from one place only.

## Scope

Install:

- `proper-base` from npm — always, no prompt.
- Every other package, skill, and workflow bundle below — only when the user
  selects it in step 2.
- `proper-flow` and its repository-linked Beads resources — offer them only
  when the `bd` CLI is installed locally (`command -v bd` succeeds).
- The public `lat.md` CLI required by this repository. The Beads CLI is
  optional; it gates the proper-flow option above.

Do not install:

- `quill.ts` or `scribe-ai-integration.ts`. They are explicitly excluded.
- The local `lat.ts` fork. Install the public `lat.md` CLI and use this
  repository's `.mcp.json` through `pi-mcp-adapter` instead.

## 1. Inspect the machine

```bash
pi --version
node --version
pi list

command -v git
command -v jq || true
command -v bd || true
command -v lat || true
```

Baseline compatibility is Pi 0.85.0 and Node 22.19 or newer. Preserve newer
compatible versions.

Before changing Pi state:

```bash
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$PI_AGENT_DIR"
for file in settings.json models.json mcp.json; do
  if [ -f "$PI_AGENT_DIR/$file" ]; then
    cp "$PI_AGENT_DIR/$file" "$PI_AGENT_DIR/$file.before-proper-setup"
  fi
done
```

If `lat` is missing, ask before using this public install command:

```bash
npm install --global lat.md
```

`bd` is optional and may already exist from a non-npm install (a Go or
binary build also counts); `command -v bd` is the only check that matters.
If it is missing, ask whether the user wants the Beads workflow. If yes,
ask before installing:

```bash
npm install --global @beads/bd
```

If the user declines, skip `proper-flow` in step 2 and its Beads resources
in step 3.

## 2. Choose the packages to install

These were verified as public npm Pi packages. Ask the user once, as a
multi-select, which of the optional ones to install. Show the "What it does"
text verbatim so the user can decide without reading each README. Install
unpinned sources so `pi update --extensions` can update them later.

| Source | Choice | What it does |
| --- | --- | --- |
| `npm:proper-base` | always | Baseline session behavior for this setup: transcript cleanup, prompt editing and history, image previews, cancellation, session titles, footer layout. |
| `npm:proper-llm-router` | optional | Picks the model for each session's first task and swaps models when a provider quota runs out. Needs CLIProxyAPI (step 6). |
| `npm:proper-pacify` | optional | Rewrites your prompt's tone to neutral and direct without changing what it asks for. |
| `npm:proper-flow` | optional, needs `bd` | Adds `/triage`, `/file`, `/spec`, `/refine`, and `/implement-ready` Beads workflow prompts. Offer only when `command -v bd` succeeds; all five prompts run `bd`. |
| `npm:@router-for-me/pi-cliproxyapi-provider` | optional | Registers a CLIProxyAPI server as a Pi model provider, plus Fast mode and elapsed/TPS readouts. Required by proper-llm-router. |
| `npm:pi-mcp-adapter` | optional | Runs MCP servers, including this repository's `lat mcp`, behind two compact discovery and call tools instead of loading every server tool. |
| `npm:@vigolium/piolium` | optional | Security-audit bundle: audit extensions, prompts, themes, and specialist skills. |
| `npm:pi-subagents` | optional | Delegates work to worker, reviewer, scout, researcher, and oracle subagents, with councils, missions, and background runs. |
| `npm:pi-web-access` | optional | Web search, page fetching, source checking, GitHub repository cloning, PDF and video reading. |
| `npm:@juicesharp/rpiv-ask-user-question` | optional | Lets the agent ask you multiple-choice questions mid-task instead of guessing. |
| `npm:@amaster.ai/pi-image-gen` | optional | Generates and edits images from a prompt. Needs a provider API key (step 7). |
| `npm:@dietrichgebert/ponytail` | optional | Pushes the agent toward the smallest working change, plus review, audit, debt, gain, and help skills. |
| `npm:@ff-labs/pi-fff` | optional | Fast fuzzy file and content search, and file autocomplete backed by it. |
| `npm:pi-context-view` | optional | Shows how much context a session is using and what was injected into it. |

Selection rules:

- Offer `npm:proper-flow` only when `bd` exists; otherwise state that it was
  hidden and why.
- If the user selects `npm:proper-llm-router` without
  `npm:@router-for-me/pi-cliproxyapi-provider`, say the router needs it and
  let the user decide.
- Accept "all", "none", or any subset. Never install an unselected package.

Then install exactly the accepted set:

```bash
selected=(
  'npm:proper-base'
  # one line per package the user selected, e.g. 'npm:pi-subagents'
)

for package in "${selected[@]}"; do
  pi install "$package"
done
```

## 3. Install repository-local resources

Install the Beads formulas and implementation rail only when the user selected
`proper-flow` and `bd` exists; `proper-flow/install.sh` hard-fails without `bd`
or `jq`. The links point into this checkout, so moving or deleting the checkout
breaks them.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
if command -v bd >/dev/null 2>&1; then
  "$REPO_ROOT/proper-flow/install.sh" link
  "$REPO_ROOT/proper-flow/install.sh" check
fi
```

For extension development, local installs may replace the selected repository
packages. Run only the pairs for packages the user actually installed:

```bash
pi remove npm:proper-base
pi remove npm:proper-llm-router
pi remove npm:proper-pacify
pi remove npm:proper-flow
pi install "$REPO_ROOT/proper-base"
pi install "$REPO_ROOT/proper-llm-router"
pi install "$REPO_ROOT/proper-pacify"
pi install "$REPO_ROOT/proper-flow"
```

Never keep the npm and local registration for the same package.

## 4. Install the standalone skills

These two are optional as well. Offer them in the same question as step 2:

- `ui-ux-pro-max` — UI and UX guidance data: styles, palettes, font pairings,
  accessibility and layout rules, chart and stack recipes.
- `unslop` — strips AI-tell phrasing out of written output.

Install UI/UX Pro Max into the universal Agent Skills directory that Pi scans:

```bash
npx --yes ui-ux-pro-max-cli@latest \
  init --ai universal --global --force
```

Install `unslop` from the public Cursor skills repository into Pi's global
skills directory:

```bash
npx --yes skills add cursor/plugins \
  --skill unslop \
  --global \
  --agent pi \
  --copy \
  --yes
```

Ponytail's skills install with `npm:@dietrichgebert/ponytail` and need no
separate choice; do not copy a second Ponytail skill directory.

## 5. Merge baseline Pi settings

Package installation never edits Pi settings. The setup agent must preserve all
existing keys and merge these values into
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/settings.json` unless the user chooses
otherwise:

```json
{
  "tuiMode": "fullscreen",
  "enableSkillCommands": true,
  "subagents": {
    "agentOverrides": {
      "worker": {
        "defaultContext": "fresh"
      }
    }
  }
}
```

Rules:

- If `subagents.agentOverrides.worker` is absent, add the shown fresh-context
  override. If it exists, leave it unchanged unless the user explicitly
  approves an edit; they may deliberately use forked worker context.
- Do not change `defaultProvider`, `defaultModel`, project trust, telemetry,
  proxy, or tool settings without asking.

## 6. Configure CLIProxyAPI and the router

Skip this step when the user did not install `proper-llm-router`.

The router requires a reachable CLIProxyAPI service and user-supplied
credentials. If the user does not have one, skip router activation or launch Pi
with `LLM_ROUTER_OFF=1`. With that variable set, pinned workflow commands such
as `/implement-ready` open a router confirmation dialog offering to continue
unrouted or stop; headless sessions proceed unrouted without a dialog.

Add the harmless placeholder model to
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/models.json`, merging with existing
providers:

```json
{
  "providers": {
    "llm-router": {
      "baseUrl": "http://127.0.0.1:1/v1",
      "api": "openai-completions",
      "apiKey": "unused",
      "models": [
        {
          "id": "auto",
          "name": "LLM Router (auto)"
        }
      ]
    }
  }
}
```

Start Pi, then have the user configure the real provider through:

```text
/login CLIProxyAPI
```

Ask for:

- CLIProxyAPI base URL, normally `http://127.0.0.1:8317`.
- Its API key, entered by the user in Pi's login UI.

The router reuses Pi's authenticated `cliproxyapi` models for judging and
execution. It does not need a second API key or environment variable. Open:

```text
/llm-router-config
```

Run **Test judge** in that menu. Never put the real provider key in this
repository, `models.json`, setup logs, or chat.

## 7. Configure optional provider-backed tools

Each subsection applies only when the matching package was installed.

### Image generation

Ask which supported provider the user wants. Set one `pi-image-gen.defaultModel`
in `settings.json`, then have the user export the matching key.

Examples:

```json
{
  "pi-image-gen": {
    "defaultModel": "nano-banana-2"
  }
}
```

```text
GEMINI_API_KEY
OPENAI_API_KEY
DASHSCOPE_API_KEY
ARK_API_KEY
OPENROUTER_API_KEY
```

Verify inside Pi:

```text
/image-gen list
```

### Web access

`pi-web-access` works without a key through its available zero-config search
path. Additional search providers are optional. Use its README and
`~/.pi/web-search.json`; never invent or copy keys.

### MCP

This repository's `.mcp.json` registers `lat mcp`. Once `lat.md` and
`pi-mcp-adapter` are installed, open this repository and run:

```text
/mcp
```

Use `/mcp setup` only when the user wants to import or add other MCP servers.
Do not copy another machine's MCP credentials or private server definitions.

## 8. Remove duplicate or stale sources

Inspect:

```bash
pi list
```

Remove:

- Old direct `llm-router.ts` registrations.
- Legacy `proper-customs`, `proper-history`, or duplicate `proper-base` paths.
- Loose `~/.pi/agent/prompts/{triage,file,spec,backlog,refine,implement-ready}.md`
  files when `proper-flow` supplies those commands.
- Duplicate skill copies that produce Pi name-collision warnings.

Use `pi remove <exact-source>` for package entries. Use `pi config` to disable
one resource from a package without uninstalling the whole package.

## 9. Verify the complete setup

Restart Pi or run `/reload`, then verify. Run only the checks that belong to
installed packages and skills; skip the rest instead of reporting them as
failures.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
pi list
lat check
command -v bd >/dev/null 2>&1 && "$REPO_ROOT/proper-flow/install.sh" check

test -f "$HOME/.agents/skills/ui-ux-pro-max/SKILL.md"
test -f "$HOME/.agents/skills/unslop/SKILL.md" ||
  test -f "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/unslop/SKILL.md"
```

Inside Pi, run the command for each installed package:

```text
/subagents-doctor
/mcp
/fff-health
/context usage
/image-gen list
/llm-router-config
/ponytail-help
```

Also verify autocomplete contains the entries for what was installed:

```text
/triage
/file
/spec
/refine
/implement-ready
/skill:ui-ux-pro-max
/skill:unslop
```

Finish by reporting:

- Installed package sources from `pi list`.
- Packages the user declined, and any package skipped for a missing CLI.
- User settings changed.
- Manual credential/configuration steps still pending.
- Duplicate registrations removed.
- Verification commands and results.

## Updating later

```bash
pi update --extensions
npx --yes ui-ux-pro-max-cli@latest \
  init --ai universal --global --force
npx --yes skills update unslop --global --yes
```

Update this repository before relinking the proper-flow Beads resources, and
rerun `proper-flow/install.sh check` after the checkout moves. Both apply only
when those links were installed.

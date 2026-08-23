# Complete Pi setup

This is an agent-facing runbook for installing the public Pi environment used by
this repository. Follow it from the repository root. Do not copy credentials,
auth files, private endpoints, or machine-specific paths from another user.

## Agent contract

1. Read this file and each linked package README before changing user state.
2. Show the user the package list below and get approval before installing
   third-party code. Pi packages and skills run with the user's permissions.
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

- `proper-base` and `proper-llm-router` from npm — always.
- `proper-flow` from npm, plus its repository-linked Beads resources — only
  when the `bd` CLI is installed locally (`command -v bd` succeeds).
- The other public Pi packages listed below.
- `ui-ux-pro-max`, `unslop`, and Ponytail's bundled skills.
- The public `lat.md` CLI required by this repository. The Beads CLI is
  optional; it gates the two Beads workflow bundles above.

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

Baseline compatibility is Pi 0.84.2 and Node 22.19 or newer. Preserve newer
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

## 2. Install public Pi packages

These were verified as public npm Pi packages. Install unpinned sources so
`pi update --extensions` can update them later.

| Package | User-facing behavior |
| --- | --- |
| `@router-for-me/pi-cliproxyapi-provider` | Discovers CLIProxyAPI models, registers the provider, and adds Fast mode plus elapsed/TPS UI. |
| `pi-mcp-adapter` | Loads MCP servers lazily behind compact discovery and call tools. |
| `@vigolium/piolium` | Adds security-audit extensions, prompts, themes, and specialist skills. |
| `pi-subagents` | Adds worker, reviewer, scout, researcher, oracle, council, missions, and async orchestration. |
| `pi-web-access` | Adds web search, fetching, source checking, GitHub cloning, PDFs, and video analysis. |
| `@juicesharp/rpiv-ask-user-question` | Adds structured multi-option user questionnaires. |
| `@amaster.ai/pi-image-gen` | Adds raster image generation and editing plus the `image-gen` skill. |
| `@dietrichgebert/ponytail` | Adds always-on minimal-code guidance and Ponytail review, audit, debt, gain, and help skills. |
| `@ff-labs/pi-fff` | Adds fast fuzzy file and content search plus FFF-backed file autocomplete. |
| `pi-context-view` | Adds context usage and hidden-injection inspection. |
| `proper-base` | Adds this repository's baseline transcript, editor, history, image, cancellation, title, and footer behavior. |
| `proper-llm-router` | Routes each session's first task to a configured model and applies quota-aware swaps. |
| `proper-flow` | Adds this repository's `/triage`, `/file`, `/spec`, `/backlog`, and `/implement-ready` prompts. All five run `bd`; install only when `bd` exists. |

```bash
packages=(
  'npm:@router-for-me/pi-cliproxyapi-provider'
  'npm:pi-mcp-adapter'
  'npm:@vigolium/piolium'
  'npm:pi-subagents'
  'npm:pi-web-access'
  'npm:@juicesharp/rpiv-ask-user-question'
  'npm:@amaster.ai/pi-image-gen'
  'npm:@dietrichgebert/ponytail'
  'npm:@ff-labs/pi-fff'
  'npm:pi-context-view'
  'npm:proper-base'
  'npm:proper-llm-router'
)

for package in "${packages[@]}"; do
  pi install "$package"
done

if command -v bd >/dev/null 2>&1; then
  pi install npm:proper-flow
else
  echo "bd not found: skipping proper-flow and its Beads resources"
fi
```

## 3. Install repository-local resources

Install the Beads formulas and implementation rail only when `bd` exists;
`proper-flow/install.sh` hard-fails without `bd` or `jq`. The links point into
this checkout, so moving or deleting the checkout breaks them.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
if command -v bd >/dev/null 2>&1; then
  "$REPO_ROOT/proper-flow/install.sh" link
  "$REPO_ROOT/proper-flow/install.sh" check
fi
```

For extension development, local installs may replace the three npm packages:

```bash
pi remove npm:proper-base
pi remove npm:proper-llm-router
pi remove npm:proper-flow
pi install "$REPO_ROOT/proper-base"
pi install "$REPO_ROOT/proper-llm-router"
pi install "$REPO_ROOT/proper-flow"
```

Never keep the npm and local registration for the same package.

## 4. Install the standalone skills

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

Ponytail's skills install with `npm:@dietrichgebert/ponytail`; do not copy a
second Ponytail skill directory.

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

The router requires a reachable CLIProxyAPI service and user-supplied
credentials. If the user does not have one, skip router activation or launch Pi
with `LLM_ROUTER_OFF=1`.

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

The router judge defaults to the environment variable
`ANTHROPIC_AUTH_TOKEN`. The user must export the correct CPA key before starting
Pi, or change the environment-variable name and endpoints through:

```text
/llm-router-config
```

Run **Test judge** in that menu. Never put the real key in this repository,
`models.json`, setup logs, or chat.

## 7. Configure optional provider-backed tools

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
- Loose `~/.pi/agent/prompts/{triage,file,spec,backlog,implement-ready}.md`
  files when `proper-flow` supplies those commands.
- Duplicate skill copies that produce Pi name-collision warnings.

Use `pi remove <exact-source>` for package entries. Use `pi config` to disable
one resource from a package without uninstalling the whole package.

## 9. Verify the complete setup

Restart Pi or run `/reload`, then verify:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
pi list
lat check
command -v bd >/dev/null 2>&1 && "$REPO_ROOT/proper-flow/install.sh" check

test -f "$HOME/.agents/skills/ui-ux-pro-max/SKILL.md"
test -f "$HOME/.agents/skills/unslop/SKILL.md" ||
  test -f "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/unslop/SKILL.md"
```

Inside Pi:

```text
/subagents-doctor
/mcp
/fff-health
/context usage
/image-gen list
/llm-router-config
/ponytail-help
```

Also verify autocomplete contains (the first five only when `proper-flow`
was installed):

```text
/triage
/file
/spec
/backlog
/implement-ready
/skill:ui-ux-pro-max
/skill:unslop
```

Finish by reporting:

- Installed package sources from `pi list`.
- Any skipped package and why.
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

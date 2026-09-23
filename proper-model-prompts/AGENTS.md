# proper-model-prompts

Independently installable Pi 0.87.0+ extension that adds configured prompt text
to the system prompt for matching models, plus built-in prompts for Claude and
GPT models. `model-prompts.ts` holds the logic and `defaults.ts` the built-in text.
No build step and no runtime npm dependencies; Pi supplies the peer package.

## Development

Use Beads from the repository root. Read and maintain
`../lat.md/proper-model-prompts/`, then run `lat check`.

```bash
npm test
npm run typecheck
npm run test:coverage
npm run test:subagents   # opt-in; needs the installed pi and pi-subagents
```

## Invariants

- Appended text is always recorded as a structured section. Force a
  whole-prompt replacement only when a prepend prompt applies, never discard a
  replacement an earlier extension made (extend it), and end every replacement
  with the appended block, because Pi sends a replacement instead of sections.
- Claim each prompt build once, so a second loaded copy neither applies
  prompts nor reports errors.
- Read configuration on every prompt. A missing file means the built-in
  prompts only; `"defaults": false` turns them off; an invalid file is reported
  once per session and applies nothing, built-in prompts included. Unexpected
  errors propagate to Pi's extension runner.
- Built-in prompts always append and never change between turns, so they keep
  Pi's prompt cache and Claude's thinking blocks valid. Keep Anthropic's
  measured wording, and follow its guides' warnings: no CAPS emphasis, no
  "double-check" or verification steps, and no requests to write out
  reasoning. Model patterns must be tested against every provider id form in
  Pi's catalog, and the unattended block stays limited to `print` and `json`.
- An entry without `modes` applies in every run mode. pi-subagents children run
  in `print` mode.
- Children are reached only through normal extension loading: package
  discovery in background children and pi-subagents'
  `defaultSubagentOnlyExtensions` for foreground ones. Do not import
  pi-subagents or take its host-only `registerRequiredChildExtensions` slot,
  which allows one registration per session and fails every launch when the
  path breaks.
- Add the package to the foreground list only after the user answers the
  one-time terminal question, under Pi's settings lock. Never write it from an
  install script or without asking; record a No in the package configuration.
- Offline tests must not read credentials or call models. The subagent smoke
  test uses a fake provider and stays out of the repository gates.

## Release

Use the root package-scoped release workflow after maintainer bootstrap.
Do not install globally, publish, or configure trust as part of development.

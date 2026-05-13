# Elicitkit — Claude Code plugin

Bundles the Elicitkit MCP server + a thin trigger skill so an assistant
asks **rich, typed questions** (9-type catalog) instead of plain chat
prompts. In a terminal client the server auto-uses MCP elicitation, so
questions are interactive (one at a time, with choices).

## Install (local / dogfooding)

From the repo root, build once, then launch Claude Code with the plugin:

```sh
pnpm build
claude --plugin-dir ./plugin
```

In-session, reload after edits with `/reload-plugins`. Verify with `/mcp`
(server `elicitkit`, tools `elicit` + `elicit_submit`) and `/help`
(skill `elicitkit:elicit`).

Then just ask for something that needs your input, e.g.:

> Ask me which environment to deploy to and whether to run migrations.

The skill nudges the model to call `elicit`; the server renders it
interactively and returns typed answers.

## Layout

```
plugin/
├── .claude-plugin/plugin.json   manifest
├── .mcp.json                    MCP server wiring (root, not in .claude-plugin)
├── server/elicitkit-server.mjs  self-contained bundled MCP server
├── schema/                      spec JSON Schema (resolved at runtime)
└── skills/elicit/SKILL.md       when/how to use the elicit tool
```

## Packaging

`.mcp.json` runs `${CLAUDE_PLUGIN_ROOT}/server/elicitkit-server.mjs` — a
single self-contained ESM bundle (all deps inlined) produced by
`pnpm pack:plugin` (esbuild). The plugin therefore installs and runs from
anywhere — marketplace, git, or `--plugin-dir` — with no repo, no
`pnpm install`, no build. Regenerate the bundle before release whenever
the server or its deps change: `pnpm pack:plugin`.

> Note: Claude Code v2.1.143 silently drops an inline `mcpServers` block
> in `plugin.json` (upstream bug), which is why the server is wired via a
> root `.mcp.json` instead.

# Elicitkit — Claude Code plugin

Bundles the Elicitkit MCP server + a thin trigger skill so an assistant
asks **rich, typed questions** (10-type catalog) instead of plain chat
prompts. In a terminal client the server auto-uses MCP elicitation, so
questions are interactive (one at a time, with choices).

## Install

```sh
claude plugin install elicitkit/elicitkit/plugin
```

That's it. One prerequisite: **Node ≥ 20**. The plugin pulls in the
bundled self-contained MCP server — no clone, no `pnpm install`, no
build.

Verify with `/mcp` (server `elicitkit`, tools `elicit` + `elicit_submit`)
and `/help` (skill `elicitkit:elicit`). Then just prompt naturally for
something that needs a real decision, e.g.:

> Plan the next deploy with me.

You don't write any JSON. The skill nudges the model to pick the right
question types from your intent (pick environments → `ask_select`,
migration confirm → `ask_confirm`, per-hunk review → `ask_code_diff`),
compose them into an AskSet, and call `elicit`. The server renders it
interactively and the model gets typed answers back.

## Dev / contributor fallback

From a clone of the repo, build once and point Claude Code at the local
plugin directory:

```sh
pnpm install && pnpm build
claude --plugin-dir ./plugin
```

In-session, reload after edits with `/reload-plugins`.

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
anywhere — marketplace, git, or the dev `--plugin-dir` fallback — with no
repo, no `pnpm install`, no build. Regenerate the bundle before release
whenever the server or its deps change: `pnpm pack:plugin`.

> Note: Claude Code v2.1.143 silently drops an inline `mcpServers` block
> in `plugin.json` (upstream bug), which is why the server is wired via a
> root `.mcp.json` instead.

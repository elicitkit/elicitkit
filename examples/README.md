# Elicitkit — integrator recipes

**For agent builders / integrators wiring Elicitkit into a tool or agent.**
End users never see this — your agent calls `elicit` on their behalf. They
prompt naturally ("review this PR", "plan the deploy"); the agent composes
the `AskSet` and dispatches it through one of these surfaces. The
`*-askset.json` files here are integrator fixtures the recipes feed in,
not something an end user ever writes.

One question (`sample-askset.json`: per-hunk code-diff + multi-select + free
text), shown through every surface. Build once, then run any demo:

```sh
pnpm build
```

| # | Run | Surface | Who it's for |
|---|-----|---------|--------------|
| 1 | `bash examples/1-cli.sh`   | **CLI**  | shell scripts / git hooks / deploy scripts — no AI, no server |
| 2 | `bash examples/2-http.sh`  | **HTTP** | CI / n8n / backend jobs — web request in, signed link out, result back |
| 3 | `node examples/3-mcp.mjs`  | **MCP**  | AI assistants (Claude Code, Cursor, Codex) — the v0.1 wedge |
| 4 | `bash examples/4-browser.sh` | **the panel itself** | what the human actually clicks (`url` tier, standalone) |

Each prints a narrated walkthrough. Demo 2 also shows the security envelope
(one-time + forged-link rejection); demo 3 shows the *same* Ask resolving on
two different client capabilities (rich panel vs. native elicitation) — the
4-tier "works everywhere" point.

### Wire the MCP server into a real AI client

Same one-block config for every MCP client (Claude Code, Codex CLI, Cursor,
Claude Desktop, VS Code, Zed, Continue, Cline, Windsurf, …):

```json
{ "mcpServers": { "elicitkit": { "command": "npx", "args": ["-y", "@elicitkit/server"] } } }
```

Then ask the assistant to do something that needs your input — it calls the
`elicit` tool itself. Pre-publish fallback (until `@elicitkit/server` is on
npm): swap `npx`/`["-y", "@elicitkit/server"]` for `node`/`["<repo>/packages/server/dist/bin.js"]`.

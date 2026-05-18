# Elicitkit ‽

[![CI](https://github.com/elicitkit/elicitkit/actions/workflows/ci.yml/badge.svg)](https://github.com/elicitkit/elicitkit/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![spec v0.1](https://img.shields.io/badge/spec-v0.1-informational.svg)](./packages/spec/SPEC.md)

> The default "agent asks the human" layer — a portable spec, an MCP reference implementation, and a conformance suite for **the moment an AI agent needs to ask a person a real, typed question**.

![Elicitkit ask_code_diff demo — per-hunk accept/reject](./assets/demo/ask-code-diff.gif)

The interrobang ‽ is the point: not a statement, not a plain prompt — a *question with a type*.

## What this is

When an agent needs your input today, it gets one of two things: a wall of free text, or a flat multiple-choice list. Elicitkit is the layer for the other case — **the moment the agent asks a human a typed question**: approve/reject this diff per hunk, rank these options, pick a date, set a bounded number. The agent emits a typed `Ask`; the host renders it as richly as it can; you get a validated, typed answer back.

It is a question-type vocabulary on top of MCP — it complements the MCP Apps extension (SEP-1865), it does not compete with it. A type-aware client renders the real control; a dumb client falls back to `prompt` + free text. Same wire format either way.

## Two audiences

**End users — you prompt your agent in plain language. You never write JSON.**

You're using an AI agent (Claude Code, Codex CLI, Cursor, …) that already has Elicitkit wired in. You ask in natural language — *"review this PR"*, *"help me prioritize these features"*, *"plan the deploy"*. The agent picks the right typed question(s) — per-hunk ✓/✗ on diffs, a slider, a rank, a date — composes them into an `AskSet`, and calls the `elicit` tool. You just answer the rich questions it presents. The skill that nudges the agent to do this lives at [`plugin/skills/elicit/SKILL.md`](./plugin/skills/elicit/SKILL.md).

**Integrators / agent builders — wire Elicitkit into your agent's environment once.**

Drop the universal MCP block into your client (below), or `claude plugin install elicitkit/elicitkit/plugin`, or call the HTTP/CLI surface directly. Your users prompt naturally; the agent composes the `AskSet` and calls `elicit`. Recipes for the MCP / HTTP / CLI surfaces are in [`examples/`](./examples). The end-user flow is: **(1)** their agent has Elicitkit wired in (you did this once); **(2)** they prompt naturally; **(3)** the agent presents typed questions; they answer; done.

## The pitch

- **1 core, everywhere it goes.** One validator + portable question model (`@elicitkit/core`); every surface is a thin shell over it.
- **4 progressive render tiers.** `apps → url → elicitation → tui`, richest to poorest. The host advertises what it supports; the server picks the richest faithful tier. Graceful degradation is part of each type's definition, not an afterthought — a type never hard-fails.
- **3 surfaces.** MCP reference server, a zero-dependency HTTP/SDK surface, and an `npx` CLI for shell-out tools. Same core, same answers.
- **10 typed question types.** `ask_text` · `ask_select` · `ask_confirm` · `ask_code_diff` (the wedge — per-hunk accept/reject) · `ask_number` · `ask_rating` · `ask_slider` · `ask_date` · `ask_rank` · `ask_color`. Each defines behaviour across all four tiers.
- **Zero-drift.** The spec is the product; the server is its reference implementation; the JSON Schema is generated, not hand-kept. One source of truth, no spec/impl skew.
- **The conformance suite is the standard.** "Elicitkit-compliant" is whatever `@elicitkit/conformance` says it is — a spec-derived fixture corpus + a portable runner any implementation points at. It has teeth: it rejects a permissive impl, and the reference server must pass its own suite.

## Quickstart (integrators)

For agent builders / tool integrators. End users never run any of this — their agent calls `elicit` on their behalf once you've wired the server in.

One prerequisite: **Node ≥ 20**. No clone, no absolute paths, no bundled binary, no Chrome.

### Add the MCP server to any MCP client

Drop this one block anywhere a client takes MCP server config:

```json
{ "mcpServers": { "elicitkit": { "command": "npx", "args": ["-y", "@elicitkit/server"] } } }
```

Same snippet, everywhere it goes. Where to paste it per client:

- **Claude Code** — `claude plugin install elicitkit/elicitkit/plugin` (bundles the server + a trigger skill; no manual JSON needed).
- **Codex CLI** — `codex mcp add elicitkit npx -- -y @elicitkit/server`.
- **Cursor** — paste into MCP settings (`Settings → MCP`).
- **Claude Desktop** — paste into `claude_desktop_config.json` under `mcpServers`.
- **VS Code / Zed / Continue / Cline / Windsurf / …** — paste into the MCP config block in that client's settings; the shape is identical.

Verify the server is wired (e.g. `/mcp` in Claude Code or `codex mcp get elicitkit`), then ask for something that needs your input — *"Ask me which environments to deploy to and whether to run migrations."* The agent calls the `elicit` tool itself; the host renders the question; typed answers come back.

### CLI (shell-out, no MCP)

Pipe an `AskSet` in, get validated typed answers out (stdout is pure JSON; prompts go to stderr):

```sh
cat examples/sample-askset.json | npx -y @elicitkit/cli ask /dev/stdin
# or render the url-tier panel to open in a browser:
npx -y @elicitkit/cli render examples/sample-askset.json --out panel.html
```

### HTTP (any automation, no MCP)

```sh
npx -y @elicitkit/http   # POST /elicit · GET /r/:token · POST /elicit/submit · GET /health
```

> **Pre-publish note (until v0.1.0 hits npm):** the canonical `npx -y @elicitkit/*` story above is the post-publish target state. Right now the equivalent dev path is `git clone https://github.com/elicitkit/elicitkit && pnpm install && pnpm -r build`, then point Claude Code at the bundled plugin with `claude --plugin-dir ./plugin`, or wire other clients to `node packages/server/dist/bin.js`. Once `@elicitkit/server`, `@elicitkit/cli`, and `@elicitkit/http` are published, the universal `npx -y` pattern takes over.

## Validated clients

Elicitkit is host-authoritative — the host owns the render surface; the server only advertises tiers and validates answers.

| Client | Status |
|---|---|
| **Claude Code** (v2.1.143) | ✅ verified — bundled plugin, native MCP elicitation tier |
| **Codex CLI** (0.124.0) | ⚙️ MCP wiring verified; interactive round via runbook ([below](#codex-cli)) — the headless `codex exec` path cannot complete a human round (it cancels interactive MCP tool calls without a TTY) |

### Codex CLI

The locked first non-Claude validation target. Codex is a terminal MCP client, so Elicitkit lands on the **native elicitation tier**, host-authoritative — Codex owns the prompt surface, the server only advertises tiers and validates answers.

Wire it once with the universal snippet:

```sh
codex mcp add elicitkit npx -- -y @elicitkit/server
codex mcp get elicitkit       # → enabled, transport: stdio
```

**Drive an interactive round** (a TTY is required — Codex prompts you to approve the MCP tool call and then answers the elicitation; `codex exec` headless will *cancel* the call, so use the interactive client):

```sh
codex
> Read examples/sample-askset.json and call the elicitkit `elicit` tool
  with it as the askSet. Approve the call when prompted, then answer the
  questions.
```

**What success looks like:** Codex requests approval for the `elicit` tool → after approval the server negotiates the `elicitation` tier and Codex renders the `ask_code_diff` (per-hunk accept/reject), then `ask_select`, then the optional `ask_text` as native one-at-a-time prompts → the tool returns a validated `Answer[]` (one per ask, `status: "answered" | "declined" | "deferred"`) with `_meta.elicitkit.renderedTier === "elicitation"`. No `elicit_submit` call is needed on this tier — answers resolve inline.

> Verified to the tool boundary headlessly: `codex exec --json` discovers the server and invokes `elicit` with the exact `examples/sample-askset.json` AskSet, but the non-interactive client cancels the call (`"user cancelled MCP tool call"`) because the human elicitation step has no TTY. The interactive runbook above completes the round.

## Repo structure

| Path | Role |
|---|---|
| [`packages/spec`](./packages/spec) | **The product** — question-type vocabulary, JSON Schema, versioning ([`SPEC.md`](./packages/spec/SPEC.md)) |
| `packages/core` | Type registry + validation + portable question model |
| `packages/server` | MCP server — the reference implementation (`@elicitkit/server`) |
| `packages/http` · `packages/cli` | Standalone HTTP/SDK + `npx` shell-out surfaces |
| `packages/renderers/{apps,url,elicitation,tui}` | The 4-tier progressive fallback |
| `packages/conformance` | The suite others run to claim compliance |
| `registry/packs/*` | Community pack registry (PR-to-add; see `pr-review`) |
| `apps/playground` | Landing + live panel (regenerated from the real renderer) |
| `plugin/` | Thin Claude Code plugin (bundles server + skill) |

## Links

- **Spec** — [`packages/spec/SPEC.md`](./packages/spec/SPEC.md)
- **Roadmap** — [`ROADMAP.md`](./ROADMAP.md) (type catalog, milestones, what to build next)
- **Contributing** — [`CONTRIBUTING.md`](./CONTRIBUTING.md) (the highest-leverage PR is a new type or a pack)
- **Playground** — [`apps/playground`](./apps/playground) (live panel; the README/demo artifact)
- **Conduct** — [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) · **Security** — [`SECURITY.md`](./SECURITY.md) · **Governance** — [`GOVERNANCE.md`](./GOVERNANCE.md)

## License & trademarks

Apache-2.0 — see [`LICENSE`](./LICENSE).

Elicitkit is **not affiliated with, endorsed by, or sponsored by SurveyJS / DEVSOFTBALTIC**. The SurveyJS-format bridge is an independent clean-room implementation built from public documentation; "SurveyJS" is a trademark of its respective owner.

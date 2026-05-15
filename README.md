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

## The pitch

- **1 core, everywhere it goes.** One validator + portable question model (`@elicitkit/core`); every surface is a thin shell over it.
- **4 progressive render tiers.** `apps → url → elicitation → tui`, richest to poorest. The host advertises what it supports; the server picks the richest faithful tier. Graceful degradation is part of each type's definition, not an afterthought — a type never hard-fails.
- **3 surfaces.** MCP reference server, a zero-dependency HTTP/SDK surface, and an `npx` CLI for shell-out tools. Same core, same answers.
- **10 typed question types.** `ask_text` · `ask_select` · `ask_confirm` · `ask_code_diff` (the wedge — per-hunk accept/reject) · `ask_number` · `ask_rating` · `ask_slider` · `ask_date` · `ask_rank` · `ask_color`. Each defines behaviour across all four tiers.
- **Zero-drift.** The spec is the product; the server is its reference implementation; the JSON Schema is generated, not hand-kept. One source of truth, no spec/impl skew.
- **The conformance suite is the standard.** "Elicitkit-compliant" is whatever `@elicitkit/conformance` says it is — a spec-derived fixture corpus + a portable runner any implementation points at. It has teeth: it rejects a permissive impl, and the reference server must pass its own suite.

## Quickstart

### Claude Code plugin

Bundled, self-contained MCP server + a trigger skill. From a clone of the repo, build once, then launch Claude Code with the plugin:

```sh
pnpm install && pnpm build
claude --plugin-dir ./plugin
```

Verify with `/mcp` (server `elicitkit`, tools `elicit` + `elicit_submit`). Then ask for something that needs your input — e.g. *"Ask me which environments to deploy to and whether to run migrations."* In a terminal client the server uses native MCP elicitation, so questions are interactive and typed. See [`plugin/README.md`](./plugin/README.md) for packaging details.

### CLI (shell-out, no MCP)

Pipe an `AskSet` in, get validated typed answers out (stdout is pure JSON; prompts go to stderr):

```sh
cat examples/sample-askset.json | npx @elicitkit/cli ask /dev/stdin
# or render the url-tier panel to open in a browser:
npx @elicitkit/cli render examples/sample-askset.json --out panel.html
```

### From source

```sh
pnpm install
pnpm -r build
pnpm -r test     # must stay green, incl. @elicitkit/conformance
```

Prerequisites: **Node ≥ 20**, **pnpm** (pinned via `packageManager`; `corepack enable`).

## Validated clients

Elicitkit is host-authoritative — the host owns the render surface; the server only advertises tiers and validates answers.

| Client | Status |
|---|---|
| **Claude Code** (v2.1.143) | ✅ verified — bundled plugin, native MCP elicitation tier |

## Repo structure

| Path | Role |
|---|---|
| [`packages/spec`](./packages/spec) | **The product** — question-type vocabulary, JSON Schema, versioning ([`SPEC.md`](./packages/spec/SPEC.md)) |
| `packages/core` | Type registry + validation + portable question model |
| `packages/server` | MCP server — the reference implementation |
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

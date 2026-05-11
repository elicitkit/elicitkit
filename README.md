# Elicitkit ‽

> A curated, opinionated catalog of rich question types for AI agents — a portable spec, a reference implementation over MCP, and a community pack registry. The default "agent asks the user" layer.

**Status:** pre-alpha. Architecture is locked; v0.1 not yet built.

## What this is

Agents today ask humans things through plain multiple-choice or free text. Elicitkit gives them a real vocabulary of question types — slider, rank, MaxDiff, Likert, code-diff approve/reject, card-sort, and more — that render beautifully where the client supports it and degrade gracefully where it doesn't, behind one spec and one engine.

It is a **question-type vocabulary layer on top of** the official MCP Apps extension (SEP-1865) — not a competitor to it.

## Locked decisions

| Decision | Locked |
|---|---|
| Posture | OSS standard-play — won by spec + reference impl + conformance suite |
| Rendering | Progressive 4-tier: MCP Apps → hosted URL → MCP elicitation → TUI/text |
| v1 scope | ~20+ type catalog + question-packs + community pack registry |
| Reach | One core, 3 surfaces: MCP server + standalone HTTP/SDK + `npx` CLI |
| Name | Elicitkit ‽ |
| Wire format | Own agent-optimized spec + clean-room SurveyJS-shape bridge |
| License | Apache-2.0 |
| v0.1 wedge | `ask_code_diff` (per-hunk accept/reject) + PR-review pack |

## Repo structure

| Path | Role |
|---|---|
| `packages/spec` | **The product** — question-type vocabulary, JSON Schemas, versioning |
| `packages/core` | Type registry + validation + portable question model |
| `packages/server` | MCP server (reference implementation) |
| `packages/http` · `packages/cli` | Standalone HTTP/SDK + `npx` shell-out surfaces |
| `packages/renderers/{apps,url,elicitation,tui}` | The 4-tier progressive fallback |
| `packages/conformance` | The suite others run to claim compliance |
| `registry/packs/*` | Community pack registry (PR-to-add) |
| `apps/playground` | Demo / landing |
| `plugin/` | Thin Claude Code plugin manifest (bundles server + skill) |
| `.planning/` | **Gitignored.** Full catalog roadmap, decision log, build sequence |

## Roadmap

The full type catalog and build sequence live in the **gitignored** `.planning/` directory (private working notes — see `.planning/01-type-catalog.md`). A trimmed public `ROADMAP.md` should be added before first release (see watchpoints in `.planning/04`).

## Licensing & trademarks

Apache-2.0 (see `LICENSE`). Set the copyright owner before first release. Elicitkit is **not affiliated with or endorsed by SurveyJS / DEVSOFTBALTIC**; the SurveyJS-format bridge is an independent clean-room implementation built from public documentation. "SurveyJS" is a trademark of its respective owner.

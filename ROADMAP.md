# Elicitkit Roadmap

Elicitkit is a portable spec + reference implementation + conformance suite
for **the moment an AI agent needs to ask a human a real, typed question** —
not a free-text guess. One core, four progressive render tiers
(`apps → url → elicitation → tui`), three surfaces (MCP · HTTP · CLI).

This is the public roadmap. The pitch is the **catalog**: every question
type is a self-contained, well-specified unit anyone can implement and
contribute. Pick an unbuilt one and open a PR.

## Status: v0.1 (pre-release)

Shipped: the spec (`packages/spec`), validator + portable model
(`packages/core`), MCP reference server, all four render tiers
(`packages/renderers`), HTTP + CLI surfaces, the security envelope
(signed one-time links · origin allowlist · CSP), the conformance suite
(`packages/conformance` — the source of truth for "Elicitkit-compliant"),
the flagship `pr-review` pack, and a Claude Code plugin.

## Type catalog

✅ = shipped & conformance-covered · 🔜 = specced/planned · 💡 = design wanted

| Type | Status | Notes |
|---|---|---|
| `ask_text` | ✅ | free / multiline text |
| `ask_select` | ✅ | single & multi, bounded |
| `ask_confirm` | ✅ | yes/no with consequence |
| `ask_code_diff` | ✅ | **the wedge** — per-hunk accept/reject |
| `ask_number` | ✅ | bounded, integer/step/unit |
| `ask_rating` | ✅ | 1..N, star/numeric |
| `ask_slider` | ✅ | bounded range |
| `ask_date` | ✅ | date / date-time |
| `ask_rank` | ✅ | order a fixed set |
| `ask_color` | ✅ | palette + optional custom picker |
| `ask_multi_search` | 🔜 | searchable multi-select |
| `ask_table` | 🔜 | row/column structured entry |
| `ask_form` | 🔜 | composite + branching (`edges` is reserved in v0.1) |
| `ask_file` | 🔜 | file/attachment reference |
| `ask_maxdiff` · `ask_priority_matrix` · `ask_constant_sum` | 🔜 | decision elicitation |
| `ask_likert` · `ask_nps` · `ask_semantic_differential` | 🔜 | research scales |
| `ask_card_sort` · `ask_annotate` · `ask_map_point` | 💡 | stretch |

Every type **must** define behaviour for all four tiers — graceful
degradation is part of the type definition, not an afterthought (SPEC §4).

## Milestones

- **v0.1** — credibility wedge: spec + reference impl + conformance + the
  `ask_code_diff`/`pr-review` wedge, on ≥2 clients. *(here)*
- **v0.2** — breadth: remaining list/search/table types.
- **v0.3** — decision-elicitation + research scales; **answer-memory**
  (the reserved `agentGuess`/`confidence`/`memoryKey` hooks activate as a
  forward-compatible MINOR — never a breaking change).
- **v0.4** — composite + branching (`ask_form`, `edges`); more packs.
- **v1.0** — spec freeze + SemVer policy; **conformance badge program**;
  proposed as an MCP community extension; governance docs.

## Contributing

The highest-leverage contribution is a **new type** or a **pack**:

1. Add it to `packages/spec` (TS type + JSON Schema + `SPEC.md` entry,
   including all-four-tier degradation).
2. Add `valueError` in `packages/core` and renderers in
   `packages/renderers`.
3. Add fixtures to `packages/conformance` — your type isn't done until
   the suite covers its valid/invalid values.
4. A pack is a pure builder under `registry/packs/*` that emits a
   v0.1-valid AskSet (see `pr-review`).

"Elicitkit-compliant" is whatever `@elicitkit/conformance` says it is — the
suite, not any one implementation, is the standard.

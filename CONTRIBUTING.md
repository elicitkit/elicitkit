# Contributing to Elicitkit

Thanks for helping build the standard for *the moment an AI agent asks a human a real, typed question*. The pitch is the **catalog**: every question type is a self-contained, well-specified unit anyone can implement and contribute.

## Setup

Prerequisites: **Node ≥ 20**, **pnpm** (pinned via `packageManager`; `corepack enable`).

```bash
pnpm install
pnpm -r build
pnpm -r test
```

`pnpm -r test` must stay green, including **`@elicitkit/conformance`** — the source of truth for "Elicitkit-compliant". A change that weakens conformance will not be merged; a change that adds capability should add fixtures.

## Adding a question type

A type is shippable only when it lands end-to-end:

1. `packages/spec` — the TypeScript type + the JSON Schema entry + a SPEC.md section (incl. tier degradation).
2. `packages/core` — `valueError` validation for the new type.
3. `packages/renderers` — all four tiers (`apps`, `url`, `elicitation`, `tui`); presentation is never a fidelity floor.
4. `packages/conformance` — valid **and** invalid fixtures (the corpus has teeth).

See `ROADMAP.md` for unbuilt types and the `💡 design wanted` list.

## Adding a pack

Add under `registry/packs/<name>` (mirror `pr-review`): a pure builder that emits a v0.1-valid `AskSet`, with tests.

## Commits & PRs

- **Conventional Commits** (`feat:`, `fix:`, `docs:`…).
- **DCO** — sign off every commit (`git commit -s`, adds `Signed-off-by:`). By contributing you agree your contribution is licensed under **Apache-2.0** (the project license). We use DCO, not a CLA.
- One logical change per PR; suite green; conformance not weakened; SPEC/ROADMAP updated when behavior changes.
- The reserved spec hooks (`agentGuess`/`confidence`/`memoryKey`) stay reserved until the asking-intelligence minor — don't repurpose them.

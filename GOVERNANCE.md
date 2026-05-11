# Governance

## Model (v0.1, pre-release)

Elicitkit is **maintainer-led** ("the Elicitkit authors"). Day-to-day changes proceed by **lazy consensus**: a PR that passes the suite, doesn't weaken conformance, and sees no sustained maintainer objection within a reasonable window may be merged.

## Normative sources of truth

In order of authority:

1. **`packages/spec`** — `SPEC.md` + the JSON Schema. The spec *is* the product.
2. **`packages/conformance`** — the executable arbiter of "Elicitkit-compliant".
3. The reference implementation (`@elicitkit/core` and surfaces).

If code and spec disagree, the spec wins and the code is a bug.

## Versioning

Strict **SemVer** on the spec.

- New types / optional fields = **minor**, additive, forward-compatible (older clients ignore unknowns).
- The reserved hooks (`agentGuess`, `confidence`, `memoryKey`) stay reserved until the asking-intelligence minor; repurposing them is a **major**.
- Any change that can reject a previously-valid `AskSet`/`Answer` is a **major** (security hardening may be expedited within pre-release v0.1.x with a conformance fixture).

## Spec changes

Proposal (issue) → discussion → PR that **must** include conformance fixtures (valid and invalid) → maintainer review. No spec change merges without conformance coverage.

## Path to open governance

Once there is sustained external contribution, this evolves toward a documented steering process and a public RFC track. A north-star goal is to propose Elicitkit as an **MCP community extension (SEP)**; governance and the spec are kept SEP-shaped deliberately.

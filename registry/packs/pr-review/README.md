# @elicitkit/pack-pr-review

The flagship Elicitkit pack — the v0.1 wedge. Turn a pull request into one
structured review round-trip:

1. **`ask_code_diff`** — accept/reject every hunk
2. **`ask_select`** — verdict (approve / nits / request changes)
3. **`ask_rating`** — merge risk (optional)
4. **`ask_text`** — blocking concerns (optional)

```ts
import { buildPrReviewAskSet } from "@elicitkit/pack-pr-review";

const askSet = buildPrReviewAskSet({
  title: "Tighten the auth guard",
  files: [{ path: "src/auth.ts", hunks: [
    { id: "h1", header: "@@ active check @@", before: "if (u)", after: "if (u && u.active)" },
  ] }],
});
// → feed askSet to any surface: the MCP `elicit` tool, HTTP /elicit, or the CLI.
```

Pure (no I/O, no MCP) — the same AskSet works through every Elicitkit
surface. Wire your VCS/diff source to the `files` input; everything else
is the spec.

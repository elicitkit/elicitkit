# Elicitkit Question Spec — v0.1 (Draft)

_Private working draft. Gitignored. Status: **Draft**, 2026-05-16. The spec is the product; the MCP server is its reference implementation._

Key words **MUST**, **SHOULD**, **MAY** per RFC 2119.

---

## 1. Versioning

- The spec is **SemVer**'d. Every payload carries `specVersion` (e.g. `"0.1.0"`).
- Unknown **minor** additions MUST be ignored by older clients, not rejected (forward-compatible).
- A breaking change is a **major** bump. The v0.1 envelope reserves fields (§4) precisely so the asking-intelligence layer ships later as a **minor**, never a major.

## 2. Core model

Three objects only:

- **Ask** — one question (§3).
- **AskSet** — an ordered batch of Asks with optional branching (§6).
- **Answer** — the typed response contract (§5).

## 3. The Ask envelope

Every Ask, regardless of type, is:

```jsonc
{
  "id": "string",                 // unique within the AskSet
  "type": "ask_text | ask_select | ask_confirm | ask_code_diff | ...",
  "prompt": "string",             // the question, plain text
  "help": "string?",              // optional clarifying detail
  "required": true,               // default true
  "spec": { "...type-specific..." },

  // ── Reserved hooks (v0.1 inert; populated in a later MINOR) ──
  "agentGuess": "any?",           // the agent's proposed answer
  "confidence": 0.0,              // 0–1; enables confidence-gated auto-accept
  "memoryKey": "string?",         // stable key for answer-memory / auto-skip
  "meta": {
    "specVersion": "0.1.0",
    "minTier": "tui"              // lowest render tier that is still faithful
  }
}
```

A type-aware renderer reads `type` + `spec`; a dumb renderer can always fall back to `prompt` + free text.

## 4. Render tiers (progressive fallback)

`tier ∈ { "apps", "url", "elicitation", "tui" }`, richest → poorest.

- The host advertises `supportedTiers`. The server picks the **richest tier ≥ the Ask's `meta.minTier`** that the host supports.
- Every type MUST define behaviour for **all four** tiers (degradation is part of the type definition, not an afterthought). A type that cannot degrade below `url` MUST set `minTier: "url"` and provide a text-summary fallback so it never hard-fails.

### 4.1 Non-blocking contract (uniform across tiers)

Every elicit tool call MUST return in less than the host's per-call MCP timeout (≪ 1 s server-side, bounded by **one** user answer at most on the elicitation tier). This is achieved by surfacing a **pending envelope** the agent drives forward across multiple tool calls:

| Tool | Behaviour |
|---|---|
| `elicit(askSet, supportedTiers?)` | Returns fast. Shape: `{ pending: true, token, tier, ...tierContext }` with `_meta.elicitkit` carrying `renderedTier`, `hostTiers`, and (when the slow-ask auto-router fires) `routedAwayFromElicitation: true` plus a `routeReason`. The elicitation tier issues the FIRST native `elicitInput` inline and awaits ONE answer before returning. |
| `elicit_next(token)` | **Elicitation tier only.** Issues the next `elicitInput`, awaits one user answer, returns `{ pending: true, token, completed, total }` or final `{ pending: false, answers }`. Other tiers complete via `elicit_submit` instead. |
| `elicit_submit(token, answers)` | Panel tiers (`tui` / `url` / `apps`). Validates and completes the round. |

Per-tier flow:

- **tui** — `elicit` returns AskSet + token; agent presents in chat; agent calls `elicit_submit`.
- **elicitation** — `elicit` opens the round, fires `elicitInput` for ask 1, awaits ONE answer, returns `{ pending, token, completed: 1, total: N }`. Agent calls `elicit_next(token)` per remaining ask. The final call returns `{ pending: false, answers }`.
- **url** — `elicit` returns `{ pending, token, panelUrl }` IMMEDIATELY. Panel POSTs to `/elicit/submit` OR the user copy-pastes JSON back → agent forwards verbatim to `elicit_submit`.
- **apps** — `elicit` returns `{ pending, token, panelUri }` IMMEDIATELY. mcp-ui widget posts back → agent forwards to `elicit_submit`.

### 4.2 Slow-ask auto-router (normative)

Before negotiating tiers, the server inspects the AskSet for asks that are likely to exceed the per-call MCP timeout when issued one-question-at-a-time through the native elicitation primitive. If any such ask is present the server MUST drop `elicitation` from the candidate tier list and surface `_meta.elicitkit.routedAwayFromElicitation: true` with a `routeReason` naming the rule that fired. The agent does not choose tiers manually.

| Trigger | Reason |
|---|---|
| `ask_text` with `multiline: true` OR `maxLen >= 200` (or `maxLen` unset) | Long typing time |
| `ask_code_diff` with > 2 hunks total across all files | Hunk-by-hunk review needs thought |
| `ask_rank` with > 4 items | Ordering > 4 takes thought |

Quick asks pass through to elicitation: `ask_select` (≤ 8 options), `ask_confirm`, `ask_number`, `ask_rating`, `ask_slider`, `ask_date`, `ask_color`, short `ask_text`. Future composite types (`ask_form`, `ask_table`) reserve the rule slot.

## 5. Answer contract

```jsonc
{
  "id": "string",                 // echoes the Ask id
  "type": "string",
  "status": "answered | declined | deferred",
  "value": "any",                 // shape defined per type (§7); null unless answered
  "meta": { "tier": "apps", "specVersion": "0.1.0" }
}
```

- Servers MUST validate `value` against the type's schema and **re-ask** on invalid (max retries configurable).
- `declined` and `deferred` are first-class — agents MUST handle "the human chose not to answer."

## 6. AskSet (batch + branching)

```jsonc
{
  "specVersion": "0.1.0",
  "asks": [ Ask, ... ],
  "edges": []                     // RESERVED v0.1: conditional branching (minor add)
}
```

v0.1 renders `asks` in order in one panel where the tier allows (one round-trip). `edges` is reserved so question-graphs are a later minor.

## 7. v0.1 type catalog

Ten types are normative — the four-type wedge (§7.1–7.4) plus numeric / temporal / ordinal / color breadth (§7.5–7.10). Each defines behaviour for all four tiers; an unlisted `type` is a forward-compatible MINOR addition older clients ignore.

### 7.1 `ask_text`
`spec`: `{ multiline?: bool, placeholder?: str, pattern?: regex, maxLen?: int }` · `value`: `string`
Tiers: apps/url = input; elicitation = string primitive; tui = prompt.

### 7.2 `ask_select`
`spec`: `{ options: [{id, label, description?}], multiple?: bool, min?, max? }` · `value`: `id | id[]`
Tiers: apps/url = styled list; elicitation = enum; tui = arrow-select.

### 7.3 `ask_confirm`
`spec`: `{ affirm?: str="Yes", deny?: str="No", consequence?: str }` · `value`: `boolean`
`consequence` renders as a "what will happen" preview where the tier allows.

### 7.4 `ask_code_diff` — **the v0.1 wedge**
```jsonc
"spec": {
  "files": [{
    "path": "string",
    "hunks": [{ "id": "string", "header": "string",
                "before": "string", "after": "string" }]
  }],
  "granularity": "hunk"           // v0.1: per-hunk only
}
```
`value`: `{ accepted: hunkId[], rejected: hunkId[] }`
Tiers: apps/url = interactive diff with per-hunk ✓/✗; elicitation = one `ask_confirm` per hunk; tui = same, sequential. `minTier: "tui"` (never hard-fails).

### 7.5 `ask_number`
`spec`: `{ min?, max?, step?, unit?: str, integer?: bool }` · `value`: `number`
Tiers: apps/url = number input; elicitation = number/integer primitive; tui = prompt (validated).

### 7.6 `ask_rating`
`spec`: `{ max?: int=5, icon?: "star"|"number", labels?: {min?,max?} }` · `value`: `integer` in `[1, max]`
Tiers: apps/url = star/number row; elicitation = integer (min 1, max); tui = `1..max` prompt.

### 7.7 `ask_slider`
`spec`: `{ min, max, step?, unit?: str }` · `value`: `number` in `[min, max]`
Tiers: apps/url = range slider w/ live value; elicitation/tui = number in range (slider is a presentation, never a fidelity floor).

### 7.8 `ask_date`
`spec`: `{ min?, max?, time?: bool }` · `value`: `"YYYY-MM-DD"` (RFC3339 date-time if `time`)
Tiers: apps/url = native date(-time) input; elicitation = string `format: date|date-time`; tui = prompt (validated).

### 7.9 `ask_rank`
`spec`: `{ items: [{id, label, description?}] }` · `value`: `string[]` — a **permutation of all item ids**
Tiers: apps/url = reorderable list (move up/down); elicitation/tui = enter the ids in order (degradation defined: ordering UI is not a fidelity floor — ranking still completes as an ordered id list).

### 7.10 `ask_color`
`spec`: `{ palette?: string[], allowCustom?: bool }` · `value`: a CSS color string
With a `palette` and `allowCustom` not true, the value MUST be a palette entry.
Each `palette[]` entry MUST match the **safe color grammar** (§7.y).
Tiers: apps/url = swatches (+ native picker when custom allowed); elicitation =
string `enum` of the palette when fixed, else free string; tui = prompt (validated).

## 7.x Presentation hints (advisory, non-normative)

Optional fields that richer renderers MAY honour. They never change the
`value` contract and MUST be safely ignorable — a renderer that drops them
is still conformant (forward-compatible).

- `AskSet.meta.layout`: `"auto"` (default) · `"single"` · `"grid"` — column
  strategy across asks.
- `AskSet.meta.theme`: `"system"` (default) · `"midnight"` · `"paper"` ·
  `"high-contrast"`; `AskSet.meta.accent`: a CSS color (overrides accent) —
  MUST match the safe color grammar (§7.y).
- `Ask.meta.span`: `"half"` | `"full"` — overrides the per-ask auto layout.
- `ask_select.spec.display`: `"list"` (default) · `"cards"` · `"segmented"`
  · `"grid"`.
- `SelectOption.icon` (curated icon name or raw character/emoji — unknown
  names degrade to text) and `SelectOption.color` (a swatch) — `color` MUST
  match the safe color grammar (§7.y).

### 7.y Safe color grammar (normative)

`SelectOption.color`, every `ask_color.spec.palette[]` entry, and
`AskSet.meta.accent` are CSS color strings rendered into a **CSS value
sink**. To prevent value-injection (`url()` exfiltration, `var()` /
`image-set()` / `element()` / gradient breakout) on channels with no
Content-Security-Policy (e.g. an mcp-ui `rawHtml` embed, a `data:` URL, or
a copy-pasted panel), these fields MUST match (after trimming):

```
^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-zA-Z.,%/ +\-]*\))$
```

It accepts `#hex` (3/4/6/8), a CSS named/keyword color, and the common
functional notations with a safe inner charset; it structurally cannot
express `url(`, `var(`, `image-set(`, `element(`, gradients, quotes, `;`,
or a nested `(`. A producer MUST NOT emit a non-conforming value; a
**validator MUST reject** an AskSet that contains one. Because these are
optional presentation fields, a renderer MUST treat an empty or
non-conforming value as "no color" (omit the swatch/chip/accent) and MUST
NOT pass it to a CSS sink — never hard-fail rendering over it.

## 8. Conformance (normative intent)

A "Elicitkit-compliant" implementation MUST: round-trip the envelope (§3) and Answer (§5) losslessly; honour `required`/`declined`/`deferred`; implement all four tiers for every type it claims; preserve unknown reserved fields untouched. The conformance suite (separate package) is the source of truth.

---

_Next: encode this as JSON Schema (`schema/elicitkit-v0.1.schema.json`), then `packages/core` validates against it._

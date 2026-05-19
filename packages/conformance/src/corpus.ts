/**
 * The conformance corpus — spec-derived fixtures. This file is the
 * language-agnostic source of truth for "Elicitkit-compliant" (SPEC §8).
 * Any implementation in any language can consume these cases; the runner
 * (index.ts) is just the reference harness over them.
 */

export interface AskSetCase {
  name: string;
  valid: boolean;
  /** an AskSet payload */
  askSet: unknown;
  note: string;
}

export interface AnswerCase {
  name: string;
  valid: boolean;
  /** the AskSet the answer is for (single ask) */
  askSet: unknown;
  /** raw answers array */
  answers: unknown;
  note: string;
}

const META = { specVersion: "0.1.0", minTier: "tui" };
const ask = (type: string, spec: unknown, extra: Record<string, unknown> = {}) => ({
  id: type, type, prompt: `${type}?`, spec, meta: META, ...extra,
});
const set = (...asks: unknown[]) => ({ specVersion: "0.1.0", asks });

// ── Valid AskSets: one per type + envelope guarantees ──────────────────
export const VALID_ASKSETS: AskSetCase[] = [
  { name: "ask_text", valid: true, note: "free text", askSet: set(ask("ask_text", { multiline: true })) },
  { name: "ask_select", valid: true, note: "single", askSet: set(ask("ask_select", { options: [{ id: "a", label: "A" }] })) },
  { name: "ask_select.multiple", valid: true, note: "multi w/ bounds", askSet: set(ask("ask_select", { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], multiple: true, min: 1, max: 2 })) },
  { name: "ask_confirm", valid: true, note: "consequence", askSet: set(ask("ask_confirm", { affirm: "Do it", consequence: "irreversible" })) },
  { name: "ask_code_diff", valid: true, note: "the wedge", askSet: set(ask("ask_code_diff", { granularity: "hunk", files: [{ path: "a.ts", hunks: [{ id: "h1", after: "x=1" }] }] })) },
  { name: "ask_number", valid: true, note: "bounded int", askSet: set(ask("ask_number", { min: 0, max: 10, integer: true })) },
  { name: "ask_rating", valid: true, note: "1..5", askSet: set(ask("ask_rating", { max: 5 })) },
  { name: "ask_slider", valid: true, note: "range", askSet: set(ask("ask_slider", { min: 0, max: 100, step: 5 })) },
  { name: "ask_date", valid: true, note: "date+time", askSet: set(ask("ask_date", { time: true })) },
  { name: "ask_rank", valid: true, note: "order", askSet: set(ask("ask_rank", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] })) },
  { name: "ask_color", valid: true, note: "palette", askSet: set(ask("ask_color", { palette: ["#000000", "#ffffff"] })) },
  { name: "ask_select.display+icon", valid: true, note: "presentation hints are optional/ignorable", askSet: set(ask("ask_select", { display: "cards", options: [{ id: "a", label: "A", icon: "rocket", color: "#f00" }] })) },
  {
    name: "safe-colors-accepted",
    valid: true,
    note: "legit colors across the safe grammar must NOT be over-rejected: #hex, CSS keyword, functional rgb()",
    askSet: {
      specVersion: "0.1.0",
      meta: { layout: "auto", accent: "rebeccapurple" },
      asks: [
        ask("ask_select", { options: [{ id: "o", label: "L", color: "#1d4ed8" }] }),
        ask("ask_color", { palette: ["#1d4ed8", "rebeccapurple", "rgb(10 20 30)"] }),
      ],
    },
  },
  {
    name: "reserved-hooks-and-unknown-meta",
    valid: true,
    note: "agentGuess/confidence/memoryKey inert; unknown meta keys preserved (forward-compat)",
    askSet: set(ask("ask_text", {}, {
      agentGuess: "maybe", confidence: 0.5, memoryKey: "k",
      meta: { ...META, futureKnob: true },
    })),
  },
  {
    name: "askSet.edges-reserved",
    valid: true,
    note: "reserved branching field present but empty is allowed",
    askSet: { specVersion: "0.1.0", asks: [ask("ask_confirm", {})], edges: [] },
  },
];

// ── Invalid AskSets: the schema MUST reject these ──────────────────────
export const INVALID_ASKSETS: AskSetCase[] = [
  { name: "missing-type", valid: false, note: "ask without type", askSet: set({ id: "x", prompt: "?", spec: {} }) },
  { name: "missing-prompt", valid: false, note: "ask without prompt", askSet: set({ id: "x", type: "ask_text", spec: {} }) },
  { name: "empty-id", valid: false, note: "id minLength 1", askSet: set(ask("ask_text", {}, { id: "" })) },
  { name: "bad-specVersion", valid: false, note: "not semver", askSet: { specVersion: "0.1", asks: [ask("ask_text", {})] } },
  { name: "no-asks", valid: false, note: "asks minItems 1", askSet: { specVersion: "0.1.0", asks: [] } },
  { name: "select-without-options", valid: false, note: "ask_select requires options", askSet: set(ask("ask_select", {})) },
  { name: "code_diff-no-files", valid: false, note: "ask_code_diff requires files", askSet: set(ask("ask_code_diff", { granularity: "hunk" })) },
  { name: "code_diff-hunk-without-after", valid: false, note: "hunk requires after", askSet: set(ask("ask_code_diff", { files: [{ path: "a", hunks: [{ id: "h" }] }] })) },
  { name: "slider-without-bounds", valid: false, note: "ask_slider requires min+max", askSet: set(ask("ask_slider", { step: 1 })) },
  { name: "rank-single-item", valid: false, note: "ask_rank needs ≥2 items", askSet: set(ask("ask_rank", { items: [{ id: "a", label: "A" }] })) },
  { name: "confidence-out-of-range", valid: false, note: "confidence ∈ [0,1]", askSet: set(ask("ask_text", {}, { confidence: 9 })) },
  // CSS url() value-injection guard (security review): SelectOption.color,
  // ask_color.palette[], and AskSet.meta.accent MUST match the safe color
  // grammar. url(/var(/quotes etc. are a no-CSP-channel exfil/breakout and
  // MUST be rejected by a compliant impl.
  {
    name: "meta.accent-url-injection",
    valid: false,
    note: "AskSet.meta.accent must match the safe color grammar (no url())",
    askSet: { specVersion: "0.1.0", meta: { accent: "url(https://x)" }, asks: [ask("ask_text", {})] },
  },
  {
    name: "select-option-color-url-injection",
    valid: false,
    note: "SelectOption.color must match the safe color grammar (no url())",
    askSet: set(ask("ask_select", { options: [{ id: "o", label: "L", color: "url(https://evil/x)" }] })),
  },
  {
    name: "ask_color-palette-url-injection",
    valid: false,
    note: "ask_color.palette[] entries must match the safe color grammar (no url())",
    askSet: set(ask("ask_color", { palette: ["url(https://evil/x)"] })),
  },
];

// ── Answers: per-type value contract (SPEC §5/§7) ──────────────────────
const a = (type: string, spec: unknown, value: unknown, status = "answered") => ({
  name: `${type}:${status}:${JSON.stringify(value)}`,
  askSet: set(ask(type, spec)),
  answers: [{ id: type, type, status, value }],
});

export const VALID_ANSWERS: AnswerCase[] = [
  { ...a("ask_text", {}, "hello"), valid: true, note: "string" },
  { ...a("ask_confirm", {}, false), valid: true, note: "boolean" },
  { ...a("ask_select", { options: [{ id: "a", label: "A" }] }, "a"), valid: true, note: "id" },
  { ...a("ask_number", { min: 0, max: 9 }, 4), valid: true, note: "in range" },
  { ...a("ask_rating", { max: 5 }, 5), valid: true, note: "max" },
  { ...a("ask_date", {}, "2026-05-18"), valid: true, note: "iso date" },
  { ...a("ask_rank", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, ["b", "a"]), valid: true, note: "permutation" },
  { ...a("ask_color", { palette: ["#000", "#fff"] }, "#fff"), valid: true, note: "in palette" },
  { ...a("ask_color", { allowCustom: true }, "#1d4ed8"), valid: true, note: "custom allowed" },
  { ...a("ask_text", {}, undefined, "declined"), valid: true, note: "declined is first-class (SPEC §5)" },
];

export const INVALID_ANSWERS: AnswerCase[] = [
  { ...a("ask_text", {}, 123), valid: false, note: "number for text" },
  { ...a("ask_confirm", {}, "yes"), valid: false, note: "string for boolean" },
  { ...a("ask_select", { options: [{ id: "a", label: "A" }] }, "z"), valid: false, note: "unknown id" },
  { ...a("ask_number", { min: 0, max: 9 }, 50), valid: false, note: "out of range" },
  { ...a("ask_rating", { max: 5 }, 0), valid: false, note: "below 1" },
  { ...a("ask_date", {}, "18-05-2026"), valid: false, note: "wrong date format" },
  { ...a("ask_rank", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, ["a"]), valid: false, note: "incomplete ranking" },
  { ...a("ask_rank", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, ["a", "a"]), valid: false, note: "dupe in ranking" },
  { ...a("ask_color", { palette: ["#000", "#fff"] }, "#abc"), valid: false, note: "not in fixed palette" },
  { ...a("ask_color", {}, 123), valid: false, note: "non-string color" },
];

// ── Elicitation-tier rendering: option labels MUST reach the client ────
// The reference renderer emits a JSON Schema for the native MCP
// `elicitation/create` form, plus a free-text message. Some early
// implementations only carried option **ids** (`enum: ["q01_a",
// "q01_b"]`), so a compliant MCP client (Codex CLI was the first repro)
// rendered "1. q01_a / 2. q01_b" instead of "1. A quiet beach / 2. A
// rainy garden". The contract: for any Ask carrying human-readable
// labels (ask_select options, ask_rank items), those label strings MUST
// reach the user — either as enum-branch titles in the schema or in
// the message body. Substring match is sufficient for the fixture; the
// runner serialises message + schema and matches against the combined
// payload, so an implementation may carry per-option descriptions in
// either place.
export interface ElicitationRenderCase {
  name: string;
  /** A single-Ask AskSet to render through the elicitation tier. */
  askSet: unknown;
  /** Substrings that MUST appear in message + serialized request schema. */
  mustInclude: string[];
  /** Substrings that MUST NOT appear (e.g. labels leaking as wire ids). */
  mustExclude?: string[];
  note: string;
}

export const ELICITATION_RENDER: ElicitationRenderCase[] = [
  {
    name: "ask_select.labels-surfaced",
    note: "single-pick options must carry the option label, not just the id",
    askSet: set(ask("ask_select", {
      options: [
        { id: "q01_a", label: "A quiet beach", description: "low tide, gulls" },
        { id: "q01_b", label: "A rainy garden" },
        { id: "q01_c", label: "A library nook" },
      ],
    })),
    mustInclude: ["A quiet beach", "A rainy garden", "A library nook", "low tide, gulls"],
  },
  {
    name: "ask_select.multiple.labels-surfaced",
    note: "multi-pick: same label contract applies through items.anyOf",
    askSet: set(ask("ask_select", {
      multiple: true, min: 1, max: 2,
      options: [
        { id: "stack_node", label: "Node.js" },
        { id: "stack_go", label: "Go" },
        { id: "stack_rust", label: "Rust" },
      ],
    })),
    mustInclude: ["Node.js", "Go", "Rust"],
  },
  {
    name: "ask_rank.labels-surfaced",
    note: "rank items must reach the user as human-readable rows",
    askSet: set(ask("ask_rank", {
      items: [
        { id: "p1", label: "Reduce onboarding friction" },
        { id: "p2", label: "Cut p95 latency" },
        { id: "p3", label: "Ship the audit log" },
      ],
    })),
    mustInclude: ["Reduce onboarding friction", "Cut p95 latency", "Ship the audit log"],
  },
];

// ── Integration: the all-10-types showcase, faithfully rendered everywhere
// A single end-to-end fixture that the showcase AskSet — every v0.1 type
// in one set — validates as a whole AND that every ask reaches the user
// without cross-type drift in EACH of the four render tiers. A renderer
// that quietly skipped (say) ask_color when a slider is also present, or
// emitted ids-only for `ask_rank`, fails this fixture even if every
// single-type test passes. The check is intentionally substring-based
// (same hook style as ELICITATION_RENDER) so any language can adapt it.
//
// The fixture is ONE case → ONE row in the report (78th when the rest
// of the corpus is healthy). A target opts in by providing the
// `renderTiers` hook; without it, integration is skipped silently —
// validateAskSet on the showcase is still part of the askSet group.
export interface IntegrationCase {
  name: string;
  /** The AskSet to validate + render across all 4 tiers. */
  askSet: unknown;
  /** Per-tier substrings that MUST appear in the tier's rendering. The
   *  same labels are expected to surface across tiers (cross-type-drift
   *  guard); the lists are split per-tier in case a tier emits less
   *  context (e.g. tui condenses; the runner unions them in practice). */
  mustIncludePerTier: { apps: string[]; url: string[]; tui: string[]; elicitation: string[] };
  note: string;
}

// The showcase AskSet: every v0.1 type, plus the ask_select display
// variants and the ask_color custom/fixed split, expressed inline so the
// corpus stays a portable single-file moat. Mirrors
// examples/showcase-askset.json (kept in sync; tests assert overlap).
const SHOWCASE_ASKSET = {
  specVersion: "0.1.0",
  meta: { layout: "auto", accent: "#7c3aed" },
  asks: [
    { id: "text_single", type: "ask_text", prompt: "Single-line text", help: "ask_text — auto half-width.", spec: { placeholder: "type here" }, meta: META },
    { id: "text_multi", type: "ask_text", prompt: "Multiline text", help: "ask_text multiline — auto full-width.", required: false, spec: { multiline: true, placeholder: "longer answer…" }, meta: META },
    { id: "sel_list", type: "ask_select", prompt: "Select — list (default)", spec: { options: [{ id: "a", label: "Alpha", description: "first option" }, { id: "b", label: "Bravo" }] }, meta: META },
    { id: "sel_segmented", type: "ask_select", prompt: "Select — segmented", spec: { display: "segmented", options: [{ id: "lo", label: "Low" }, { id: "md", label: "Med" }, { id: "hi", label: "High" }] }, meta: META },
    { id: "sel_cards", type: "ask_select", prompt: "Select — cards with icons", spec: { display: "cards", options: [{ id: "ship", label: "Ship", description: "deploy now", icon: "rocket" }, { id: "hold", label: "Hold", description: "needs review", icon: "clock" }, { id: "block", label: "Block", description: "do not merge", icon: "warning" }] }, meta: META },
    { id: "sel_grid_multi", type: "ask_select", prompt: "Multi-select — grid, with color swatches", spec: { multiple: true, min: 1, display: "grid", options: [{ id: "red", label: "Critical", description: "P0", color: "#dc2626" }, { id: "amber", label: "Warning", description: "P1", color: "#d97706" }, { id: "green", label: "Healthy", description: "P2", color: "#059669" }] }, meta: META },
    { id: "confirm_cards", type: "ask_confirm", prompt: "Confirm — with consequence", spec: { affirm: "Run migration", deny: "Skip", consequence: "Irreversible without a restore." }, meta: META },
    { id: "num", type: "ask_number", prompt: "Number — bounded integer with unit", spec: { min: 1, max: 64, step: 1, integer: true, unit: "vCPU" }, meta: META },
    { id: "rate_stars", type: "ask_rating", prompt: "Rating — stars with labels", spec: { max: 5, icon: "star", labels: { min: "poor", max: "great" } }, meta: META },
    { id: "slider", type: "ask_slider", prompt: "Slider — 0–100 step 5", spec: { min: 0, max: 100, step: 5, unit: "%" }, meta: META },
    { id: "date", type: "ask_date", prompt: "Date", spec: {}, meta: META },
    { id: "rank", type: "ask_rank", prompt: "Rank — reorderable, with descriptions", spec: { items: [{ id: "speed", label: "Ship speed" }, { id: "safety", label: "Safety", description: "rollback / blast radius" }, { id: "polish", label: "UX polish" }] }, meta: META },
    { id: "color_fixed", type: "ask_color", prompt: "Color — fixed palette only", spec: { palette: ["#1d4ed8", "#059669", "#d97706"] }, meta: META },
    { id: "diff", type: "ask_code_diff", prompt: "Code diff — multi-file, per-hunk accept/reject", help: "ask_code_diff — always full-width; the v0.1 wedge.", spec: { granularity: "hunk", files: [{ path: "src/auth.ts", hunks: [{ id: "h1", header: "@@ tighten check @@", before: "if (user) {\n  return allow();\n}", after: "if (user && user.active) {\n  return allow();\n}" }] }] }, meta: META },
  ],
} as const;

/** Public re-export so adopters can drive the same showcase through their
 *  own renderTiers implementation without duplicating the fixture. */
export const SHOWCASE = SHOWCASE_ASKSET;

export const INTEGRATION: IntegrationCase[] = [
  {
    name: "showcase.all-10-types.no-cross-type-drift",
    askSet: SHOWCASE_ASKSET,
    note: "all 10 v0.1 types in one AskSet must validate AND each ask's labels/markers must reach every tier — no type silently dropped or rendered as another",
    mustIncludePerTier: {
      // apps/url emit the panel HTML (same buildPanelHtml under the hood);
      // panel embeds the ask JSON, so type tokens AND option labels both
      // surface in the serialized HTML.
      apps: [
        "ask_text", "ask_select", "ask_confirm", "ask_code_diff", "ask_number",
        "ask_rating", "ask_slider", "ask_date", "ask_rank", "ask_color",
        "Alpha", "Critical", "Ship speed", "#1d4ed8",
      ],
      url: [
        "ask_text", "ask_select", "ask_confirm", "ask_code_diff", "ask_number",
        "ask_rating", "ask_slider", "ask_date", "ask_rank", "ask_color",
        "Alpha", "Critical", "Ship speed", "#1d4ed8",
      ],
      // tui prints `(ask_*)` per row plus enumerated option labels.
      tui: [
        "ask_text", "ask_select", "ask_confirm", "ask_code_diff", "ask_number",
        "ask_rating", "ask_slider", "ask_date", "ask_rank", "ask_color",
        "Alpha", "Critical", "Ship speed",
      ],
      // elicitation is per-ask; the runner concatenates each ask's
      // schema+message into one blob, so type-specific tokens (titled
      // oneOf labels, hunk ids, ask_confirm consequence text, color
      // palette entries, ask_number unit) all land in the union. The
      // ask_confirm primitive is boolean-only — affirm/deny labels do
      // not reach the schema — so we match on the consequence text
      // instead, which IS folded into the message body.
      elicitation: [
        "Alpha", "Critical", "Ship speed",       // labelled enum branches
        "Irreversible without a restore.",       // ask_confirm consequence
        "vCPU",                                  // ask_number unit
        "#1d4ed8",                               // ask_color palette
        "h1",                                    // ask_code_diff hunk id
      ],
    },
  },
];

// ── Non-blocking elicit contract: per-tier pending-shape fixtures ─────
// As of the timeout-fix plan EVERY tool call is non-blocking. The
// `elicit` tool returns a "pending" envelope so the per-call MCP timeout
// is never the gating factor:
//
//   tui          → { pending:true, token, tier, asks }          (immediate)
//   elicitation  → { pending:true, token, tier, completed:1, total:N }
//                  after issuing ONE native elicitInput inline
//   url          → { pending:true, token, tier, panelUrl }      (immediate)
//   apps         → { pending:true, token, tier, panelUri }      (immediate)
//
// An adopter advertises the contract by surfacing those shape tokens in
// each tier's rendering blob. The runner serialises the rendering and
// substring-matches against `mustInclude`. A bare token like
// `"pending":true` is matched as text — adopters in non-JSON languages
// emit an equivalent textual marker.
export interface PendingShapeCase {
  name: string;
  /** Per-tier substrings the rendering MUST surface. */
  mustIncludePerTier: { tui?: string[]; elicitation?: string[]; url?: string[]; apps?: string[] };
  /** The AskSet to render; same across tiers so the only var is the tier. */
  askSet: unknown;
  note: string;
}

const PENDING_SHAPE_ASKSET = set(ask("ask_confirm", {}));

export const ELICIT_PENDING_SHAPE: PendingShapeCase[] = [
  {
    name: "pending-shape.tui",
    askSet: PENDING_SHAPE_ASKSET,
    note: "tui returns the panel reference + token immediately (pending:true)",
    mustIncludePerTier: {
      tui: ["pending", "token", "tui"],
    },
  },
  {
    name: "pending-shape.elicitation",
    askSet: PENDING_SHAPE_ASKSET,
    note: "elicitation returns pending + a completed/total counter so the agent calls elicit_next per ask",
    mustIncludePerTier: {
      elicitation: ["pending", "token", "elicitation"],
    },
  },
  {
    name: "pending-shape.url",
    askSet: PENDING_SHAPE_ASKSET,
    note: "url returns the panel reference + token immediately (pending:true)",
    mustIncludePerTier: {
      url: ["pending", "token", "url"],
    },
  },
];

// ── Slow-ask auto-router: AskSets that MUST route AWAY from elicitation
// The server drops `elicitation` from candidates when an ask is
// likely-slow on the per-prompt elicitation primitive: multiline /
// unbounded ask_text, ask_code_diff with > 2 hunks, ask_rank with > 4
// items. The route decision lands in `_meta.elicitkit.
// routedAwayFromElicitation: true` with a `routeReason` tag — the
// runner substring-matches both to verify the rule that fired.
export interface SlowAskRoutingCase {
  name: string;
  askSet: unknown;
  /** Substrings that MUST appear in the route-decision blob. */
  mustInclude: string[];
  /** Substrings that MUST NOT appear (e.g. `"elicitation"` in chosen tier). */
  mustExclude: string[];
  note: string;
}

export const SLOW_ASK_ROUTING: SlowAskRoutingCase[] = [
  {
    name: "slow-ask-routing.text-multiline",
    askSet: set(ask("ask_text", { multiline: true })),
    note: "a multiline ask_text takes too long for a per-prompt elicitation; route to a panel tier",
    mustInclude: ["routedAwayFromElicitation", "true", "ask_text"],
    mustExclude: ['"renderedTier":"elicitation"', '"chosen":"elicitation"'],
  },
  {
    name: "slow-ask-routing.code-diff-many-hunks",
    askSet: set(ask("ask_code_diff", {
      granularity: "hunk",
      files: [{ path: "src/a.ts", hunks: [
        { id: "h1", after: "x=1" },
        { id: "h2", after: "y=2" },
        { id: "h3", after: "z=3" },
      ] }],
    })),
    note: "ask_code_diff with > 2 hunks is too long for per-prompt elicitation",
    mustInclude: ["routedAwayFromElicitation", "true", "ask_code_diff"],
    mustExclude: ['"renderedTier":"elicitation"', '"chosen":"elicitation"'],
  },
  {
    name: "slow-ask-routing.rank-many-items",
    askSet: set(ask("ask_rank", {
      items: [
        { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
        { id: "d", label: "D" }, { id: "e", label: "E" },
      ],
    })),
    note: "ask_rank with > 4 items is too long for per-prompt elicitation",
    mustInclude: ["routedAwayFromElicitation", "true", "ask_rank"],
    mustExclude: ['"renderedTier":"elicitation"', '"chosen":"elicitation"'],
  },
];

// ── Semantic cases for validateAnswers (required / declined / deferred) ─
export interface SemanticCase {
  name: string;
  askSet: unknown;
  answers: unknown;
  shouldPass: boolean;
  note: string;
}
export const SEMANTIC: SemanticCase[] = [
  {
    name: "required-missing-fails",
    askSet: set(ask("ask_text", {})),
    answers: [],
    shouldPass: false,
    note: "a required ask with no answer must fail (no silent skip)",
  },
  {
    name: "required-declined-ok",
    askSet: set(ask("ask_text", {})),
    answers: [{ id: "ask_text", type: "ask_text", status: "declined" }],
    shouldPass: true,
    note: "declined is first-class even for a required ask (SPEC §5)",
  },
  {
    name: "required-deferred-fails",
    askSet: set(ask("ask_text", {})),
    answers: [{ id: "ask_text", type: "ask_text", status: "deferred" }],
    shouldPass: false,
    note: "a required ask cannot be deferred",
  },
  {
    name: "optional-missing-ok",
    askSet: set(ask("ask_text", {}, { required: false })),
    answers: [],
    shouldPass: true,
    note: "an optional ask may be omitted",
  },
  {
    name: "answer-type-mismatch-fails",
    askSet: set(ask("ask_confirm", {})),
    answers: [{ id: "ask_confirm", type: "ask_text", status: "answered", value: "x" }],
    shouldPass: false,
    note: "answer.type must match the ask",
  },
];

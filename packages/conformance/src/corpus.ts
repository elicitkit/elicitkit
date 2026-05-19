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

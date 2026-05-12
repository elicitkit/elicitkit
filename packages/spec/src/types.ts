/**
 * Elicitkit canonical TypeScript types — v0.1.
 * Mirrors SPEC.md and schema/elicitkit-v0.1.schema.json. The spec is the product.
 */

export type Tier = "apps" | "url" | "elicitation" | "tui";

export interface AskMeta {
  specVersion: string;
  /** lowest render tier that is still faithful */
  minTier?: Tier;
  /** layout override for this ask; otherwise an auto heuristic decides */
  span?: "half" | "full";
  [k: string]: unknown;
}

export interface AskBase {
  id: string;
  prompt: string;
  help?: string;
  /** default true */
  required?: boolean;

  // ── Reserved hooks: inert in v0.1, populated in a later MINOR ──
  /** the agent's proposed answer */
  agentGuess?: unknown;
  /** 0–1; enables confidence-gated auto-accept */
  confidence?: number;
  /** stable key for answer-memory / auto-skip */
  memoryKey?: string;

  meta?: AskMeta;
}

export interface AskText extends AskBase {
  type: "ask_text";
  spec: { multiline?: boolean; placeholder?: string; pattern?: string; maxLen?: number };
}

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
  /** Optional adornment — a curated icon name (renderer-defined set) or a
   *  raw character/emoji. Unknown names degrade to text. */
  icon?: string;
  /** Optional swatch color (any CSS color) shown beside the option. */
  color?: string;
}

/** Presentation hint for `ask_select`. Renderers MAY honour it; all MUST
 *  remain correct if they ignore it (forward-compatible). */
export type SelectDisplay = "list" | "cards" | "segmented" | "grid";

export interface AskSelect extends AskBase {
  type: "ask_select";
  spec: {
    options: SelectOption[];
    multiple?: boolean;
    min?: number;
    max?: number;
    display?: SelectDisplay;
  };
}

export interface AskConfirm extends AskBase {
  type: "ask_confirm";
  spec: { affirm?: string; deny?: string; consequence?: string };
}

export interface DiffHunk {
  id: string;
  header?: string;
  before?: string;
  after: string;
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

/** The v0.1 wedge. */
export interface AskCodeDiff extends AskBase {
  type: "ask_code_diff";
  spec: { files: DiffFile[]; granularity?: "hunk" };
}

/** Numeric input. value: number. */
export interface AskNumber extends AskBase {
  type: "ask_number";
  spec: { min?: number; max?: number; step?: number; unit?: string; integer?: boolean };
}

/** 1..max rating. value: integer in [1, max]. */
export interface AskRating extends AskBase {
  type: "ask_rating";
  spec: { max?: number; icon?: "star" | "number"; labels?: { min?: string; max?: string } };
}

/** Bounded range. value: number in [min, max]. */
export interface AskSlider extends AskBase {
  type: "ask_slider";
  spec: { min: number; max: number; step?: number; unit?: string };
}

/** Date, optionally with time. value: "YYYY-MM-DD" (or RFC3339 if time). */
export interface AskDate extends AskBase {
  type: "ask_date";
  spec: { min?: string; max?: string; time?: boolean };
}

export interface RankItem {
  id: string;
  label: string;
  description?: string;
}

/** Order a fixed set. value: string[] — a permutation of the item ids. */
export interface AskRank extends AskBase {
  type: "ask_rank";
  spec: { items: RankItem[] };
}

/** Pick a color. value: a CSS color string (e.g. "#1d4ed8"). When a
 *  `palette` is given and `allowCustom` is not true, the value MUST be one
 *  of the palette entries. */
export interface AskColor extends AskBase {
  type: "ask_color";
  spec: { palette?: string[]; allowCustom?: boolean };
}

export type Ask =
  | AskText
  | AskSelect
  | AskConfirm
  | AskCodeDiff
  | AskNumber
  | AskRating
  | AskSlider
  | AskDate
  | AskRank
  | AskColor;

export interface AskSet {
  specVersion: string;
  asks: Ask[];
  /** RESERVED v0.1: conditional branching */
  edges?: unknown[];
  /** Optional, renderer-advisory. `layout`: "auto" (default) lets the
   *  renderer decide single/multi-column per ask; "single" forces one
   *  column; "grid" prefers pairing. Ignorable by any renderer. */
  meta?: {
    layout?: "auto" | "single" | "grid";
    /** skin: "system" (default) | "midnight" | "paper" | "high-contrast" */
    theme?: "system" | "midnight" | "paper" | "high-contrast";
    /** any CSS color — overrides the accent in any theme */
    accent?: string;
    [k: string]: unknown;
  };
}

export type AnswerStatus = "answered" | "declined" | "deferred";

export interface Answer {
  id: string;
  type: string;
  status: AnswerStatus;
  value?: unknown;
  meta?: { tier?: Tier; specVersion?: string };
}

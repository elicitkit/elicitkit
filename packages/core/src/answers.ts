import { validateAnswer } from "./validate.js";
import type {
  Answer,
  Ask,
  AskSet,
  AskSelect,
  AskNumber,
  AskRating,
  AskSlider,
  AskDate,
  AskRank,
  AskColor,
} from "@elicitkit/spec";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Per-type `value` shape check (SPEC.md §7). The JSON Schema leaves `value`
 * open by design; enforcing the type contract is the engine's job. Pure —
 * no state, no token. Both the MCP server and the HTTP surface use this so
 * answer validation is identical across surfaces.
 */
export function valueError(ask: Ask, value: unknown): string | null {
  switch (ask.type) {
    case "ask_text":
      return typeof value === "string" ? null : "value must be a string";
    case "ask_confirm":
      return typeof value === "boolean" ? null : "value must be a boolean";
    case "ask_select": {
      const ids = new Set((ask as AskSelect).spec.options.map((o) => o.id));
      const multiple = (ask as AskSelect).spec.multiple === true;
      if (multiple) {
        if (!Array.isArray(value)) return "value must be an array of option ids";
        for (const v of value) {
          if (typeof v !== "string" || !ids.has(v)) return `unknown option id: ${String(v)}`;
        }
        return null;
      }
      if (typeof value !== "string" || !ids.has(value)) {
        return `value must be one option id: ${String(value)}`;
      }
      return null;
    }
    case "ask_code_diff": {
      if (typeof value !== "object" || value === null) {
        return "value must be { accepted: string[], rejected: string[] }";
      }
      const v = value as { accepted?: unknown; rejected?: unknown };
      const arr = (x: unknown) =>
        Array.isArray(x) && x.every((e) => typeof e === "string");
      if (!arr(v.accepted) || !arr(v.rejected)) {
        return "accepted and rejected must each be string[] of hunk ids";
      }
      return null;
    }
    case "ask_number":
    case "ask_slider": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "value must be a finite number";
      }
      const s = (ask as AskNumber | AskSlider).spec as {
        min?: number; max?: number; integer?: boolean;
      };
      if ((ask as AskNumber).spec && (ask as AskNumber).spec.integer && !Number.isInteger(value)) {
        return "value must be an integer";
      }
      if (typeof s.min === "number" && value < s.min) return `value must be ≥ ${s.min}`;
      if (typeof s.max === "number" && value > s.max) return `value must be ≤ ${s.max}`;
      return null;
    }
    case "ask_rating": {
      const max = (ask as AskRating).spec.max ?? 5;
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
        return `value must be an integer in [1, ${max}]`;
      }
      return null;
    }
    case "ask_date": {
      if (typeof value !== "string") return "value must be a date string";
      const time = (ask as AskDate).spec.time === true;
      if (time ? !DATETIME_RE.test(value) : !DATE_RE.test(value)) {
        return time
          ? "value must be an RFC3339 date-time"
          : 'value must be a "YYYY-MM-DD" date';
      }
      return Number.isNaN(Date.parse(value)) ? "value is not a real date" : null;
    }
    case "ask_rank": {
      const ids = (ask as AskRank).spec.items.map((i) => i.id);
      if (!Array.isArray(value) || value.length !== ids.length) {
        return `value must be all ${ids.length} item ids in ranked order`;
      }
      const seen = new Set<string>();
      for (const v of value) {
        if (typeof v !== "string" || !ids.includes(v) || seen.has(v)) {
          return "value must be a permutation of the item ids (no dupes)";
        }
        seen.add(v);
      }
      return null;
    }
    case "ask_color": {
      if (typeof value !== "string" || value.trim() === "") {
        return "value must be a CSS color string";
      }
      const s = (ask as AskColor).spec ?? {};
      if (s.palette && s.palette.length > 0 && s.allowCustom !== true) {
        return s.palette.includes(value)
          ? null
          : `value must be one of the palette colors`;
      }
      return null;
    }
    default:
      // Unknown (future minor) type: trust the envelope, don't hard-fail.
      return null;
  }
}

export interface AnswersResult {
  ok: boolean;
  /** Normalised answers, one per validated ask, in ask order. */
  answers: Answer[];
  errors: string[];
}

/**
 * Validate a batch of raw answers against an AskSet. Enforces: envelope
 * schema (§5), id/type match the ask, per-type value shape (§7), and
 * `required` honoured — no silent skips, and a required ask may be
 * `declined` (first-class) but not `deferred`. Pure and stateless.
 */
export function validateAnswers(set: AskSet, raw: unknown): AnswersResult {
  if (!Array.isArray(raw)) {
    return { ok: false, answers: [], errors: ["answers must be an array"] };
  }

  const byId = new Map<string, unknown>();
  for (const a of raw) {
    if (a && typeof a === "object" && typeof (a as Answer).id === "string") {
      byId.set((a as Answer).id, a);
    }
  }

  const errors: string[] = [];
  const answers: Answer[] = [];

  for (const ask of set.asks) {
    const candidate = byId.get(ask.id);
    const required = ask.required !== false;

    if (candidate === undefined) {
      if (required) errors.push(`${ask.id}: missing answer for required ask`);
      continue;
    }

    const env = validateAnswer(candidate);
    if (!env.ok) {
      errors.push(`${ask.id}: ${env.errors.join("; ")}`);
      continue;
    }

    const ans = candidate as Answer;
    if (ans.type !== ask.type) {
      errors.push(`${ask.id}: answer type "${ans.type}" != ask type "${ask.type}"`);
      continue;
    }

    if (ans.status === "answered") {
      const ve = valueError(ask, ans.value);
      if (ve) {
        errors.push(`${ask.id}: ${ve}`);
        continue;
      }
    } else if (required && ans.status === "deferred") {
      errors.push(`${ask.id}: required ask cannot be deferred`);
      continue;
    }

    answers.push(ans);
  }

  return { ok: errors.length === 0, answers, errors };
}

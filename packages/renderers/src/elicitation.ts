import type { Answer, Ask, AskSet, AskSelect } from "@elicitkit/core";
import type {
  ElicitFn,
  ElicitParams,
  ElicitResult,
} from "./contract.js";

/**
 * `elicitation` tier — no custom UI; drive the host's *native* MCP
 * elicitation primitive (form mode). Unlike the panel tiers this resolves
 * inline against the host's elicitInput; the server is responsible for
 * driving each step from `elicit` / `elicit_next`. Each Ask maps to one
 * or more elicitInputs (`ask_code_diff` issues one confirm per hunk per
 * SPEC §7.4); the bound is "one elicitInput per tool call" so the
 * per-call MCP timeout is never the gating factor.
 *
 * action → status:  accept → answered · decline → declined · cancel → deferred
 */

/**
 * Compile an Ask into the *sequence* of elicitInputs needed to fully
 * elicit it on the elicitation tier. The list is almost always length-1;
 * `ask_code_diff` is the v0.1 exception (one confirm per hunk so the
 * user reviews each change separately — SPEC §7.4).
 */
export function compileAskToInputs(ask: Ask): ElicitParams[] {
  switch (ask.type) {
    case "ask_text":
      return [
        {
          message: msg(ask),
          requestedSchema: {
            type: "object",
            properties: {
              value: {
                type: "string",
                title: ask.prompt,
                ...(ask.spec.maxLen ? { maxLength: ask.spec.maxLen } : {}),
              },
            },
            required: ["value"],
          },
        },
      ];

    case "ask_confirm":
      return [
        {
          message: ask.spec.consequence
            ? `${msg(ask)}\n\n${ask.spec.consequence}`
            : msg(ask),
          requestedSchema: {
            type: "object",
            properties: {
              value: { type: "boolean", title: ask.prompt },
            },
            required: ["value"],
          },
        },
      ];

    case "ask_select": {
      const s = (ask as AskSelect).spec;
      const branches = s.options.map((o) => ({ const: o.id, title: o.label }));
      const ids = s.options.map((o) => o.id);
      const descLines = s.options
        .filter((o) => !!o.description)
        .map((o) => `- ${o.label}: ${o.description}`);
      const message =
        descLines.length > 0
          ? `${msg(ask)}\n\n${descLines.join("\n")}`
          : msg(ask);
      return [
        {
          message,
          requestedSchema: {
            type: "object",
            properties: {
              value: s.multiple
                ? {
                    type: "array",
                    title: ask.prompt,
                    items: { anyOf: branches },
                    ...(s.min ? { minItems: s.min } : {}),
                    ...(s.max ? { maxItems: s.max } : {}),
                  }
                : {
                    type: "string",
                    title: ask.prompt,
                    oneOf: branches,
                    default: ids[0],
                  },
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_code_diff": {
      // One confirm per hunk, sequential (SPEC §7.4).
      const inputs: ElicitParams[] = [];
      for (const file of ask.spec.files) {
        for (const h of file.hunks) {
          inputs.push({
            message:
              `${ask.prompt}\n\n${file.path}` +
              (h.header ? ` — ${h.header}` : ` — hunk ${h.id}`) +
              `\n\n${h.after}`,
            requestedSchema: {
              type: "object",
              properties: {
                accept: {
                  type: "boolean",
                  title: `Accept this hunk (${h.id})?`,
                  default: true,
                },
              },
              required: ["accept"],
            },
          });
        }
      }
      return inputs;
    }

    case "ask_number": {
      const s = ask.spec ?? {};
      return [
        {
          message: msg(ask) + (s.unit ? `\n\n(unit: ${s.unit})` : ""),
          requestedSchema: {
            type: "object",
            properties: {
              value: {
                type: s.integer ? "integer" : "number",
                title: ask.prompt,
                ...(typeof s.min === "number" ? { minimum: s.min } : {}),
                ...(typeof s.max === "number" ? { maximum: s.max } : {}),
              } as never,
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_slider": {
      const s = ask.spec;
      return [
        {
          message:
            msg(ask) + `\n\n(${s.min}–${s.max}${s.unit ? " " + s.unit : ""})`,
          requestedSchema: {
            type: "object",
            properties: {
              value: { type: "number", title: ask.prompt, minimum: s.min, maximum: s.max } as never,
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_rating": {
      const max = ask.spec?.max ?? 5;
      return [
        {
          message: msg(ask) + `\n\n(1 = lowest, ${max} = highest)`,
          requestedSchema: {
            type: "object",
            properties: {
              value: { type: "integer", title: ask.prompt, minimum: 1, maximum: max } as never,
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_date": {
      return [
        {
          message: msg(ask),
          requestedSchema: {
            type: "object",
            properties: {
              value: {
                type: "string",
                title: ask.prompt,
                format: ask.spec?.time ? "date-time" : "date",
              } as never,
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_rank": {
      const items = ask.spec.items;
      const branches = items.map((i) => ({ const: i.id, title: i.label }));
      return [
        {
          message:
            `${msg(ask)}\n\nRank by listing every option in order, best first:\n` +
            items.map((i) => `- ${i.id}: ${i.label}`).join("\n"),
          requestedSchema: {
            type: "object",
            properties: {
              value: {
                type: "array",
                title: ask.prompt,
                items: { anyOf: branches },
                minItems: items.length,
                maxItems: items.length,
              },
            },
            required: ["value"],
          },
        },
      ];
    }

    case "ask_color": {
      const pal = ask.spec?.palette ?? [];
      const fixed = pal.length > 0 && ask.spec?.allowCustom !== true;
      const branches = pal.map((c) => ({ const: c, title: c }));
      return [
        {
          message: fixed
            ? msg(ask)
            : `${msg(ask)}\n\nEnter a CSS color (e.g. #1d4ed8)` +
              (pal.length ? `\nSuggested: ${pal.join(", ")}` : ""),
          requestedSchema: {
            type: "object",
            properties: {
              value: fixed
                ? { type: "string", title: ask.prompt, oneOf: branches }
                : { type: "string", title: ask.prompt },
            },
            required: ["value"],
          },
        },
      ];
    }

    default: {
      const a = ask as Ask;
      return [
        {
          message: msg(a),
          requestedSchema: {
            type: "object",
            properties: { value: { type: "string", title: a.prompt } },
            required: ["value"],
          },
        },
      ];
    }
  }
}

/**
 * Assemble an Answer from the collected ElicitResults for a single Ask.
 * `responses.length === compileAskToInputs(ask).length`. For asks with a
 * single elicitInput this is a one-shot decode; `ask_code_diff` folds N
 * per-hunk confirms into one `{ accepted, rejected }` value.
 *
 * The decline-on-first-non-accept rule (SPEC §7.4) is implemented here:
 * the server passes through every collected response, including the
 * non-accepts, and the decoder turns the first non-accept into the
 * ask's final status.
 */
export function decodeAskAnswer(ask: Ask, responses: ElicitResult[]): Answer {
  // Common short-circuit: a non-accept on the first elicitInput is the
  // ask's outcome for everything except ask_code_diff (which we handle
  // hunk-by-hunk below).
  if (ask.type !== "ask_code_diff") {
    const r = responses[0];
    if (!r) return answer(ask, "deferred");
    return answer(ask, statusFor(r.action), readValue(ask, r));
  }

  // ask_code_diff: one confirm per hunk. A non-accept on any hunk ends
  // the ask with that hunk's outcome; previously-decided hunks are kept.
  const accepted: string[] = [];
  const rejected: string[] = [];
  let i = 0;
  for (const file of ask.spec.files) {
    for (const h of file.hunks) {
      const r = responses[i++];
      if (!r) return answer(ask, "deferred", { accepted, rejected });
      if (r.action !== "accept") {
        return answer(ask, statusFor(r.action));
      }
      (r.content?.accept === false ? rejected : accepted).push(h.id);
    }
  }
  return answer(ask, "answered", { accepted, rejected });
}

/** How many elicitInputs an ask compiles to on the elicitation tier. */
export function askInputCount(ask: Ask): number {
  if (ask.type === "ask_code_diff") {
    return ask.spec.files.reduce((n, f) => n + (f.hunks?.length ?? 0), 0);
  }
  return 1;
}

/**
 * The legacy whole-set runner — kept as a thin wrapper over the new
 * per-ask compile + decode primitives, used by tests and adapters that
 * want a one-call "drive the elicitation tier end-to-end" path.
 */
export async function runElicitation(
  set: AskSet,
  elicit: ElicitFn,
): Promise<Answer[]> {
  const out: Answer[] = [];
  for (const ask of set.asks) {
    const inputs = compileAskToInputs(ask);
    const responses: ElicitResult[] = [];
    for (const params of inputs) {
      const r = await elicit(params);
      responses.push(r);
      // Mirror the per-hunk early-exit for ask_code_diff: stop on the
      // first non-accept so we don't keep asking after the user
      // declines (SPEC §7.4). For other asks there's only one input
      // anyway, so the early-exit is a no-op.
      if (r.action !== "accept" && ask.type === "ask_code_diff") break;
    }
    out.push(decodeAskAnswer(ask, responses));
  }
  return out;
}

function statusFor(action: ElicitResult["action"]): Answer["status"] {
  return action === "accept"
    ? "answered"
    : action === "decline"
      ? "declined"
      : "deferred";
}

function msg(ask: Ask): string {
  return ask.help ? `${ask.prompt}\n\n${ask.help}` : ask.prompt;
}

function answer(ask: Ask, status: Answer["status"], value?: unknown): Answer {
  return {
    id: ask.id,
    type: ask.type,
    status,
    ...(status === "answered" ? { value } : {}),
    meta: { tier: "elicitation", specVersion: ask.meta?.specVersion },
  };
}

/** Read the `value` (or `accept`, for ask_code_diff) field from the
 *  elicitInput response, normalising ask_rank's degraded
 *  comma-separated-string fallback into the canonical id[] permutation. */
function readValue(ask: Ask, r: ElicitResult): unknown {
  if (ask.type === "ask_rank") {
    const raw = r.content?.value;
    return Array.isArray(raw)
      ? raw.map((x) => String(x))
      : String(raw ?? "")
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter(Boolean);
  }
  return r.content?.value;
}

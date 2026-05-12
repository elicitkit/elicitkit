import type { Answer, Ask, AskSet, AskSelect } from "@elicitkit/core";
import type { ElicitFn, ElicitResult } from "./contract.js";

/**
 * `elicitation` tier — no custom UI; drive the host's *native* MCP
 * elicitation primitive (form mode). Unlike the panel tiers this resolves
 * inline: it asks, the host prompts the user, answers come straight back —
 * there is no `elicit_submit` round-trip. Each Ask maps to the narrowest
 * faithful form schema; `ask_code_diff` becomes one confirm per hunk
 * (SPEC §7.4: "elicitation = one ask_confirm per hunk").
 *
 * action → status:  accept → answered · decline → declined · cancel → deferred
 */
export async function runElicitation(
  set: AskSet,
  elicit: ElicitFn,
): Promise<Answer[]> {
  const out: Answer[] = [];
  for (const ask of set.asks) {
    out.push(await one(ask, elicit));
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

async function one(ask: Ask, elicit: ElicitFn): Promise<Answer> {
  switch (ask.type) {
    case "ask_text": {
      const r = await elicit({
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
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_confirm": {
      const r = await elicit({
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
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_select": {
      const s = (ask as AskSelect).spec;
      const ids = s.options.map((o) => o.id);
      const names = s.options.map((o) => o.label);
      const r = await elicit({
        message: msg(ask),
        requestedSchema: {
          type: "object",
          properties: {
            value: s.multiple
              ? {
                  type: "array",
                  title: ask.prompt,
                  items: { type: "string", enum: ids },
                  ...(s.min ? { minItems: s.min } : {}),
                  ...(s.max ? { maxItems: s.max } : {}),
                }
              : {
                  type: "string",
                  title: ask.prompt,
                  enum: ids,
                  enumNames: names,
                  // Pre-select the first option so the native elicitation
                  // form always carries a valid value — hitting submit
                  // without touching the field no longer fails `required`.
                  default: ids[0],
                },
          },
          required: ["value"],
        },
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_code_diff": {
      // One confirm per hunk, sequential (SPEC §7.4). A non-accept on any
      // hunk ends the ask with that hunk's outcome; decided hunks are kept.
      const accepted: string[] = [];
      const rejected: string[] = [];
      for (const file of ask.spec.files) {
        for (const h of file.hunks) {
          const r = await elicit({
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
          if (r.action !== "accept") {
            return answer(ask, statusFor(r.action));
          }
          (r.content?.accept === false ? rejected : accepted).push(h.id);
        }
      }
      return answer(ask, "answered", { accepted, rejected });
    }

    case "ask_number": {
      const s = ask.spec ?? {};
      const r = await elicit({
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
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_slider": {
      const s = ask.spec;
      const r = await elicit({
        message: msg(ask) + `\n\n(${s.min}–${s.max}${s.unit ? " " + s.unit : ""})`,
        requestedSchema: {
          type: "object",
          properties: {
            value: { type: "number", title: ask.prompt, minimum: s.min, maximum: s.max } as never,
          },
          required: ["value"],
        },
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_rating": {
      const max = ask.spec?.max ?? 5;
      const r = await elicit({
        message: msg(ask) + `\n\n(1 = lowest, ${max} = highest)`,
        requestedSchema: {
          type: "object",
          properties: {
            value: { type: "integer", title: ask.prompt, minimum: 1, maximum: max } as never,
          },
          required: ["value"],
        },
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_date": {
      const r = await elicit({
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
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    case "ask_rank": {
      // No reorder UI in native elicitation (SPEC §7.9 degradation): collect
      // the ids as an ordered comma list, then normalise to the array shape.
      const items = ask.spec.items;
      const r = await elicit({
        message:
          `${msg(ask)}\n\nRank by entering all ids, best first, comma-separated:\n` +
          items.map((i) => `- ${i.id}: ${i.label}`).join("\n"),
        requestedSchema: {
          type: "object",
          properties: {
            value: { type: "string", title: `e.g. ${items.map((i) => i.id).join(",")}` },
          },
          required: ["value"],
        },
      });
      if (r.action !== "accept") return answer(ask, statusFor(r.action));
      const ordered = String(r.content?.value ?? "")
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      return answer(ask, "answered", ordered);
    }

    case "ask_color": {
      const pal = ask.spec?.palette ?? [];
      const fixed = pal.length > 0 && ask.spec?.allowCustom !== true;
      const r = await elicit({
        message: fixed
          ? msg(ask)
          : `${msg(ask)}\n\nEnter a CSS color (e.g. #1d4ed8)` +
            (pal.length ? `\nSuggested: ${pal.join(", ")}` : ""),
        requestedSchema: {
          type: "object",
          properties: {
            value: fixed
              ? { type: "string", title: ask.prompt, enum: pal }
              : { type: "string", title: ask.prompt },
          },
          required: ["value"],
        },
      });
      return answer(ask, statusFor(r.action), r.content?.value);
    }

    default: {
      // Unknown future (post-v0.1) type: free-text degradation. Unreachable
      // under the v0.1 union, so `ask` narrows to `never` — re-widen it.
      const a = ask as Ask;
      const r = await elicit({
        message: msg(a),
        requestedSchema: {
          type: "object",
          properties: { value: { type: "string", title: a.prompt } },
          required: ["value"],
        },
      });
      return answer(a, statusFor(r.action), r.content?.value);
    }
  }
}

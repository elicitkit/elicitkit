import type { Ask, AskSet } from "@elicitkit/core";
import type { RenderedPanel } from "./contract.js";

/**
 * `tui` tier — the universal sink the spec guarantees for every type
 * (SPEC §4/§7). When no UI surface exists the agent reads this back and
 * collects answers in conversation, then calls `elicit_submit`. Never
 * hard-fails; this is why every type must define a text degradation.
 */
export function renderTui(set: AskSet, token: string): RenderedPanel {
  const lines: string[] = [
    "Elicitkit needs input. Answer each item, then call",
    `elicit_submit with token "${token}" and an answers array.`,
    "",
  ];

  set.asks.forEach((ask, i) => {
    lines.push(`[${i + 1}] (${ask.type}) ${ask.prompt}`);
    if (ask.help) lines.push(`    ${ask.help}`);
    lines.push(...detail(ask).map((l) => `    ${l}`));
    lines.push(
      `    -> answer: { "id": "${ask.id}", "type": "${ask.type}", "status": "answered", "value": ... }`,
    );
    lines.push("");
  });

  return { tier: "tui", text: lines.join("\n") };
}

function detail(ask: Ask): string[] {
  switch (ask.type) {
    case "ask_text":
      return [`free text${ask.spec.multiline ? " (multiline)" : ""}`];
    case "ask_confirm":
      return [
        `${ask.spec.affirm ?? "Yes"} / ${ask.spec.deny ?? "No"}` +
          (ask.spec.consequence ? ` - consequence: ${ask.spec.consequence}` : ""),
        `value: boolean`,
      ];
    case "ask_select":
      return [
        ...ask.spec.options.map(
          (o) => `- ${o.id}: ${o.label}${o.description ? ` - ${o.description}` : ""}`,
        ),
        `value: ${ask.spec.multiple ? "string[] of ids" : "one id"}`,
      ];
    case "ask_code_diff":
      return [
        ...ask.spec.files.flatMap((f) => [
          `file ${f.path}`,
          ...f.hunks.map((h) => `  hunk ${h.id}${h.header ? `: ${h.header}` : ""}`),
        ]),
        `value: { "accepted": [hunkId...], "rejected": [hunkId...] }`,
      ];
    case "ask_number": {
      const s = ask.spec ?? {};
      const r = [
        s.min != null ? `min ${s.min}` : null,
        s.max != null ? `max ${s.max}` : null,
        s.step != null ? `step ${s.step}` : null,
        s.unit ? `unit ${s.unit}` : null,
        s.integer ? "integer" : null,
      ].filter(Boolean);
      return [`number${r.length ? ` (${r.join(", ")})` : ""}`, `value: number`];
    }
    case "ask_slider":
      return [
        `slider ${ask.spec.min}..${ask.spec.max}${ask.spec.step ? ` step ${ask.spec.step}` : ""}${ask.spec.unit ? ` ${ask.spec.unit}` : ""}`,
        `value: number in [${ask.spec.min}, ${ask.spec.max}]`,
      ];
    case "ask_rating": {
      const max = ask.spec?.max ?? 5;
      return [`rate 1..${max}`, `value: integer in [1, ${max}]`];
    }
    case "ask_date":
      return [
        ask.spec?.time ? "date + time" : "date",
        `value: "${ask.spec?.time ? "YYYY-MM-DDTHH:MM" : "YYYY-MM-DD"}"`,
      ];
    case "ask_rank":
      return [
        ...ask.spec.items.map((i) => `- ${i.id}: ${i.label}`),
        `value: [${ask.spec.items.map((i) => `"${i.id}"`).join(", ")}] in ranked order`,
      ];
    case "ask_color": {
      const pal = ask.spec?.palette ?? [];
      return [
        pal.length
          ? `palette: ${pal.join(", ")}${ask.spec?.allowCustom ? " (or a custom color)" : ""}`
          : "any CSS color",
        `value: a CSS color string (e.g. "#1d4ed8")`,
      ];
    }
    default:
      return [];
  }
}

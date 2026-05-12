import * as readline from "node:readline";
import { validateAskSet, validateAnswers, type Answer, type Ask, type AskSet } from "@elicitkit/core";

/** stdout stays pure JSON (pipe-friendly); prompts/log go to stderr. */
function err(line = ""): void {
  process.stderr.write(line + "\n");
}

export interface RunAskResult {
  answers: Answer[];
  ok: boolean;
  errors: string[];
}

/**
 * The CLI is a faithful `tui`-tier surface: it walks the AskSet in the
 * terminal and emits a validated Answer[]. This is the "shell-out reach"
 * (decision #4) — any tool that can spawn a process and read stdout can
 * elicit structured input without MCP or an AI in the loop.
 */
export async function runAsk(
  set: AskSet,
  input: NodeJS.ReadableStream & { isTTY?: boolean },
): Promise<RunAskResult> {
  // Interactive TTY: stream a line at a time via readline. Piped (shell-out,
  // the common case): buffer all input up front — deterministic, no
  // readline/pipe EOF race.
  let ask: (q: string) => Promise<string>;
  let rl: readline.Interface | undefined;

  if (input.isTTY) {
    rl = readline.createInterface({ input, terminal: false });
    ask = (q) =>
      new Promise((resolve) => {
        err(q);
        rl!.question("", (a) => resolve(a.trim()));
      });
  } else {
    const all: string = await new Promise((resolve, reject) => {
      let b = "";
      input.on("data", (c) => (b += c));
      input.on("end", () => resolve(b));
      input.on("error", reject);
    });
    const lines = all.split("\n");
    let i = 0;
    ask = async (q) => {
      err(q);
      return (lines[i++] ?? "").trim();
    };
  }

  const total = set.asks.length;
  err(`\n  ‽ Elicitkit — ${total} question${total === 1 ? "" : "s"}`);
  err(`  Answer each one. The typed result prints as JSON when you're done.`);

  const answers: Answer[] = [];
  for (let idx = 0; idx < set.asks.length; idx++) {
    answers.push(await one(set.asks[idx]!, ask, idx + 1, total));
  }
  rl?.close();

  // Readable recap to stderr (stdout stays pure JSON).
  err(`\n  ── summary ──`);
  for (const a of answers) {
    const v =
      a.status !== "answered"
        ? a.status.toUpperCase()
        : typeof a.value === "object"
          ? JSON.stringify(a.value)
          : String(a.value);
    err(`  • ${a.id}: ${v}`);
  }

  const r = validateAnswers(set, answers);
  if (!r.ok) err(`\n  ⚠ ${r.errors.length} validation issue(s) — see below`);
  return { answers: r.answers.length ? r.answers : answers, ok: r.ok, errors: r.errors };
}

async function one(
  a: Ask,
  ask: (q: string) => Promise<string>,
  n: number,
  total: number,
): Promise<Answer> {
  const required = a.required !== false;
  const base = { id: a.id, type: a.type, meta: { tier: "tui" as const, specVersion: a.meta?.specVersion } };
  const opt = required ? "" : "  (optional — press Enter to skip)";
  const head =
    `\n  ┌─ [${n}/${total}] ${a.prompt}` +
    (a.help ? `\n  │  ${a.help}` : "") +
    opt;

  const declinedOr = (v: string, value: unknown): Answer =>
    v === "" && !required
      ? { ...base, status: "declined" }
      : { ...base, status: "answered", value };

  const cue = "  └─➤ "; // where the user types

  switch (a.type) {
    case "ask_text": {
      const v = await ask(`${head}\n${cue}`);
      return declinedOr(v, v);
    }
    case "ask_confirm": {
      const yes = a.spec.affirm ?? "Yes";
      const no = a.spec.deny ?? "No";
      const cons = a.spec.consequence ? `\n  │  ⚠ ${a.spec.consequence}` : "";
      const v = (await ask(`${head}${cons}\n  │  ${yes} / ${no}\n${cue}[y/N] `)).toLowerCase();
      return { ...base, status: "answered", value: v === "y" || v === "yes" };
    }
    case "ask_select": {
      const list = a.spec.options
        .map((o, i) => `  │   ${i + 1}) ${o.label}${o.description ? `  — ${o.description}` : ""}`)
        .join("\n");
      const hint = a.spec.multiple ? "numbers, comma-separated (e.g. 1,3)" : "one number";
      const v = await ask(`${head}\n${list}\n${cue}${hint} `);
      const pick = (s: string) => a.spec.options[Number(s.trim()) - 1]?.id;
      if (a.spec.multiple) {
        const ids = v.split(",").map(pick).filter(Boolean) as string[];
        return ids.length ? { ...base, status: "answered", value: ids } : declinedOr("", ids);
      }
      const id = pick(v);
      return id ? { ...base, status: "answered", value: id } : declinedOr(v === "" ? "" : "x", id);
    }
    case "ask_code_diff": {
      err(head);
      const accepted: string[] = [];
      const rejected: string[] = [];
      const hunks = a.spec.files.flatMap((f) => f.hunks.map((h) => ({ f, h })));
      let k = 0;
      for (const { f, h } of hunks) {
        k++;
        err(`\n  │  ${f.path}  ${h.header ? h.header : `hunk ${h.id}`}  (${k}/${hunks.length})`);
        if (h.before) err(h.before.replace(/^/gm, "  │  - "));
        err(h.after.replace(/^/gm, "  │  + "));
        const v = (await ask(`${cue}accept this hunk? [Y/n] `)).toLowerCase();
        (v === "n" || v === "no" ? rejected : accepted).push(h.id);
      }
      return { ...base, status: "answered", value: { accepted, rejected } };
    }
    case "ask_number": {
      const s = a.spec ?? {};
      const r = [
        s.min != null ? `min ${s.min}` : "",
        s.max != null ? `max ${s.max}` : "",
        s.integer ? "integer" : "",
        s.unit ? s.unit : "",
      ].filter(Boolean).join(", ");
      const v = await ask(`${head}\n${cue}number${r ? ` (${r})` : ""} `);
      if (v === "" && !required) return { ...base, status: "declined" };
      return { ...base, status: "answered", value: Number(v) };
    }
    case "ask_rating": {
      const max = a.spec?.max ?? 5;
      const v = await ask(`${head}\n${cue}1–${max} `);
      if (v === "" && !required) return { ...base, status: "declined" };
      return { ...base, status: "answered", value: Number(v) };
    }
    case "ask_slider": {
      const s = a.spec;
      const v = await ask(`${head}\n${cue}${s.min}–${s.max}${s.unit ? " " + s.unit : ""} `);
      if (v === "" && !required) return { ...base, status: "declined" };
      return { ...base, status: "answered", value: Number(v) };
    }
    case "ask_date": {
      const fmt = a.spec?.time ? "YYYY-MM-DDTHH:MM:SSZ" : "YYYY-MM-DD";
      const v = await ask(`${head}\n${cue}${fmt} `);
      if (v === "" && !required) return { ...base, status: "declined" };
      return { ...base, status: "answered", value: v };
    }
    case "ask_rank": {
      const items = a.spec.items;
      const listed = items
        .map((it, i) => `  │   ${i + 1}) ${it.id} — ${it.label}`)
        .join("\n");
      const v = await ask(
        `${head}\n${listed}\n${cue}all ids best-first, comma-separated `,
      );
      const byNum = (s: string) => items[Number(s.trim()) - 1]?.id;
      const ordered = v
        .split(/[,\s]+/)
        .map((tok) => tok.trim())
        .filter(Boolean)
        .map((tok) => (items.some((it) => it.id === tok) ? tok : byNum(tok)))
        .filter(Boolean) as string[];
      return { ...base, status: "answered", value: ordered };
    }
    case "ask_color": {
      const pal = a.spec?.palette ?? [];
      const allowCustom = pal.length === 0 || a.spec?.allowCustom === true;
      if (pal.length) {
        err(
          pal
            .map((c, i) => `  │   ${i + 1}) ${c}`)
            .join("\n"),
        );
      }
      const hint = pal.length
        ? `number${allowCustom ? " or a CSS color" : ""}`
        : "a CSS color (e.g. #1d4ed8)";
      const v = (await ask(`${head}\n${cue}${hint} `)).trim();
      if (v === "" && !required) return { ...base, status: "declined" };
      const n = Number(v);
      const picked =
        Number.isInteger(n) && n >= 1 && n <= pal.length ? pal[n - 1] : v;
      return { ...base, status: "answered", value: picked };
    }
    default: {
      const v = await ask(`${head}\n${cue}`);
      return declinedOr(v, v);
    }
  }
}

/** Parse + validate an AskSet from a JSON string; throws on invalid. */
export function parseAskSet(json: string): AskSet {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("input is not valid JSON");
  }
  const v = validateAskSet(data);
  if (!v.ok) throw new Error("AskSet failed v0.1 schema:\n- " + v.errors.join("\n- "));
  return data as AskSet;
}

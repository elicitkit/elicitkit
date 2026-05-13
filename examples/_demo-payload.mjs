// Demo helper (HTTP demo). Avoids fragile inline `node -e` quoting.
//   node _demo-payload.mjs elicit  <asksetPath>
//   node _demo-payload.mjs answers <asksetPath> <token>
import { readFileSync } from "node:fs";

const [mode, file, token] = process.argv.slice(2);
const set = JSON.parse(readFileSync(file, "utf8"));

if (mode === "elicit") {
  process.stdout.write(JSON.stringify({ askSet: set }));
} else if (mode === "answers") {
  const fake = (a) => {
    const b = { id: a.id, type: a.type };
    if (a.type === "ask_text")
      return a.required === false ? { ...b, status: "declined" } : { ...b, status: "answered", value: "Spring hardening" };
    if (a.type === "ask_confirm") return { ...b, status: "answered", value: true };
    if (a.type === "ask_select") {
      const ids = a.spec.options.map((o) => o.id);
      return { ...b, status: "answered", value: a.spec.multiple ? [ids[0]] : ids[0] };
    }
    if (a.type === "ask_code_diff") {
      const h = a.spec.files.flatMap((f) => f.hunks.map((x) => x.id));
      return { ...b, status: "answered", value: { accepted: h.slice(0, 1), rejected: h.slice(1) } };
    }
    if (a.type === "ask_number" || a.type === "ask_slider") return { ...b, status: "answered", value: a.spec?.min ?? 1 };
    if (a.type === "ask_rating") return { ...b, status: "answered", value: a.spec?.max ?? 5 };
    if (a.type === "ask_date") return { ...b, status: "answered", value: "2026-05-18" };
    if (a.type === "ask_rank") return { ...b, status: "answered", value: a.spec.items.map((i) => i.id) };
    if (a.type === "ask_color") return { ...b, status: "answered", value: (a.spec && a.spec.palette && a.spec.palette[0]) || "#1d4ed8" };
    return { ...b, status: "answered", value: "ok" };
  };
  process.stdout.write(JSON.stringify({ token, answers: set.asks.map(fake) }));
}

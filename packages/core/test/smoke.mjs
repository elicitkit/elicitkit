// Core validation smoke — per-type value contract (SPEC §7) across all
// nine v0.1 types, happy + rejected. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { validateAnswers, validateAskSet } from "../dist/index.js";

const ask = (type, spec, extra = {}) => ({
  id: type, type, prompt: type, spec, meta: { specVersion: "0.1.0", minTier: "tui" }, ...extra,
});
const set = (a) => ({ specVersion: "0.1.0", asks: [a] });
const ans = (type, value, status = "answered") => [{ id: type, type, status, value }];

// Schema accepts every new type.
for (const t of ["ask_number", "ask_rating", "ask_slider", "ask_date", "ask_rank", "ask_color"]) {
  const a =
    t === "ask_slider" ? ask(t, { min: 0, max: 10 })
    : t === "ask_rank" ? ask(t, { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] })
    : ask(t, {});
  assert.equal(validateAskSet(set(a)).ok, true, `${t} passes schema`);
}

const ok = (a, v) => assert.equal(validateAnswers(set(a), ans(a.type, v)).ok, true, `${a.type} ${JSON.stringify(v)} ok`);
const bad = (a, v) => assert.equal(validateAnswers(set(a), ans(a.type, v)).ok, false, `${a.type} ${JSON.stringify(v)} rejected`);

// ask_number
ok(ask("ask_number", { min: 0, max: 100 }), 42);
bad(ask("ask_number", { min: 0, max: 100 }), 250);
bad(ask("ask_number", { integer: true }), 3.5);
bad(ask("ask_number", {}), "7");

// ask_slider
ok(ask("ask_slider", { min: 1, max: 5 }), 3);
bad(ask("ask_slider", { min: 1, max: 5 }), 9);

// ask_rating
ok(ask("ask_rating", { max: 5 }), 5);
bad(ask("ask_rating", { max: 5 }), 6);
bad(ask("ask_rating", { max: 5 }), 0);
bad(ask("ask_rating", {}), 3.5);

// ask_date
ok(ask("ask_date", {}), "2026-05-18");
bad(ask("ask_date", {}), "18/05/2026");
bad(ask("ask_date", {}), "2026-13-40");
ok(ask("ask_date", { time: true }), "2026-05-18T09:30:00Z");
bad(ask("ask_date", { time: true }), "2026-05-18");

// ask_rank — permutation of all ids, no dupes
const rk = ask("ask_rank", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] });
ok(rk, ["c", "a", "b"]);
bad(rk, ["a", "b"]);          // incomplete
bad(rk, ["a", "b", "x"]);     // unknown id
bad(rk, ["a", "a", "b"]);     // dupe

// ask_color
ok(ask("ask_color", { palette: ["#000", "#fff"] }), "#fff");
bad(ask("ask_color", { palette: ["#000", "#fff"] }), "#abc");
ok(ask("ask_color", { palette: ["#000"], allowCustom: true }), "#123456");
bad(ask("ask_color", {}), 42);

// declined is first-class for an optional ask
assert.equal(
  validateAnswers(set(ask("ask_number", {}, { required: false })), ans("ask_number", undefined, "declined")).ok,
  true,
);

console.log("OK — core value contract, 10 types (happy + rejected)");

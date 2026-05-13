// The pack must emit a v0.1-valid AskSet that the reference validator and
// the conformance harness both accept. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { validateAskSet } from "@elicitkit/core";
import { buildPrReviewAskSet } from "../dist/index.js";

const set = buildPrReviewAskSet({
  title: "Tighten the auth guard",
  files: [
    { path: "src/auth.ts", hunks: [
      { id: "h1", header: "@@ active check @@", before: "if (u)", after: "if (u && u.active)" },
      { id: "h2", header: "@@ audit log @@", after: "logger.info('granted')" },
    ] },
  ],
});

const v = validateAskSet(set);
assert.equal(v.ok, true, "pack output is schema-valid: " + v.errors.join("; "));
assert.equal(set.asks[0].type, "ask_code_diff");
assert.deepEqual(set.asks.map((a) => a.id), ["diff", "verdict", "risk", "concerns"]);

// Toggles drop the optional asks.
const lean = buildPrReviewAskSet({ files: set.asks[0].spec.files, includeRisk: false, includeConcerns: false });
assert.deepEqual(lean.asks.map((a) => a.id), ["diff", "verdict"]);
assert.equal(validateAskSet(lean).ok, true);

// Empty input is a clear error, not a malformed AskSet.
assert.throws(() => buildPrReviewAskSet({ files: [] }), /at least one file/);

console.log("OK — pr-review pack emits a valid AskSet (3/3)");

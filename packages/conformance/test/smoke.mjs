// The reference implementation MUST pass its own conformance suite —
// that is what makes the SUITE (not the server) the moat. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { validateAskSet, validateAnswer, validateAnswers } from "@elicitkit/core";
import { runConformance, formatReport } from "../dist/index.js";

const report = runConformance({ validateAskSet, validateAnswer, validateAnswers });

if (!report.compliant) {
  console.error(formatReport(report));
  assert.fail(`@elicitkit/core is NOT self-compliant (${report.passed}/${report.total})`);
}
assert.equal(report.exercised.answerSemantics, true, "set-aware checks ran");
assert.ok(report.total >= 40, `corpus should be substantive, got ${report.total}`);

// A deliberately broken target must be reported NON-compliant (the suite
// has teeth — it isn't a rubber stamp).
const broken = runConformance({
  validateAskSet: () => ({ ok: true }),   // accepts everything, incl. invalid
  validateAnswer: () => ({ ok: true }),
});
assert.equal(broken.compliant, false, "a permissive impl must fail conformance");

console.log(`OK — reference is self-compliant (${report.passed}/${report.total}); suite rejects a broken impl`);

// The reference implementation MUST pass its own conformance suite —
// that is what makes the SUITE (not the server) the moat. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { validateAskSet, validateAnswer, validateAnswers } from "@elicitkit/core";
import {
  buildPanelHtml,
  renderTui,
  runElicitation,
} from "@elicitkit/renderers";
import { runConformance, formatReport } from "../dist/index.js";
import { INTEGRATION } from "../dist/corpus.js";

// Adapter: drive the elicitation-tier renderer with a capture-elicit fake
// so the runner can substring-match the emitted message + JSON Schema
// against the fixture's `mustInclude` labels. The fake captures the
// FIRST elicit call and auto-accepts with the schema's default — enough
// to surface the request shape without simulating a real round.
function renderElicitationAsk(askSet) {
  let captured;
  const elicit = async (params) => {
    if (!captured) {
      captured = { message: params.message, requestedSchema: params.requestedSchema };
    }
    const prop = Object.values(params.requestedSchema.properties)[0];
    let v;
    if (prop.type === "boolean") v = true;
    else if (prop.type === "number" || prop.type === "integer") v = prop.minimum ?? 1;
    else if (Array.isArray(prop.oneOf)) v = prop.default ?? prop.oneOf[0].const;
    else if (prop.enum) v = prop.default ?? prop.enum[0];
    else if (prop.type === "array") {
      const branches =
        prop.items?.anyOf ??
        prop.items?.oneOf ??
        prop.items?.enum?.map((c) => ({ const: c })) ??
        [];
      v = branches.map((b) => b.const);
    }
    else if (prop.format === "date") v = "2026-05-18";
    else if (prop.format === "date-time") v = "2026-05-18T09:30:00Z";
    else v = "ok";
    const [key] = Object.keys(params.requestedSchema.properties);
    return { action: "accept", content: { [key]: v } };
  };
  // Fire-and-forget — we only care about the first emitted schema, which
  // is captured synchronously before the elicit Promise resolves.
  runElicitation(askSet, elicit).catch(() => {});
  return captured;
}

// Integration capstone adapter: render the whole AskSet through every
// tier so the runner can substring-match per-tier tokens. apps/url both
// go through buildPanelHtml; tui is the universal sink; elicitation
// drives the real runElicitation with a capture-elicit fake and
// snapshots every emitted schema+message. The integration fixture is a
// single AskSet (the showcase), so we pre-render the elicitation half
// once and cache it — the runner calls renderTiers synchronously, so
// pushing the async work into a one-time pre-pass keeps the hook sync.
const elicitationCache = new WeakMap();
async function prerenderElicitation(askSet) {
  const captured = [];
  const elicit = async (params) => {
    captured.push({ message: params.message, requestedSchema: params.requestedSchema });
    const prop = Object.values(params.requestedSchema.properties)[0];
    let v;
    if (prop.type === "boolean") v = true;
    else if (prop.type === "number" || prop.type === "integer") v = prop.minimum ?? 1;
    else if (Array.isArray(prop.oneOf)) v = prop.default ?? prop.oneOf[0].const;
    else if (prop.enum) v = prop.default ?? prop.enum[0];
    else if (prop.type === "array") {
      const branches =
        prop.items?.anyOf ??
        prop.items?.oneOf ??
        prop.items?.enum?.map((c) => ({ const: c })) ??
        [];
      const n = prop.minItems ?? branches.length;
      v = branches.slice(0, Math.max(1, n)).map((b) => b.const);
    } else if (prop.format === "date") v = "2026-05-18";
    else if (prop.format === "date-time") v = "2026-05-18T09:30:00Z";
    else v = "ok";
    const [key] = Object.keys(params.requestedSchema.properties);
    return { action: "accept", content: { [key]: v } };
  };
  await runElicitation(askSet, elicit);
  return captured;
}

function renderTiers(askSet) {
  return {
    apps: buildPanelHtml(askSet, "conformance", "apps"),
    url: buildPanelHtml(askSet, "conformance", "url"),
    tui: renderTui(askSet, "conformance").text,
    elicitation: elicitationCache.get(askSet) ?? [],
  };
}

// Pre-populate the elicitation cache for every integration fixture so
// renderTiers can stay synchronous when the runner calls it.
for (const c of INTEGRATION) {
  elicitationCache.set(c.askSet, await prerenderElicitation(c.askSet));
}

const report = runConformance({ validateAskSet, validateAnswer, validateAnswers, renderElicitationAsk, renderTiers });

if (!report.compliant) {
  console.error(formatReport(report));
  assert.fail(`@elicitkit/core is NOT self-compliant (${report.passed}/${report.total})`);
}
assert.equal(report.exercised.answerSemantics, true, "set-aware checks ran");
assert.equal(report.exercised.elicitationRender, true, "elicitation-render checks ran");
assert.equal(report.exercised.integration, true, "integration tier checks ran");
assert.ok(report.total >= 40, `corpus should be substantive, got ${report.total}`);
assert.equal(report.total, 78, `corpus total locked at 78 (was 77 before integration tier); got ${report.total}`);

// A deliberately broken target must be reported NON-compliant (the suite
// has teeth — it isn't a rubber stamp). This permissive stub accepts
// every envelope AND emits an elicitation schema with only ids (no
// labels) — exactly the Codex-CLI repro shape. Both must fail it.
const broken = runConformance({
  validateAskSet: () => ({ ok: true }),   // accepts everything, incl. invalid
  validateAnswer: () => ({ ok: true }),
  renderElicitationAsk: (askSet) => {
    const ids = (askSet.asks[0].spec.options ?? askSet.asks[0].spec.items ?? []).map((o) => o.id);
    return { type: "object", properties: { value: { type: "string", enum: ids } } };
  },
});
assert.equal(broken.compliant, false, "a permissive impl must fail conformance");

console.log(`OK — reference is self-compliant (${report.passed}/${report.total}); suite rejects a broken impl`);

// Smoke test: the SAME ask_code_diff Ask renders faithfully across all four
// tiers (Task #5 exit criterion), through a real MCP client/server pair.
// Run: node test/smoke.mjs
//
// As of the timeout-fix plan EVERY tool call is non-blocking: panel tiers
// return a token + rendering immediately; the elicitation tier issues ONE
// elicitInput inline, awaits ONE user answer, and returns pending:true so
// the agent drives subsequent asks via elicit_next. Each individual call
// is bounded by a single user answer — never by the whole AskSet.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createElicitServer } from "../dist/index.js";

// Operator opts this host into the UI tiers (it's a known mcp-ui host) so
// the apps/url renderer paths are exercised. The principled "agent can't
// force apps" behaviour is covered separately in section 8.
const server = createElicitServer({ uiTiers: ["apps", "url"] });
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);

// Client declares elicitation capability and answers each hunk confirm:
// first hunk accept, second hunk reject — mirrors the panel-tier decisions.
let elicitCalls = 0;
const client = new Client(
  { name: "smoke", version: "0.0.0" },
  { capabilities: { elicitation: {} } },
);
client.setRequestHandler(ElicitRequestSchema, async (req) => {
  const props = Object.keys(req.params.requestedSchema.properties);
  assert.ok(props.length === 1, "v0.1 elicitation forms are single-property");
  elicitCalls += 1;
  return { action: "accept", content: { accept: elicitCalls === 1 } };
});
await client.connect(clientT);

const askSet = {
  specVersion: "0.1.0",
  asks: [
    {
      id: "patch",
      type: "ask_code_diff",
      prompt: "Apply this refactor?",
      spec: {
        granularity: "hunk",
        files: [
          {
            path: "src/auth.ts",
            hunks: [
              { id: "h1", header: "@@ tighten check @@", before: "if (u)", after: "if (u && u.active)" },
              { id: "h2", header: "@@ log @@", after: "logger.info('ok')" },
            ],
          },
        ],
      },
      meta: { specVersion: "0.1.0", minTier: "tui" },
    },
  ],
};
const EXPECTED = { accepted: ["h1"], rejected: ["h2"] };

const elicit = (supportedTiers) =>
  client.callTool({ name: "elicit", arguments: { askSet, ...(supportedTiers ? { supportedTiers } : {}) } });
const submit = (token, value) =>
  client.callTool({
    name: "elicit_submit",
    arguments: {
      token,
      answers: [{ id: "patch", type: "ask_code_diff", status: "answered", value, meta: { specVersion: "0.1.0" } }],
    },
  });
const next = (token) =>
  client.callTool({ name: "elicit_next", arguments: { token } });

// 0. Tool discovery — `elicit_next` is registered alongside the existing trio.
const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  ["elicit", "elicit_next", "elicit_render", "elicit_submit"],
);

// 1. apps — rich embedded rawHtml panel, token round-trip, pending:true immediate.
{
  const t0 = performance.now();
  const r = await elicit(["apps", "url", "elicitation", "tui"]);
  const dt = performance.now() - t0;
  assert.ok(dt < 1000, `apps elicit returned in <1s; was ${dt.toFixed(1)}ms`);
  assert.equal(r._meta.elicitkit.renderedTier, "apps");
  assert.equal(r._meta.elicitkit.pending, true, "panel tier returns pending:true immediately");
  assert.equal(r.structuredContent?.pending, true);
  assert.equal(r.structuredContent?.tier, "apps");
  const ui = r.content.find((c) => c.type === "resource");
  assert.match(ui.resource.uri, /^ui:\/\/elicitkit\/round\//);
  assert.match(ui.resource.text, /elicit_submit/, "panel posts back");
  const s = await submit(r._meta.elicitkit.token, EXPECTED);
  assert.deepEqual(s.structuredContent.answers[0].value, EXPECTED);
}

// 2. url — same panel as data: externalUrl + copy-paste channel, pending:true.
{
  const t0 = performance.now();
  const r = await elicit(["url", "tui"]);
  const dt = performance.now() - t0;
  assert.ok(dt < 1000, `url elicit returned in <1s; was ${dt.toFixed(1)}ms`);
  assert.equal(r._meta.elicitkit.renderedTier, "url");
  assert.equal(r.structuredContent?.pending, true);
  assert.equal(r.structuredContent?.tier, "url");
  assert.ok(r.structuredContent?.panelUri, "url tier exposes panelUri in structuredContent");
  const ui = r.content.find((c) => c.type === "resource");
  const blob = JSON.stringify(ui);
  assert.match(blob, /data:text\/html;base64,/, "self-contained data: URL");
  assert.match(r.content[0].text, /paste it|verbatim/i, "agent told about paste-back");
  // The pasted-back payload validates exactly like any other submission.
  const s = await submit(r._meta.elicitkit.token, EXPECTED);
  assert.deepEqual(s.structuredContent.answers[0].value, EXPECTED);
}

// 3. elicitation — inline via native primitive, NOW two-step:
// `elicit` issues the FIRST hunk confirm, awaits ONE answer, returns
// pending:true. `elicit_next` issues the second hunk confirm, then the
// round closes with pending:false + answers (no elicit_submit needed).
//
// Slow-ask auto-router pulls a code_diff with >2 hunks off the
// elicitation tier; here we have exactly 2 hunks so elicitation stays.
{
  elicitCalls = 0;
  const t0 = performance.now();
  const r = await elicit(["elicitation", "tui"]);
  const dt = performance.now() - t0;
  assert.ok(dt < 1000, `elicitation first ask returned in <1s; was ${dt.toFixed(1)}ms`);
  assert.equal(r._meta.elicitkit.renderedTier, "elicitation");
  assert.equal(r._meta.elicitkit.pending, true, "first call returns pending:true");
  assert.equal(r.structuredContent?.pending, true);
  assert.equal(r.structuredContent?.tier, "elicitation");
  assert.equal(elicitCalls, 1, "one elicitInput per tool call");
  assert.ok(r._meta.elicitkit.token, "first call hands back a token");

  // Drive the second hunk via elicit_next; round then closes.
  const t1 = performance.now();
  const r2 = await next(r._meta.elicitkit.token);
  const dt2 = performance.now() - t1;
  assert.ok(dt2 < 1000, `elicit_next returned in <1s; was ${dt2.toFixed(1)}ms`);
  assert.equal(r2._meta.elicitkit.pending, false, "round closes after last ask");
  assert.equal(r2.structuredContent?.pending, false);
  assert.equal(elicitCalls, 2, "one confirm per hunk (SPEC §7.4)");
  assert.deepEqual(r2.structuredContent.answers[0].value, EXPECTED);
}

// 4. tui — explicit request: text rendering + token; agent collects + submits.
{
  const t0 = performance.now();
  const r = await elicit(["tui"]);
  const dt = performance.now() - t0;
  assert.ok(dt < 1000, `tui elicit returned in <1s; was ${dt.toFixed(1)}ms`);
  assert.equal(r._meta.elicitkit.renderedTier, "tui");
  assert.equal(r.structuredContent?.pending, true);
  assert.equal(r.structuredContent?.tier, "tui");
  assert.match(r.content[0].text, /elicit_submit with token/);
  const s = await submit(r._meta.elicitkit.token, EXPECTED);
  assert.deepEqual(s.structuredContent.answers[0].value, EXPECTED);
}

// 4b. Host-authoritative, no agent input: this host IS opted into the UI
// tiers, so with NO supportedTiers the server picks the richest on its own
// (apps) — the agent doesn't have to know or ask.
{
  const r = await elicit(); // agent passes nothing
  assert.equal(r._meta.elicitkit.renderedTier, "apps", "richest host tier auto-picked");
  assert.deepEqual(r._meta.elicitkit.hostTiers.sort(), ["apps", "elicitation", "tui", "url"]);
}

// 5. Guardrails still hold: malformed value rejected, bad AskSet rejected.
{
  const r = await elicit(["tui"]);
  const bad = await client.callTool({
    name: "elicit_submit",
    arguments: { token: r._meta.elicitkit.token, answers: [{ id: "patch", type: "ask_code_diff", status: "answered", value: { accepted: "h1" } }] },
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /re-ask/i);

  const badSet = await client.callTool({
    name: "elicit",
    arguments: { askSet: { specVersion: "0.1.0", asks: [{ id: "x" }] } },
  });
  assert.equal(badSet.isError, true);
}

// 6. Regression — some MCP clients serialize object args as a JSON STRING.
// The server must coerce it back before schema validation (real-world fix).
{
  const r = await client.callTool({
    name: "elicit",
    arguments: { askSet: JSON.stringify(askSet), supportedTiers: ["tui"] },
  });
  assert.equal(r.isError, undefined, "stringified askSet accepted");
  assert.equal(r._meta.elicitkit.renderedTier, "tui");
}

// 7. Regression — ask_select over the elicitation tier carries a `default`,
// so a user who submits the native form untouched still yields a valid id.
// Also pins the Codex-CLI bug fix: option **labels** must reach the client
// (as `oneOf[i].title`) so the user sees "Dev"/"Prod", not "dev"/"prod".
// Per-option descriptions are folded into the message body because the
// MCP SDK's TitledSingleSelectEnumSchema strips them from oneOf branches.
{
  const selSet = {
    specVersion: "0.1.0",
    asks: [{ id: "env", type: "ask_select", prompt: "Env?",
      spec: { options: [
        { id: "dev", label: "Dev", description: "local sandbox" },
        { id: "prod", label: "Prod" },
      ] },
      meta: { specVersion: "0.1.0", minTier: "tui" } }],
  };
  let seenDefault;
  let seenSchema;
  let seenMessage;
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    const p = Object.values(req.params.requestedSchema.properties)[0];
    seenDefault = p.default;                 // server must pre-select option 1
    seenSchema = p;
    seenMessage = req.params.message;
    return { action: "accept", content: { value: p.default } };
  });
  const r = await client.callTool({
    name: "elicit",
    arguments: { askSet: selSet, supportedTiers: ["elicitation", "tui"] },
  });
  assert.equal(seenDefault, "dev", "ask_select elicitation form pre-selects first option");
  // Single ask → first elicit closes the round, pending:false with answers
  assert.equal(r._meta.elicitkit.pending, false, "single-ask elicitation closes on first call");
  assert.equal(r.structuredContent.answers[0].value, "dev");
  // The Codex-CLI bug repro: the option labels must be visible in the
  // emitted JSON Schema (as oneOf branch titles) — not just the ids.
  // A regression here puts the user back to picking "dev/prod" by id.
  const wire = JSON.stringify(seenSchema);
  assert.ok(wire.includes("Dev"), "ask_select schema carries option label 'Dev'");
  assert.ok(wire.includes("Prod"), "ask_select schema carries option label 'Prod'");
  assert.ok(Array.isArray(seenSchema.oneOf), "ask_select uses oneOf for labelled enum");
  assert.equal(seenSchema.oneOf[0].const, "dev");
  assert.equal(seenSchema.oneOf[0].title, "Dev");
  // Per-option description rides in the message (SDK strips it from
  // oneOf branches), but still reaches the user verbatim.
  assert.ok(
    seenMessage.includes("local sandbox"),
    "option description folded into message body",
  );
}

// 7b. Regression — ask_select with `multiple: true` emits an array whose
// items use labelled `anyOf` branches (the SDK's TitledMultiSelectEnum
// shape), so multi-pick clients still show labels.
{
  const mSet = {
    specVersion: "0.1.0",
    asks: [{ id: "env", type: "ask_select", prompt: "Envs?",
      spec: { multiple: true, min: 1, max: 2, options: [
        { id: "dev", label: "Development" }, { id: "stg", label: "Staging" },
      ] },
      meta: { specVersion: "0.1.0", minTier: "tui" } }],
  };
  let seenProp;
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    seenProp = Object.values(req.params.requestedSchema.properties)[0];
    return { action: "accept", content: { value: [seenProp.items.anyOf[0].const] } };
  });
  await client.callTool({ name: "elicit", arguments: { askSet: mSet, supportedTiers: ["elicitation", "tui"] } });
  assert.equal(seenProp.type, "array");
  assert.ok(Array.isArray(seenProp.items.anyOf), "multi-select items use labelled anyOf");
  assert.equal(seenProp.items.anyOf[0].const, "dev");
  assert.equal(seenProp.items.anyOf[0].title, "Development");
  const blob = JSON.stringify(seenProp);
  assert.ok(blob.includes("Development"), "multi ask_select carries label 'Development'");
  assert.ok(blob.includes("Staging"), "multi ask_select carries label 'Staging'");
}

// 7c. Regression — ask_rank emits a fixed-length array of labelled
// `anyOf` slots so the user reorders human-readable rows, not bare ids.
// (At 2 items it stays on the elicitation tier; the slow-ask router
// only pulls rank when items > 4.)
{
  const rkSet = {
    specVersion: "0.1.0",
    asks: [{ id: "rk", type: "ask_rank", prompt: "Priorities?",
      spec: { items: [
        { id: "p1", label: "Reduce churn" },
        { id: "p2", label: "Ship onboarding" },
      ] },
      meta: { specVersion: "0.1.0", minTier: "tui" } }],
  };
  let seenProp;
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    seenProp = Object.values(req.params.requestedSchema.properties)[0];
    return { action: "accept", content: { value: ["p2", "p1"] } };
  });
  const r = await client.callTool({ name: "elicit", arguments: { askSet: rkSet, supportedTiers: ["elicitation", "tui"] } });
  assert.equal(seenProp.type, "array");
  assert.equal(seenProp.minItems, 2);
  assert.equal(seenProp.maxItems, 2);
  assert.ok(Array.isArray(seenProp.items.anyOf), "ask_rank items use labelled anyOf");
  const blob = JSON.stringify(seenProp);
  assert.ok(blob.includes("Reduce churn"), "ask_rank carries label 'Reduce churn'");
  assert.ok(blob.includes("Ship onboarding"), "ask_rank carries label 'Ship onboarding'");
  assert.deepEqual(r.structuredContent.answers[0].value, ["p2", "p1"]);
}

// 8. The Claude-Code fix: a terminal client (no UI opt-in, no UI
// experimental cap) — even when the AGENT asks for "apps" — must get the
// interactive elicitation tier, never a dead apps panel.
{
  const s2 = createElicitServer(); // NOT opted into uiTiers
  const [c2t, s2t] = InMemoryTransport.createLinkedPair();
  await s2.connect(s2t);
  const c2 = new Client({ name: "terminal", version: "0" }, { capabilities: { elicitation: {} } });
  c2.setRequestHandler(ElicitRequestSchema, async (req) => {
    const [key, p] = Object.entries(req.params.requestedSchema.properties)[0];
    const firstId = (item) =>
      Array.isArray(item.anyOf)
        ? item.anyOf[0].const
        : Array.isArray(item.oneOf)
          ? item.oneOf[0].const
          : item.enum?.[0];
    const v =
      p.type === "boolean"
        ? true
        : p.type === "array"
          ? [firstId(p.items)]
          : Array.isArray(p.oneOf)
            ? p.oneOf[0].const
            : p.enum
              ? p.enum[0]
              : "ok";
    return { action: "accept", content: { [key]: v } };
  });
  await c2.connect(c2t);

  const set1 = { specVersion: "0.1.0", asks: [{ id: "q", type: "ask_confirm", prompt: "Go?", spec: {}, meta: { specVersion: "0.1.0", minTier: "tui" } }] };

  // agent over-claims apps/url — server must ignore and use elicitation
  const r1 = await c2.callTool({ name: "elicit", arguments: { askSet: set1, supportedTiers: ["apps", "url", "elicitation", "tui"] } });
  assert.equal(r1._meta.elicitkit.renderedTier, "elicitation", "LLM cannot conjure apps in a terminal");
  assert.deepEqual(r1._meta.elicitkit.hostTiers.sort(), ["elicitation", "tui"]);

  // agent passes nothing — same result
  const r2 = await c2.callTool({ name: "elicit", arguments: { askSet: set1 } });
  assert.equal(r2._meta.elicitkit.renderedTier, "elicitation");

  await c2.close();
  await s2.close();
}

// 9. The 5 new catalog types resolve end-to-end over the elicitation tier
// via the two-step `elicit` → `elicit_next` loop (one user answer per
// call). All 5 single-ask types (no ask_code_diff sub-steps).
{
  const s3 = createElicitServer();
  const [c3t, s3t] = InMemoryTransport.createLinkedPair();
  await s3.connect(s3t);
  const c3 = new Client({ name: "term", version: "0" }, { capabilities: { elicitation: {} } });
  c3.setRequestHandler(ElicitRequestSchema, async (req) => {
    const [key, p] = Object.entries(req.params.requestedSchema.properties)[0];
    let v;
    if (p.type === "number" || p.type === "integer") v = p.minimum ?? 1;
    else if (Array.isArray(p.oneOf)) v = p.oneOf[0].const;
    else if (p.enum) v = p.enum[0];
    else if (p.type === "array") {
      // ask_rank: pick every labelled slot in declared order
      const opts =
        p.items.anyOf ??
        p.items.oneOf ??
        p.items.enum?.map((c) => ({ const: c })) ??
        [];
      v = opts.map((o) => o.const);
    } else if (p.format === "date") v = "2026-05-18";
    else if (p.format === "date-time") v = "2026-05-18T09:30:00Z";
    else v = "ok";
    return { action: "accept", content: { [key]: v } };
  });
  await c3.connect(c3t);

  const newSet = {
    specVersion: "0.1.0",
    asks: [
      { id: "n", type: "ask_number", prompt: "How many?", spec: { min: 1, max: 9, integer: true }, meta: { specVersion: "0.1.0", minTier: "tui" } },
      { id: "r", type: "ask_rating", prompt: "Rate", spec: { max: 5 }, meta: { specVersion: "0.1.0", minTier: "tui" } },
      { id: "sl", type: "ask_slider", prompt: "Level", spec: { min: 0, max: 10 }, meta: { specVersion: "0.1.0", minTier: "tui" } },
      { id: "d", type: "ask_date", prompt: "When?", spec: {}, meta: { specVersion: "0.1.0", minTier: "tui" } },
      { id: "rk", type: "ask_rank", prompt: "Order", spec: { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] }, meta: { specVersion: "0.1.0", minTier: "tui" } },
    ],
  };
  // Drive the round via elicit + elicit_next, asserting each call < 1s.
  const first = await c3.callTool({ name: "elicit", arguments: { askSet: newSet, supportedTiers: ["elicitation", "tui"] } });
  assert.equal(first._meta.elicitkit.renderedTier, "elicitation");
  assert.equal(first._meta.elicitkit.pending, true);
  let cur = first;
  while (cur._meta.elicitkit.pending) {
    const t = performance.now();
    cur = await c3.callTool({ name: "elicit_next", arguments: { token: cur._meta.elicitkit.token } });
    const dt = performance.now() - t;
    assert.ok(dt < 1000, `elicit_next < 1s; was ${dt.toFixed(1)}ms`);
  }
  const a = cur.structuredContent.answers;
  assert.equal(a.length, 5, "all five new types resolved");
  assert.equal(typeof a[0].value, "number");
  assert.equal(a[3].value, "2026-05-18");
  assert.deepEqual(a[4].value, ["a", "b", "c"], "rank degraded to an ordered id list");
  await c3.close();
  await s3.close();
}

// 9b. NEW — Codex-realistic 14-question elicitation regression: a typical
// preference-mining round (ask_select × ~10 + ask_confirm × 3 + a short
// ask_text) resolves via elicit + 13× elicit_next without any call
// exceeding the per-call MCP timeout. The assertion is a hard <1s
// server-side bound on each individual call. This is the codification
// of the timeout-fix's headline win.
{
  const s4 = createElicitServer();
  const [c4t, s4t] = InMemoryTransport.createLinkedPair();
  await s4.connect(s4t);
  const c4 = new Client({ name: "codex-like", version: "0" }, { capabilities: { elicitation: {} } });
  c4.setRequestHandler(ElicitRequestSchema, async (req) => {
    const [key, p] = Object.entries(req.params.requestedSchema.properties)[0];
    let v;
    if (p.type === "boolean") v = true;
    else if (Array.isArray(p.oneOf)) v = p.oneOf[0].const;
    else if (p.enum) v = p.enum[0];
    else v = "ok";
    return { action: "accept", content: { [key]: v } };
  });
  await c4.connect(c4t);

  const mkSelect = (id, n) => ({
    id, type: "ask_select", prompt: `Pick ${id}`,
    spec: { options: Array.from({ length: n }, (_, i) => ({ id: `${id}_${i}`, label: `Option ${i}` })) },
    meta: { specVersion: "0.1.0", minTier: "tui" },
  });
  const mkConfirm = (id) => ({
    id, type: "ask_confirm", prompt: `Confirm ${id}?`, spec: {},
    meta: { specVersion: "0.1.0", minTier: "tui" },
  });
  const codexSet = {
    specVersion: "0.1.0",
    asks: [
      // The slow-ask auto-router will keep this set on elicitation:
      // ask_text has maxLen<200, no multiline; selects are ≤8 options; no
      // code_diff/rank in the slow zone.
      { id: "name", type: "ask_text", prompt: "Your name?", spec: { maxLen: 64 }, meta: { specVersion: "0.1.0", minTier: "tui" } },
      mkSelect("q01", 4),
      mkSelect("q02", 4),
      mkSelect("q03", 4),
      mkSelect("q04", 4),
      mkSelect("q05", 4),
      mkSelect("q06", 4),
      mkSelect("q07", 4),
      mkSelect("q08", 4),
      mkSelect("q09", 4),
      mkSelect("q10", 4),
      mkConfirm("c01"),
      mkConfirm("c02"),
      mkConfirm("c03"),
    ],
  };
  assert.equal(codexSet.asks.length, 14, "14-question regression");

  // First call: must come back <1s after one user answer.
  let t0 = performance.now();
  let cur = await c4.callTool({ name: "elicit", arguments: { askSet: codexSet, supportedTiers: ["elicitation", "tui"] } });
  let dt = performance.now() - t0;
  assert.ok(dt < 1000, `elicit (#1) < 1s; was ${dt.toFixed(1)}ms`);
  assert.equal(cur._meta.elicitkit.renderedTier, "elicitation", "14 quick asks stay on elicitation");
  assert.equal(cur._meta.elicitkit.pending, true);
  assert.equal(cur.structuredContent.completed, 1);
  assert.equal(cur.structuredContent.total, 14);

  // 13 more calls via elicit_next — every one bounded by ONE user answer.
  let calls = 1;
  while (cur._meta.elicitkit.pending) {
    t0 = performance.now();
    cur = await c4.callTool({ name: "elicit_next", arguments: { token: cur._meta.elicitkit.token } });
    dt = performance.now() - t0;
    calls += 1;
    assert.ok(dt < 1000, `elicit_next (#${calls}) < 1s; was ${dt.toFixed(1)}ms`);
  }
  assert.equal(calls, 14, "14 calls total: elicit + 13× elicit_next");
  assert.equal(cur._meta.elicitkit.pending, false);
  assert.equal(cur.structuredContent.answers.length, 14);
  await c4.close();
  await s4.close();
}

// 9c. NEW — slow-ask auto-router: an AskSet containing a slow-likely ask
// drops elicitation from candidates even when the client offers it.
// (1) multiline ask_text, (2) >2 hunks code_diff, (3) >4-item rank.
{
  const cases = [
    {
      name: "ask_text.multiline",
      askSet: {
        specVersion: "0.1.0",
        asks: [{ id: "essay", type: "ask_text", prompt: "Tell us your story",
          spec: { multiline: true }, meta: { specVersion: "0.1.0", minTier: "tui" } }],
      },
      reasonMatch: /ask_text/,
    },
    {
      name: "ask_code_diff.hunks>2",
      askSet: {
        specVersion: "0.1.0",
        asks: [{ id: "patch", type: "ask_code_diff", prompt: "Apply",
          spec: { granularity: "hunk", files: [{ path: "a.ts", hunks: [
            { id: "h1", after: "1" }, { id: "h2", after: "2" }, { id: "h3", after: "3" },
          ] }] },
          meta: { specVersion: "0.1.0", minTier: "tui" } }],
      },
      reasonMatch: /ask_code_diff/,
    },
    {
      name: "ask_rank.items>4",
      askSet: {
        specVersion: "0.1.0",
        asks: [{ id: "rk", type: "ask_rank", prompt: "Order",
          spec: { items: [
            { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
            { id: "d", label: "D" }, { id: "e", label: "E" },
          ] }, meta: { specVersion: "0.1.0", minTier: "tui" } }],
      },
      reasonMatch: /ask_rank/,
    },
  ];

  for (const c of cases) {
    const s5 = createElicitServer({ uiTiers: ["url"] });
    const [c5t, s5t] = InMemoryTransport.createLinkedPair();
    await s5.connect(s5t);
    const c5 = new Client({ name: "ui", version: "0" }, { capabilities: { elicitation: {} } });
    c5.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { value: "x" } }));
    await c5.connect(c5t);
    // Agent says "I support elicitation + url + tui"; server's
    // slow-ask router pulls elicitation out and url wins.
    const r = await c5.callTool({
      name: "elicit",
      arguments: { askSet: c.askSet, supportedTiers: ["elicitation", "url", "tui"] },
    });
    assert.notEqual(r._meta.elicitkit.renderedTier, "elicitation",
      `${c.name}: must NOT pick elicitation`);
    assert.equal(r._meta.elicitkit.routedAwayFromElicitation, true,
      `${c.name}: routedAwayFromElicitation flag set`);
    assert.match(String(r._meta.elicitkit.routeReason), c.reasonMatch,
      `${c.name}: reason names the rule`);
    await c5.close();
    await s5.close();
  }
}

// 10. elicit_render — on-demand standalone HTML, no round-trip; the token
// it embeds still validates through elicit_submit (the "give me HTML" path).
{
  const rset = { specVersion: "0.1.0", asks: [
    { id: "q", type: "ask_select", prompt: "Pick", spec: { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, meta: { specVersion: "0.1.0", minTier: "tui" } },
  ] };
  const r = await client.callTool({ name: "elicit_render", arguments: { askSet: rset } });
  assert.equal(r.isError, undefined, "render did not error");
  assert.equal(r._meta.elicitkit.rendered, "url");
  assert.ok(r._meta.elicitkit.token, "render issues a round token");
  assert.match(r.content[0].text, /<!DOCTYPE html>/, "returns HTML");
  assert.match(r.content[0].text, /ASKS =|ask_select/, "panel embeds the asks");
  // the panel's copy-paste payload validates like any submission
  const s = await client.callTool({
    name: "elicit_submit",
    arguments: { token: r._meta.elicitkit.token, answers: [{ id: "q", type: "ask_select", status: "answered", value: "a" }] },
  });
  assert.equal(s.isError, undefined);
  assert.equal(s.structuredContent.answers[0].value, "a");
  // bad AskSet → error, not HTML
  const bad = await client.callTool({ name: "elicit_render", arguments: { askSet: { specVersion: "0.1.0", asks: [{ id: "x" }] } } });
  assert.equal(bad.isError, true);
}

console.log("OK — 10 types · 4 tiers · non-blocking · render · host-authoritative · regressions (14/14)");
await client.close();
await server.close();

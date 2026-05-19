// Smoke test: the SAME ask_code_diff Ask renders faithfully across all four
// tiers (Task #5 exit criterion), through a real MCP client/server pair.
// Run: node test/smoke.mjs
import assert from "node:assert/strict";
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

// 0. Tool discovery.
const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(), ["elicit", "elicit_render", "elicit_submit"]);

// 1. apps — rich embedded rawHtml panel, token round-trip.
{
  const r = await elicit(["apps", "url", "elicitation", "tui"]);
  assert.equal(r._meta.elicitkit.renderedTier, "apps");
  const ui = r.content.find((c) => c.type === "resource");
  assert.match(ui.resource.uri, /^ui:\/\/elicitkit\/round\//);
  assert.match(ui.resource.text, /elicit_submit/, "panel posts back");
  const s = await submit(r._meta.elicitkit.token, EXPECTED);
  assert.deepEqual(s.structuredContent.answers[0].value, EXPECTED);
}

// 2. url — same panel as data: externalUrl + copy-paste channel.
{
  const r = await elicit(["url", "tui"]);
  assert.equal(r._meta.elicitkit.renderedTier, "url");
  const ui = r.content.find((c) => c.type === "resource");
  const blob = JSON.stringify(ui);
  assert.match(blob, /data:text\/html;base64,/, "self-contained data: URL");
  assert.match(r.content[0].text, /paste it|verbatim/i, "agent told about paste-back");
  // The pasted-back payload validates exactly like any other submission.
  const s = await submit(r._meta.elicitkit.token, EXPECTED);
  assert.deepEqual(s.structuredContent.answers[0].value, EXPECTED);
}

// 3. elicitation — inline via native primitive, NO token/elicit_submit.
{
  elicitCalls = 0;
  const r = await elicit(["elicitation", "tui"]);
  assert.equal(r._meta.elicitkit.renderedTier, "elicitation");
  assert.equal(r._meta.elicitkit.inline, true);
  assert.equal(r._meta.elicitkit.token, undefined, "no round token for inline tier");
  assert.equal(elicitCalls, 2, "one confirm per hunk (SPEC §7.4)");
  assert.deepEqual(r.structuredContent.answers[0].value, EXPECTED);
}

// 4. tui — explicit request: text rendering + token; agent collects + submits.
{
  const r = await elicit(["tui"]);
  assert.equal(r._meta.elicitkit.renderedTier, "tui");
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

// 9. The 5 new catalog types resolve end-to-end over the elicitation tier.
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
  const r = await c3.callTool({ name: "elicit", arguments: { askSet: newSet, supportedTiers: ["elicitation", "tui"] } });
  assert.equal(r._meta.elicitkit.renderedTier, "elicitation");
  const a = r.structuredContent.answers;
  assert.equal(a.length, 5, "all five new types resolved");
  assert.equal(typeof a[0].value, "number");
  assert.equal(a[3].value, "2026-05-18");
  assert.deepEqual(a[4].value, ["a", "b", "c"], "rank degraded to an ordered id list");
  await c3.close();
  await s3.close();
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

console.log("OK — 10 types · 4 tiers · render · host-authoritative · regressions (12/12)");
await client.close();
await server.close();

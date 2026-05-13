// DEMO 3 — MCP surface (an AI assistant: Claude Code / Cursor / Codex).
// The AI discovers the `elicit` tool and calls it mid-task; the user answers
// in a rich panel; the AI continues with the typed result. Here a scripted
// MCP client stands in for the AI so you can watch the whole exchange.
//
//   node examples/3-mcp.mjs
//
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createElicitServer } from "../packages/server/dist/index.js";

const file = process.argv[2] ?? "./survey-askset.json";
const askSet = JSON.parse(readFileSync(new URL(file, import.meta.url)));

// Tier A simulates a UI-capable host, so the operator opts this server
// into the apps/url tiers (a plain terminal would NOT get them).
const server = createElicitServer({ uiTiers: ["apps", "url"] });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);

// The client declares it can do native elicitation, and auto-answers each
// per-hunk confirm (a real host would show the user a prompt).
const client = new Client({ name: "demo-ai", version: "0" }, { capabilities: { elicitation: {} } });
let hunk = 0;
// A real host shows the user a prompt; here we auto-answer based on the
// single requested field's shape (boolean hunk-confirm, enum, array, text).
client.setRequestHandler(ElicitRequestSchema, async (req) => {
  const [key, p] = Object.entries(req.params.requestedSchema.properties)[0];
  let v;
  if (key === "accept") v = ++hunk === 1;            // accept h1, reject h2
  else if (p.type === "boolean") v = true;
  else if (p.type === "array") v = [p.items.enum[0]]; // first option
  else if (p.enum) v = p.enum[0];                     // first enum value
  else if (p.type === "number" || p.type === "integer") v = p.minimum ?? 1;
  else if (p.format === "date") v = "2026-05-18";
  else if (p.format === "date-time") v = "2026-05-18T09:30:00Z";
  else if (p.title && p.title.startsWith("e.g. ")) v = p.title.slice(5); // rank ids
  else v = "looks good";                              // free text
  return { action: "accept", content: { [key]: v } };
});
await client.connect(ct);

const line = (s) => console.log(s);

line("\n=== Tier A: rich 'apps' panel (host embeds interactive UI) ===");
const apps = await client.callTool({ name: "elicit", arguments: { askSet, supportedTiers: ["apps", "tui"] } });
const ui = apps.content.find((c) => c.type === "resource");
line(`  agent sees   : "${apps.content[0].text}"`);
line(`  UI resource  : ${ui.resource.uri}`);
line(`  panel HTML   : ${ui.resource.text.length} bytes of self-contained UI`);
line(`  round token  : ${apps._meta.elicitkit.token.slice(0, 24)}…`);
// Synthesize what a user would click, for any AskSet (so this works with
// sample- or survey-askset, or your own file).
const fakeAnswer = (a) => {
  const base = { id: a.id, type: a.type };
  if (a.type === "ask_text")
    return a.required === false ? { ...base, status: "declined" } : { ...base, status: "answered", value: "Spring hardening" };
  if (a.type === "ask_confirm") return { ...base, status: "answered", value: true };
  if (a.type === "ask_select") {
    const ids = a.spec.options.map((o) => o.id);
    return { ...base, status: "answered", value: a.spec.multiple ? [ids[0]] : ids[0] };
  }
  if (a.type === "ask_code_diff") {
    const hs = a.spec.files.flatMap((f) => f.hunks.map((h) => h.id));
    return { ...base, status: "answered", value: { accepted: hs.slice(0, 1), rejected: hs.slice(1) } };
  }
  if (a.type === "ask_number" || a.type === "ask_slider")
    return { ...base, status: "answered", value: a.spec?.min ?? 1 };
  if (a.type === "ask_rating") return { ...base, status: "answered", value: a.spec?.max ?? 5 };
  if (a.type === "ask_date") return { ...base, status: "answered", value: "2026-05-18" };
  if (a.type === "ask_rank") return { ...base, status: "answered", value: a.spec.items.map((i) => i.id) };
  if (a.type === "ask_color") return { ...base, status: "answered", value: (a.spec && a.spec.palette && a.spec.palette[0]) || "#1d4ed8" };
  return { ...base, status: "answered", value: "ok" };
};
const sub = await client.callTool({
  name: "elicit_submit",
  arguments: { token: apps._meta.elicitkit.token, answers: askSet.asks.map(fakeAnswer) },
});
line("  user submits → agent now has typed answers:");
line("    " + JSON.stringify(sub.structuredContent.answers.map((a) => ({ id: a.id, status: a.status, value: a.value }))));

line("\n=== Tier B: same Ask, host has NO custom UI → native elicitation ===");
const el = await client.callTool({ name: "elicit", arguments: { askSet, supportedTiers: ["elicitation", "tui"] } });
line(`  resolved inline (no token, no submit): renderedTier=${el._meta.elicitkit.renderedTier}`);
line("    " + JSON.stringify(el.structuredContent.answers.map((a) => ({ id: a.id, status: a.status, value: a.value }))));

line("\nSame question, two clients, both work — that's the 4-tier point.\n");
await client.close();
await server.close();

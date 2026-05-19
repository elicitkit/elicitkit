// Regenerate the live panel the landing page embeds. The landing
// (index.html) is static; only panel.html is generated so it always
// reflects the real current renderer. The showcase AskSet is the
// playground's demo because it exercises every v0.1 type (and every
// `ask_select` display mode) — the survey fixture is still useful as
// an integrator example in examples/, just not as the landing demo.
// Run: node apps/playground/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPanelHtml } from "@elicitkit/renderers";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const askSet = JSON.parse(readFileSync(here("../../examples/showcase-askset.json"), "utf8"));

writeFileSync(here("./panel.html"), buildPanelHtml(askSet, "playground", "url"));
console.log("apps/playground/panel.html regenerated from the live renderer");

// Regenerate the live panel the landing page embeds. The landing
// (index.html) is static; only panel.html is generated so it always
// reflects the real current renderer. Run: node apps/playground/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPanelHtml } from "@elicitkit/renderers";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const askSet = JSON.parse(readFileSync(here("../../examples/survey-askset.json"), "utf8"));

writeFileSync(here("./panel.html"), buildPanelHtml(askSet, "playground", "url"));
console.log("apps/playground/panel.html regenerated from the live renderer");

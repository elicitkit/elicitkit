import { createUIResource } from "@mcp-ui/server";
import type { AskSet } from "@elicitkit/core";
import { buildPanelHtml } from "./panel.js";
import type { RenderedPanel } from "./contract.js";

/**
 * `apps` tier — the richest: an interactive panel rendered inline by an MCP
 * Apps / mcp-ui host. The whole AskSet renders in one round-trip (SPEC §6).
 * The returned `ui` is a valid embeddable content block and also exposes
 * `.resource` for MCP Apps resource registration.
 */
export async function renderApps(set: AskSet, token: string): Promise<RenderedPanel> {
  const ui = await createUIResource({
    uri: `ui://elicitkit/round/${token}`,
    encoding: "text",
    content: { type: "rawHtml", htmlString: buildPanelHtml(set, token, "apps") },
    metadata: { title: "Elicitkit", description: `${set.asks.length} question(s)` },
    uiMetadata: {
      "preferred-frame-size": ["720px", "640px"],
      "initial-render-data": { token },
    },
  });

  return {
    tier: "apps",
    text: "Interactive panel rendered. Awaiting the user's submission via elicit_submit.",
    ui,
  };
}

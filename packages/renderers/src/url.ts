import { createUIResource } from "@mcp-ui/server";
import type { AskSet } from "@elicitkit/core";
import { buildPanelHtml } from "./panel.js";
import type { RenderedPanel } from "./contract.js";

/**
 * `url` tier — for hosts that open an external page rather than embed UI. It
 * is the *same* panel as `apps`, delivered as an `externalUrl` the host loads
 * in an iframe/browser; answers post back via the same mcp-ui `tool` message.
 *
 * Return channel: the page yields a copy-pasteable JSON payload the user
 * hands back to the assistant (which forwards it verbatim to `elicit_submit`).
 * It also attempts the mcp-ui `tool` postMessage, so it is *automatic* when a
 * host embeds it and *still works* when opened standalone in a browser — no
 * server or signed link required for v0.1.
 *
 * v0.1: the page is self-contained in a `data:` URL. Task #6 may add a hosted
 * route and Task #7 a signed one-time link, but the copy-paste channel keeps
 * this tier fully functional in the meantime — a contained change behind this
 * one function.
 */
export async function renderUrl(set: AskSet, token: string): Promise<RenderedPanel> {
  const html = buildPanelHtml(set, token, "url");
  const dataUrl =
    "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");

  const ui = await createUIResource({
    uri: `ui://elicitkit/round/${token}`,
    encoding: "text",
    content: { type: "externalUrl", iframeUrl: dataUrl },
    metadata: { title: "Elicitkit", description: `${set.asks.length} question(s)` },
    uiMetadata: {
      "preferred-frame-size": ["720px", "640px"],
      "initial-render-data": { token },
    },
  });

  return {
    tier: "url",
    text:
      "Ask the user to open the linked panel and answer it. They will paste " +
      "back a JSON payload — forward it verbatim to elicit_submit (it carries " +
      "the round token). If the host embeds the panel, submission is automatic.",
    ui,
  };
}

import type { AskSet, Tier } from "@elicitkit/core";
import {
  renderApps,
  renderUrl,
  renderTui,
  type RenderedPanel,
} from "@elicitkit/renderers";

/**
 * Dispatch the panel tiers (`apps` / `url` / `tui`). The `elicitation` tier is
 * NOT here: it resolves inline against the host's native elicitation primitive
 * and is driven directly by the server (see server.ts), with no panel or
 * `elicit_submit` round-trip.
 */
export async function renderPanel(
  set: AskSet,
  tier: Tier,
  token: string,
): Promise<RenderedPanel> {
  if (tier === "apps") return renderApps(set, token);
  if (tier === "url") return renderUrl(set, token);
  // "tui" — and the safe sink for anything unexpected.
  return renderTui(set, token);
}

import type { Ask, AskSet, Tier, AskText, AskCodeDiff, AskRank } from "@elicitkit/core";

/** Richest → poorest. The spec's normative ordering (SPEC.md §4). */
export const TIER_ORDER: readonly Tier[] = ["apps", "url", "elicitation", "tui"];

const RANK: Record<Tier, number> = { apps: 0, url: 1, elicitation: 2, tui: 3 };

/** A higher rank number = poorer tier. `a` is at least as rich as `b`. */
function atLeastAsRich(a: Tier, b: Tier): boolean {
  return RANK[a] <= RANK[b];
}

/**
 * The poorest `minTier` across all asks in the set bounds how rich a tier the
 * whole panel may use — every ask must still be faithful at the chosen tier.
 * An ask with `minTier: "url"` cannot degrade below `url`; the set inherits
 * that floor. Default floor is `tui` (the universal sink — never hard-fails).
 */
export function setFloor(set: AskSet): Tier {
  let floor: Tier = "tui";
  for (const ask of set.asks) {
    const m = (ask as Ask).meta?.minTier;
    if (m && atLeastAsRich(m, floor) === false) floor = m;
  }
  return floor;
}

export interface TierChoice {
  tier: Tier;
  /** True when the host advertised tiers and the floor still fit. */
  negotiated: boolean;
}

/**
 * Pick the richest tier the host supports that is still ≥ the set's floor
 * (SPEC.md §4). If the host advertises nothing, assume `tui` — the one tier
 * every client can render and the spec guarantees never hard-fails.
 */
export function negotiateTier(
  set: AskSet,
  hostSupported: readonly Tier[] | undefined,
): TierChoice {
  const floor = setFloor(set);

  if (!hostSupported || hostSupported.length === 0) {
    // No capabilities advertised: the safe universal sink.
    return { tier: "tui", negotiated: false };
  }

  const supported = new Set(hostSupported);
  for (const tier of TIER_ORDER) {
    // richest → poorest: first supported tier that is still ≥ the floor
    if (supported.has(tier) && atLeastAsRich(tier, floor)) {
      return { tier, negotiated: true };
    }
  }

  // Host supports nothing at or above the floor — fall back to tui, which
  // the spec defines for every type so the panel still renders.
  return { tier: "tui", negotiated: false };
}

/**
 * Slow-ask auto-router. The elicitation tier is one-question-at-a-time
 * over a per-tool-call MCP timeout — fine for quick asks (ask_confirm, a
 * short ask_select, a number) but cliff-edge for any ask that needs
 * actual thought time (a multiline essay, a many-hunk code diff, a long
 * ranking). For those, a panel tier (apps/url) — or, failing those, tui
 * with a single round-trip — keeps the call bounded while letting the
 * user take as long as they want.
 *
 * The router is conservative: a single slow-likely ask in the set is
 * enough to drop elicitation from the candidate tier list. The host's
 * other tiers (apps/url/tui) still negotiate normally. If elicitation
 * was the only tier the host offered, the safe sink ("tui") still wins
 * because the spec guarantees every type renders there.
 */
export interface SlowAskDecision {
  routed: boolean;
  reason?: string;
}

export function slowAskRoute(set: AskSet): SlowAskDecision {
  for (const ask of set.asks) {
    const r = isSlowAsk(ask);
    if (r) return { routed: true, reason: r };
  }
  return { routed: false };
}

function isSlowAsk(ask: Ask): string | null {
  switch (ask.type) {
    case "ask_text": {
      const s = (ask as AskText).spec ?? {};
      if (s.multiline === true) return "ask_text.multiline";
      // No bound = free-form; we treat unset as "could be long". 200 chars
      // is roughly the limit at which typing time exceeds typical per-call
      // MCP timeouts on a slow human.
      if (typeof s.maxLen === "number") {
        if (s.maxLen >= 200) return "ask_text.maxLen>=200";
      } else {
        return "ask_text.maxLen-unset";
      }
      return null;
    }
    case "ask_code_diff": {
      const files = (ask as AskCodeDiff).spec.files ?? [];
      const hunks = files.reduce((n, f) => n + (f.hunks?.length ?? 0), 0);
      if (hunks > 2) return "ask_code_diff.hunks>2";
      return null;
    }
    case "ask_rank": {
      const items = (ask as AskRank).spec.items ?? [];
      if (items.length > 4) return "ask_rank.items>4";
      return null;
    }
    // Reserved hooks for v0.1 (ask_form / ask_table land later):
    // the names are listed in the SPEC additive so a forward-compatible
    // implementation could plug them in here without a major bump.
    default:
      return null;
  }
}

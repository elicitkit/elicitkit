import type { Ask, AskSet, Tier } from "@elicitkit/core";

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

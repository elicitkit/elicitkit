import { randomUUID } from "node:crypto";
import { validateAnswers, type Answer, type AskSet, type Tier } from "@elicitkit/core";

/**
 * In-memory store of pending AskSets, keyed by an opaque token handed to the
 * UI. The token scopes a submission to exactly one elicitation round. A real
 * deployment would back this with the security envelope (Task #7); for the
 * v0.1 reference impl an in-process map is sufficient and honest. Answer
 * validation itself lives in @elicitkit/core (shared with the HTTP surface).
 *
 * Rounds carry tier metadata + (for the elicitation tier) the per-ask
 * progress so a `elicit` → `elicit_next` … sequence resolves one ask per
 * tool call. Panel tiers (tui/url/apps) still complete in a single
 * `elicit_submit` call; the multi-step state is only consulted by the
 * elicitation path.
 */
export interface RoundState {
  set: AskSet;
  tier: Tier;
  /** Index of the NEXT ask to issue an elicitInput for. */
  index: number;
  /** Answers collected so far (elicitation-tier multi-step path). */
  collected: Answer[];
  /** When set, the round was routed away from elicitation; reason is
   *  exposed in `_meta.elicitkit.routedAwayFromElicitation` so the
   *  decision is debuggable + testable. */
  routedAwayFromElicitation?: { reason: string };
}

const pending = new Map<string, RoundState>();

export interface OpenRoundOpts {
  tier?: Tier;
  routedAwayFromElicitation?: { reason: string };
}

export function openRound(set: AskSet, opts: OpenRoundOpts = {}): string {
  const token = randomUUID();
  pending.set(token, {
    set,
    tier: opts.tier ?? "tui",
    index: 0,
    collected: [],
    ...(opts.routedAwayFromElicitation
      ? { routedAwayFromElicitation: opts.routedAwayFromElicitation }
      : {}),
  });
  return token;
}

export function peekRound(token: string): AskSet | undefined {
  return pending.get(token)?.set;
}

export function peekRoundState(token: string): RoundState | undefined {
  return pending.get(token);
}

/** Append one answer to the elicitation-tier round and advance the cursor.
 *  Returns the updated counters so the server can decide whether to
 *  return `pending:true` (more asks) or the final `pending:false`. */
export function appendCollected(token: string, answer: Answer): { completed: number; total: number } | undefined {
  const st = pending.get(token);
  if (!st) return undefined;
  st.collected.push(answer);
  st.index += 1;
  return { completed: st.collected.length, total: st.set.asks.length };
}

/** Validate the collected answers as a batch (same path as elicit_submit)
 *  and discard the round. Used at the end of the elicitation-tier
 *  multi-step loop. */
export function closeCollected(token: string): SubmitResult {
  const st = pending.get(token);
  if (!st) {
    return { ok: false, answers: [], errors: ["unknown or expired token"] };
  }
  const r = validateAnswers(st.set, st.collected);
  if (r.ok) pending.delete(token);
  return r;
}

export interface SubmitResult {
  ok: boolean;
  answers: Answer[];
  errors: string[];
}

/** Validate raw answers against the pending AskSet for `token`. The
 *  panel-tier submission path (tui/url/apps). */
export function closeRound(token: string, raw: unknown): SubmitResult {
  const st = pending.get(token);
  if (!st) {
    return { ok: false, answers: [], errors: ["unknown or expired token"] };
  }
  const r = validateAnswers(st.set, raw);
  if (r.ok) pending.delete(token);
  return r;
}

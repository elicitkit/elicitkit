import { randomUUID } from "node:crypto";
import { validateAnswers, type Answer, type AskSet } from "@elicitkit/core";

/**
 * In-memory store of pending AskSets, keyed by an opaque token handed to the
 * UI. The token scopes a submission to exactly one elicitation round. A real
 * deployment would back this with the security envelope (Task #7); for the
 * v0.1 reference impl an in-process map is sufficient and honest. Answer
 * validation itself lives in @elicitkit/core (shared with the HTTP surface).
 */
const pending = new Map<string, AskSet>();

export function openRound(set: AskSet): string {
  const token = randomUUID();
  pending.set(token, set);
  return token;
}

export function peekRound(token: string): AskSet | undefined {
  return pending.get(token);
}

export interface SubmitResult {
  ok: boolean;
  answers: Answer[];
  errors: string[];
}

/** Validate raw answers against the pending AskSet for `token`. */
export function closeRound(token: string, raw: unknown): SubmitResult {
  const set = pending.get(token);
  if (!set) {
    return { ok: false, answers: [], errors: ["unknown or expired token"] };
  }
  const r = validateAnswers(set, raw);
  if (r.ok) pending.delete(token);
  return r;
}

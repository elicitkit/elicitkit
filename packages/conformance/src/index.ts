import {
  VALID_ASKSETS,
  INVALID_ASKSETS,
  VALID_ANSWERS,
  INVALID_ANSWERS,
  SEMANTIC,
  ELICITATION_RENDER,
  INTEGRATION,
  ELICIT_PENDING_SHAPE,
  SLOW_ASK_ROUTING,
} from "./corpus.js";

export * from "./corpus.js";

/** Per-tier rendering of an AskSet, as serialisable strings. The runner
 *  substring-matches against each tier's expected tokens, so an impl may
 *  return literal HTML for `apps`/`url`, the tui plaintext, and either
 *  a single concatenated schema-blob or an array of per-ask schema blobs
 *  for `elicitation` (the runner JSON-serialises anything non-string). */
export interface TierRenderings {
  apps?: unknown;
  url?: unknown;
  tui?: unknown;
  elicitation?: unknown;
}

/** The minimal surface an implementation exposes to be checked. Only
 *  `validateAskSet` + `validateAnswer` are required; `validateAnswers`
 *  (set-aware: required/declined/deferred + per-type value) unlocks the
 *  set-aware tier. `renderElicitationAsk` is optional and exercises the
 *  elicitation-tier rendering contract (labels MUST reach the client).
 *  `renderTiers` is the integration capstone — render the SAME AskSet
 *  across all four tiers and assert every type/label surfaces in each
 *  (the no-cross-type-drift guard at SPEC §6/§7).
 *  Shapes are intentionally tiny so any language can adapt. */
export interface ConformanceTarget {
  validateAskSet(input: unknown): { ok: boolean };
  validateAnswer(input: unknown): { ok: boolean };
  validateAnswers?(askSet: unknown, rawAnswers: unknown): { ok: boolean };
  /** Optional: return what the implementation would send to the host's
   *  native elicitation primitive for the single Ask in `askSet`. Can
   *  be the full `{ message, requestedSchema }` params or just the
   *  schema — the runner serialises whatever is returned and substring-
   *  matches the expected labels, so labels may live in either place. */
  renderElicitationAsk?(askSet: unknown): unknown;
  /** Optional: render the WHOLE AskSet across all four tiers. The
   *  runner serialises each tier and substring-matches the integration
   *  fixture's per-tier tokens — that is what "faithfully rendered
   *  across all 4 tiers" means for a v0.1 implementation. */
  renderTiers?(askSet: unknown): TierRenderings;
  /** Optional: simulate an `elicit` tool call (non-blocking contract).
   *  Returns the rendering blob the agent receives back per tier — must
   *  carry the pending-shape tokens (pending/token/tier) the SPEC
   *  defines. The runner serialises whatever is returned and
   *  substring-matches against the fixture's per-tier expectations. */
  elicitPendingShape?(askSet: unknown, tier: "tui" | "elicitation" | "url" | "apps"): unknown;
  /** Optional: simulate tier negotiation for an AskSet against a host
   *  that offers ALL four tiers — the slow-ask auto-router MUST drop
   *  `elicitation` when the set contains a slow-likely ask. Return
   *  enough context that the runner can substring-match BOTH the
   *  decision flag (e.g. `routedAwayFromElicitation: true`) AND the
   *  rule name (the ask type that triggered). */
  slowAskRoute?(askSet: unknown): unknown;
}

export interface CheckResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface ConformanceReport {
  /** true ⇒ may display the "Elicitkit-compliant (v0.1)" badge */
  compliant: boolean;
  total: number;
  passed: number;
  /** full per-fixture results — show the failures to the implementer */
  results: CheckResult[];
  /** which optional capabilities were exercised */
  exercised: {
    askSet: boolean;
    answerEnvelope: boolean;
    answerSemantics: boolean;
    elicitationRender: boolean;
    integration: boolean;
    pendingShape: boolean;
    slowAskRouting: boolean;
  };
}

function rec(results: CheckResult[], group: string, name: string, ok: boolean, detail: string) {
  results.push({ group, name, ok, detail });
}

/**
 * Run the conformance corpus against `target`. The reference implementation
 * (@elicitkit/core) MUST pass its own suite — that is what makes the suite,
 * not the server, the moat (watchpoint #4).
 */
export function runConformance(target: ConformanceTarget): ConformanceReport {
  const results: CheckResult[] = [];

  for (const c of [...VALID_ASKSETS, ...INVALID_ASKSETS]) {
    const got = target.validateAskSet(c.askSet).ok;
    rec(results, "askSet", c.name, got === c.valid,
      `expected ${c.valid ? "accept" : "reject"} (${c.note}); got ${got ? "accept" : "reject"}`);
  }

  for (const c of [...VALID_ANSWERS, ...INVALID_ANSWERS]) {
    // Envelope-only check: the Answer object itself is schema-valid; the
    // per-type value contract is exercised via validateAnswers below.
    const answer = (c.answers as unknown[])[0];
    const got = target.validateAnswer(answer).ok;
    // every fixture answer is a well-formed envelope; the schema MUST accept
    // the envelope regardless of value (value typing is §7, not the schema).
    rec(results, "answerEnvelope", c.name, got === true,
      `Answer envelope must be schema-valid (${c.note}); got ${got ? "accept" : "reject"}`);
  }

  const hasSetAware = typeof target.validateAnswers === "function";
  if (hasSetAware) {
    const va = target.validateAnswers!.bind(target);
    for (const c of [...VALID_ANSWERS, ...INVALID_ANSWERS]) {
      const got = va(c.askSet, c.answers).ok;
      rec(results, "answerValue", c.name, got === c.valid,
        `value contract: expected ${c.valid ? "accept" : "reject"} (${c.note}); got ${got ? "accept" : "reject"}`);
    }
    for (const c of SEMANTIC) {
      const got = va(c.askSet, c.answers).ok;
      rec(results, "semantics", c.name, got === c.shouldPass,
        `${c.note}; expected ${c.shouldPass ? "pass" : "fail"}, got ${got ? "pass" : "fail"}`);
    }
  }

  const hasElicitRender = typeof target.renderElicitationAsk === "function";
  if (hasElicitRender) {
    const render = target.renderElicitationAsk!.bind(target);
    for (const c of ELICITATION_RENDER) {
      let serialized = "";
      let crashed = false;
      try {
        serialized = JSON.stringify(render(c.askSet));
      } catch (e) {
        crashed = true;
        serialized = String(e);
      }
      const missing = c.mustInclude.filter((s) => !serialized.includes(s));
      const leaked = (c.mustExclude ?? []).filter((s) => serialized.includes(s));
      const ok = !crashed && missing.length === 0 && leaked.length === 0;
      rec(results, "elicitationRender", c.name, ok,
        crashed
          ? `renderElicitationAsk threw: ${serialized}`
          : missing.length
            ? `missing label substrings: ${missing.join(", ")} (${c.note})`
            : leaked.length
              ? `leaked substrings: ${leaked.join(", ")} (${c.note})`
              : `labels surfaced (${c.note})`);
    }
  }

  // Integration: validate the showcase as a whole AND assert every type
  // surfaces faithfully in every tier (no cross-type drift). ONE result
  // per case — either the entire showcase round-trips through the four
  // tiers or this row fails with the exact missing substrings. Opt-in:
  // a target without renderTiers gets a skip-row noted as exercised=false
  // (it still passes if validateAskSet accepts the showcase — the
  // schema half of the contract — so absence of the renderer doesn't
  // silently inflate the row count).
  const hasRenderTiers = typeof target.renderTiers === "function";
  for (const c of INTEGRATION) {
    const wholeValid = target.validateAskSet(c.askSet).ok;
    if (!wholeValid) {
      rec(results, "integration", c.name, false,
        `showcase AskSet rejected by validateAskSet (${c.note})`);
      continue;
    }
    if (!hasRenderTiers) {
      // Schema-only target: the integration row passes on the AskSet
      // half (the rendering half is genuinely not exercised). Keep
      // total stable so the count is deterministic across capability
      // levels — the implementation will see exercised.integration=false.
      rec(results, "integration", c.name, true,
        `showcase AskSet validates; renderTiers not provided (${c.note})`);
      continue;
    }
    const r = target.renderTiers!.bind(target);
    let rendered: TierRenderings;
    try {
      rendered = r(c.askSet) ?? {};
    } catch (e) {
      rec(results, "integration", c.name, false,
        `renderTiers threw: ${String(e)}`);
      continue;
    }
    const ser = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
    const tiers = ["apps", "url", "tui", "elicitation"] as const;
    const missing: string[] = [];
    for (const t of tiers) {
      const blob = rendered[t] === undefined ? "" : ser(rendered[t]);
      for (const s of c.mustIncludePerTier[t]) {
        if (!blob.includes(s)) missing.push(`${t}:${s}`);
      }
    }
    const ok = missing.length === 0;
    rec(results, "integration", c.name, ok,
      ok
        ? `every type's labels/markers reached every tier (${c.note})`
        : `cross-type drift — missing per-tier substrings: ${missing.join(", ")} (${c.note})`);
  }

  // Non-blocking `elicit` contract: per-tier pending-shape fixtures.
  // Optional capability — an adopter without `elicitPendingShape` still
  // passes (validateAskSet on the underlying AskSet is part of askSet),
  // but the pending rows are listed as a skip so the count is stable
  // across capability levels.
  const hasPendingShape = typeof target.elicitPendingShape === "function";
  for (const c of ELICIT_PENDING_SHAPE) {
    const askValid = target.validateAskSet(c.askSet).ok;
    if (!askValid) {
      rec(results, "pendingShape", c.name, false,
        `pending-shape AskSet rejected by validateAskSet (${c.note})`);
      continue;
    }
    if (!hasPendingShape) {
      rec(results, "pendingShape", c.name, true,
        `AskSet validates; elicitPendingShape not provided (${c.note})`);
      continue;
    }
    const tiers = Object.keys(c.mustIncludePerTier) as Array<keyof typeof c.mustIncludePerTier>;
    const missing: string[] = [];
    let crashed: string | null = null;
    for (const t of tiers) {
      let blob = "";
      try {
        const out = target.elicitPendingShape!.bind(target)(c.askSet, t);
        blob = typeof out === "string" ? out : JSON.stringify(out);
      } catch (e) {
        crashed = String(e);
        break;
      }
      for (const s of c.mustIncludePerTier[t] ?? []) {
        if (!blob.includes(s)) missing.push(`${t}:${s}`);
      }
    }
    const ok = crashed === null && missing.length === 0;
    rec(results, "pendingShape", c.name, ok,
      crashed
        ? `elicitPendingShape threw: ${crashed}`
        : missing.length
          ? `missing pending-shape tokens: ${missing.join(", ")} (${c.note})`
          : `pending-shape tokens surfaced (${c.note})`);
  }

  // Slow-ask auto-router fixtures: an AskSet containing a slow-likely
  // ask MUST route away from elicitation. The runner serialises the
  // route-decision blob and substring-matches the required + forbidden
  // tokens.
  const hasSlowAsk = typeof target.slowAskRoute === "function";
  for (const c of SLOW_ASK_ROUTING) {
    if (!hasSlowAsk) {
      // Optional capability: surface as a skip-row that passes, so a
      // schema-only target's count stays deterministic.
      const askValid = target.validateAskSet(c.askSet).ok;
      rec(results, "slowAskRouting", c.name, askValid,
        askValid
          ? `AskSet validates; slowAskRoute not provided (${c.note})`
          : `slow-ask AskSet rejected by validateAskSet (${c.note})`);
      continue;
    }
    let blob = "";
    try {
      const out = target.slowAskRoute!.bind(target)(c.askSet);
      blob = typeof out === "string" ? out : JSON.stringify(out);
    } catch (e) {
      rec(results, "slowAskRouting", c.name, false,
        `slowAskRoute threw: ${String(e)} (${c.note})`);
      continue;
    }
    const missing = c.mustInclude.filter((s) => !blob.includes(s));
    const leaked = c.mustExclude.filter((s) => blob.includes(s));
    const ok = missing.length === 0 && leaked.length === 0;
    rec(results, "slowAskRouting", c.name, ok,
      missing.length
        ? `missing route tokens: ${missing.join(", ")} (${c.note})`
        : leaked.length
          ? `forbidden route tokens leaked: ${leaked.join(", ")} (${c.note})`
          : `routed away from elicitation (${c.note})`);
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    compliant: passed === results.length && results.length > 0,
    total: results.length,
    passed,
    results,
    exercised: {
      askSet: true,
      answerEnvelope: true,
      answerSemantics: hasSetAware,
      elicitationRender: hasElicitRender,
      integration: hasRenderTiers,
      pendingShape: hasPendingShape,
      slowAskRouting: hasSlowAsk,
    },
  };
}

/** Human-readable one-liner per failure, for CLI/CI output. */
export function formatReport(r: ConformanceReport): string {
  const head = r.compliant
    ? `Elicitkit-compliant (v0.1) — ${r.passed}/${r.total}`
    : `NOT compliant — ${r.passed}/${r.total}`;
  const fails = r.results
    .filter((x) => !x.ok)
    .map((x) => `  ✗ [${x.group}] ${x.name}: ${x.detail}`);
  return [head, ...fails].join("\n");
}

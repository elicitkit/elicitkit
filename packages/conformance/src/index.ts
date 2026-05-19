import {
  VALID_ASKSETS,
  INVALID_ASKSETS,
  VALID_ANSWERS,
  INVALID_ANSWERS,
  SEMANTIC,
  ELICITATION_RENDER,
  INTEGRATION,
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

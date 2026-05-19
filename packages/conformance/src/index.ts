import {
  VALID_ASKSETS,
  INVALID_ASKSETS,
  VALID_ANSWERS,
  INVALID_ANSWERS,
  SEMANTIC,
  ELICITATION_RENDER,
} from "./corpus.js";

export * from "./corpus.js";

/** The minimal surface an implementation exposes to be checked. Only
 *  `validateAskSet` + `validateAnswer` are required; `validateAnswers`
 *  (set-aware: required/declined/deferred + per-type value) unlocks the
 *  set-aware tier. `renderElicitationAsk` is optional and exercises the
 *  elicitation-tier rendering contract (labels MUST reach the client).
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

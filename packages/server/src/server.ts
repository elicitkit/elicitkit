import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { validateAskSet, type AskSet, type Tier, type Ask, type Answer } from "@elicitkit/core";
import {
  buildPanelHtml,
  compileAskToInputs,
  decodeAskAnswer,
  type ElicitFn,
  type ElicitParams,
  type ElicitResult,
} from "@elicitkit/renderers";
import { negotiateTier, slowAskRoute, TIER_ORDER } from "./tiers.js";
import { renderPanel } from "./render.js";
import {
  appendCollected,
  closeCollected,
  closeRound,
  openRound,
  peekRoundState,
} from "./submit.js";

const TIER_VALUES = TIER_ORDER as readonly [Tier, ...Tier[]];

export interface ElicitServerOptions {
  name?: string;
  version?: string;
  /**
   * Hosts known to render the `apps`/`url` UI panels. No standard MCP
   * capability advertises HTML rendering, so the server will NOT serve a
   * UI tier to a plain terminal client just because the agent asked for it
   * (that produces a dead "fill out the panel" message with no panel).
   * Opt in here, or via ELICITKIT_UI_TIERS=apps,url, for a host you know
   * supports mcp-ui / MCP Apps.
   */
  uiTiers?: Tier[];
}

/**
 * Build the Elicitkit MCP reference server.
 *
 *  - `elicit`        — the agent submits an AskSet; the server validates it
 *                      against the v0.1 schema and negotiates the render tier
 *                      against the host's capabilities. EVERY tier returns
 *                      fast: panel tiers (apps / url / tui) return a
 *                      rendering plus a round token; the elicitation tier
 *                      issues the FIRST native elicitInput inline, awaits
 *                      ONE user answer, and returns `pending: true` so the
 *                      per-call MCP timeout is never the gating factor.
 *  - `elicit_next`   — NEW. Drives the next elicitInput for an open
 *                      elicitation-tier round. Returns `pending:true`
 *                      until the last ask is answered, then `pending:false`
 *                      with the validated answers.
 *  - `elicit_submit` — the panel (or the agent, in `tui`/`url`) returns the
 *                      user's answers; validated per-type, handed back clean.
 *
 * The spec is the product; this server is its reference implementation.
 */
export function createElicitServer(opts: ElicitServerOptions = {}): McpServer {
  const server = new McpServer({
    name: opts.name ?? "elicitkit",
    version: opts.version ?? "0.1.0",
  });

  // Bridge the renderers' narrow ElicitFn to the SDK's elicitation primitive.
  const elicit: ElicitFn = (params) =>
    server.server.elicitInput({
      mode: "form",
      message: params.message,
      requestedSchema: params.requestedSchema,
    } as Parameters<typeof server.server.elicitInput>[0]) as ReturnType<ElicitFn>;

  server.registerTool(
    "elicit",
    {
      title: "Elicit structured input",
      description:
        "Render an Elicitkit AskSet to the user and obtain typed answers. " +
        "Returns FAST: panel tiers return a token + rendering; the " +
        "elicitation tier issues ONE native prompt inline and returns " +
        "`pending:true` so the per-call MCP timeout is never blown by " +
        "human-think time. If `pending:true` and tier === 'elicitation', " +
        "call `elicit_next(token)` until `pending:false`; otherwise " +
        "collect answers per the rendering and call " +
        "`elicit_submit(token, answers)`. Never fabricate answers.",
      inputSchema: {
        askSet: z
          .unknown()
          .describe("A v0.1 Elicitkit AskSet: { specVersion, asks: [...] }"),
        supportedTiers: z
          .array(z.enum(TIER_VALUES))
          .optional()
          .describe(
            "Render tiers this host supports, richest first. Omit if unknown " +
              "(the server then uses the universal 'tui' text tier).",
          ),
      },
    },
    async ({ askSet, supportedTiers }): Promise<CallToolResult> => {
      // Some MCP clients serialize complex object args as a JSON string.
      // Coerce back to an object before schema validation.
      if (typeof askSet === "string") {
        try {
          askSet = JSON.parse(askSet);
        } catch {
          /* leave as-is; validateAskSet will reject it */
        }
      }
      const v = validateAskSet(askSet);
      if (!v.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "AskSet failed v0.1 schema validation:\n- " +
                v.errors.join("\n- "),
            },
          ],
        };
      }

      const set = askSet as AskSet;

      // The connected MCP CLIENT is the authority on what can render — NOT
      // the agent (an LLM guessing "apps" in a terminal is how you get a
      // dead panel). Derive what the host can actually do:
      const caps = server.server.getClientCapabilities();
      const clientElicitation = !!caps?.elicitation;
      const exp = (caps?.experimental ?? {}) as Record<string, unknown>;
      const uiOptIn =
        opts.uiTiers ??
        (process.env.ELICITKIT_UI_TIERS?.split(",").map((s) => s.trim()).filter(Boolean) as
          | Tier[]
          | undefined);
      // Positive evidence only: an operator opt-in, or the client itself
      // advertising a UI extension. Never the agent's say-so.
      const uiOk =
        (uiOptIn && uiOptIn.length > 0) ||
        !!(exp["mcp-ui"] || exp["apps"] || exp["ui"] || exp["io.modelcontextprotocol/apps"]);

      const hostTiers = new Set<Tier>(["tui"]);
      if (clientElicitation) hostTiers.add("elicitation");
      if (uiOk) {
        hostTiers.add("apps");
        hostTiers.add("url");
      }

      // Slow-ask auto-router: if any ask in the set is likely-slow on the
      // per-prompt elicitation primitive (long text, big code diff, large
      // rank), drop `elicitation` from the candidates so we degrade to a
      // panel tier (apps/url) where the user can take as long as they
      // want, or to tui where the agent collects the answers in chat.
      const slow = slowAskRoute(set);
      const candidates = new Set(hostTiers);
      if (slow.routed) candidates.delete("elicitation");

      // The agent's supportedTiers may only NARROW within the host's real
      // set — it can't grant a tier the host can't do. If its narrowing
      // leaves nothing, ignore it and trust the host.
      let effective: Tier[] = [...candidates];
      const requested = supportedTiers as Tier[] | undefined;
      if (requested && requested.length > 0) {
        const r = new Set(requested);
        const narrowed = effective.filter((t) => r.has(t));
        if (narrowed.length > 0) effective = narrowed;
      }
      // If filtering / routing emptied the set, fall back to the universal
      // sink so we never hard-fail at negotiation.
      if (effective.length === 0) effective = ["tui"];
      const { tier, negotiated } = negotiateTier(set, effective);

      const baseMeta: Record<string, unknown> = {
        renderedTier: tier,
        tierNegotiated: negotiated,
        hostTiers: [...hostTiers],
        ...(slow.routed
          ? { routedAwayFromElicitation: true, routeReason: slow.reason }
          : {}),
      };

      // ── elicitation tier: open round, issue FIRST elicitInput inline,
      // await ONE answer, return pending:true. The rest of the round is
      // driven by elicit_next so each tool call is bounded by one user
      // answer (a Codex-realistic 14-question set never trips a per-call
      // MCP timeout).
      if (tier === "elicitation") {
        const token = openRound(set, { tier: "elicitation" });
        const out = await driveOneStep(token, elicit);
        if (!out.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: out.error }],
          };
        }
        return out.result(token, baseMeta);
      }

      // ── panel tiers (tui/url/apps): return panel ref + token IMMEDIATELY,
      // no await. The user fills the panel; the agent calls elicit_submit.
      const token = openRound(set, {
        tier,
        ...(slow.routed ? { routedAwayFromElicitation: { reason: slow.reason ?? "" } } : {}),
      });
      const out = await renderPanel(set, tier, token);

      const content: CallToolResult["content"] = [
        { type: "text", text: out.text },
      ];
      if (out.ui) {
        content.push(out.ui as unknown as CallToolResult["content"][number]);
      }

      return {
        content,
        structuredContent: {
          pending: true,
          token,
          tier,
          ...(tier === "url" || tier === "apps"
            ? { panelUri: out.ui?.resource.uri }
            : {}),
        },
        _meta: {
          elicitkit: {
            token,
            pending: true,
            ...baseMeta,
            renderedTier: out.tier,
            requestedTier: tier,
            ...(out.ui ? {} : {}),
          },
          ...(out.ui ? { ui: { resourceUri: out.ui.resource.uri } } : {}),
        },
      };
    },
  );

  server.registerTool(
    "elicit_next",
    {
      title: "Advance an open elicitation-tier round",
      description:
        "Drive the next native elicitInput for an open elicitation-tier " +
        "round. Returns `pending:true` (more asks to come) or " +
        "`pending:false` with the validated `answers`. Only valid for the " +
        "elicitation tier — panel tiers (tui/url/apps) complete via " +
        "elicit_submit instead.",
      inputSchema: {
        token: z
          .string()
          .describe("The round token from a prior elicit / elicit_next result."),
      },
    },
    async ({ token }): Promise<CallToolResult> => {
      const st = peekRoundState(token);
      if (!st) {
        return {
          isError: true,
          content: [{ type: "text", text: "unknown or expired token" }],
        };
      }
      if (st.tier !== "elicitation") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `round token is for tier ${st.tier}; use elicit_submit instead`,
            },
          ],
        };
      }
      if (st.index >= st.set.asks.length) {
        return {
          isError: true,
          content: [
            { type: "text", text: "round already complete; no more asks" },
          ],
        };
      }
      const out = await driveOneStep(token, elicit);
      if (!out.ok) {
        return { isError: true, content: [{ type: "text", text: out.error }] };
      }
      return out.result(token, {
        renderedTier: "elicitation",
        hostTiers: [],
      });
    },
  );

  server.registerTool(
    "elicit_submit",
    {
      title: "Submit elicited answers",
      description:
        "Return the user's answers for an open elicitation round. Called by " +
        "the interactive panel; in the tui/url tiers the agent calls it with " +
        "answers the user provided (e.g. a payload pasted back from the url " +
        "panel — forward it verbatim).",
      inputSchema: {
        token: z.string().describe("The round token from the elicit result _meta."),
        answers: z
          .array(z.unknown())
          .describe(
            "One Answer per ask: " +
              '{ id, type, status: "answered"|"declined"|"deferred", value? }',
          ),
      },
    },
    async ({ token, answers }): Promise<CallToolResult> => {
      const r = closeRound(token, answers);
      if (!r.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Answers rejected — re-ask (SPEC.md §5):\n- " +
                r.errors.join("\n- "),
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(r.answers, null, 2) }],
        structuredContent: { answers: r.answers, pending: false },
        _meta: { elicitkit: { token, ok: true, pending: false } },
      };
    },
  );

  server.registerTool(
    "elicit_render",
    {
      title: "Render an AskSet to a standalone HTML panel",
      description:
        "Return a self-contained HTML panel for an AskSet as a one-shot " +
        "deliverable. Use when the user wants HTML / a file / a " +
        "questionnaire / a shareable panel. This is NOT an interactive " +
        "round: save the returned HTML to a .html file, give the user the " +
        "path, and STOP — do not also call `elicit`, do not wait for or " +
        "prompt for answers, do not treat a round as pending. The panel can " +
        "still produce a copy-paste payload, but feeding it to " +
        "elicit_submit is OPTIONAL and only if the user later chooses to " +
        "return one. `elicit` is the interactive ask; this is just the file.",
      inputSchema: {
        askSet: z
          .unknown()
          .describe("A v0.1 Elicitkit AskSet: { specVersion, asks: [...] }"),
      },
    },
    async ({ askSet }): Promise<CallToolResult> => {
      if (typeof askSet === "string") {
        try {
          askSet = JSON.parse(askSet);
        } catch {
          /* leave as-is; validateAskSet will reject it */
        }
      }
      const v = validateAskSet(askSet);
      if (!v.ok) {
        return {
          isError: true,
          content: [
            { type: "text", text: "AskSet failed v0.1 schema validation:\n- " + v.errors.join("\n- ") },
          ],
        };
      }
      const set = askSet as AskSet;
      // A real round token so the panel's copy-paste payload validates
      // through elicit_submit just like any other round.
      const token = openRound(set, { tier: "url" });
      const html = buildPanelHtml(set, token, "url");
      return {
        content: [
          {
            type: "text",
            text:
              `Deliverable: save the following to a .html file, give the ` +
              `user the path, and stop — this is not an interactive round, ` +
              `do not wait for answers. (If the user later returns the ` +
              `panel's copy-paste JSON, it may optionally be forwarded to ` +
              `elicit_submit; the round token is embedded.)\n\n` +
              html,
          },
        ],
        _meta: { elicitkit: { token, rendered: "url", bytes: html.length } },
      };
    },
  );

  return server;
}

// ── elicitation-tier step driver ─────────────────────────────────────────
// Runs ONE elicitInput against the host: either the next sub-step of the
// current ask (e.g. the next hunk for an in-progress ask_code_diff) or the
// first sub-step of the next ask. On a non-accept result the ask is
// finalised via decodeAskAnswer (with whatever sub-steps were collected),
// the round advances, and either the next ask is queued or the round
// closes. The function returns a tagged union the calling tool handler
// turns into a CallToolResult.

type StepOk = {
  ok: true;
  result: (token: string, extraMeta: Record<string, unknown>) => CallToolResult;
};
type StepErr = { ok: false; error: string };
type StepOut = StepOk | StepErr;

async function driveOneStep(token: string, elicit: ElicitFn): Promise<StepOut> {
  const st = peekRoundState(token);
  if (!st) return { ok: false, error: "unknown or expired token" };

  const stateAny = st as unknown as {
    set: AskSet;
    index: number;
    collected: Answer[];
    subResponses?: ElicitResult[];
  };
  if (!stateAny.subResponses) stateAny.subResponses = [];

  const askIdx = stateAny.index;
  const ask = stateAny.set.asks[askIdx];
  if (!ask) {
    return { ok: false, error: "round already complete; no more asks" };
  }

  const inputs = compileAskToInputs(ask as Ask);
  const subStep = stateAny.subResponses.length;
  const params: ElicitParams | undefined = inputs[subStep];
  if (!params) {
    return { ok: false, error: "no elicitInput compiled for ask" };
  }

  const r = await elicit(params);
  stateAny.subResponses.push(r);

  // For ask_code_diff, a non-accept on any hunk ends the ask. For other
  // asks there's only one input anyway.
  const moreSubSteps = inputs.length > stateAny.subResponses.length;
  const continueAsk =
    moreSubSteps && (ask.type !== "ask_code_diff" || r.action === "accept");

  if (continueAsk) {
    // Still inside the current ask. Return pending:true with progress.
    return {
      ok: true,
      result: (tok, extra) =>
        ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { pending: true, token: tok, completed: stateAny.index, total: stateAny.set.asks.length },
                null,
                2,
              ),
            },
          ],
          structuredContent: {
            pending: true,
            token: tok,
            tier: "elicitation",
            completed: stateAny.index,
            total: stateAny.set.asks.length,
          },
          _meta: {
            elicitkit: {
              token: tok,
              pending: true,
              completed: stateAny.index,
              total: stateAny.set.asks.length,
              ...extra,
            },
          },
        }) satisfies CallToolResult,
    };
  }

  // The ask is done — decode its accumulated responses into an Answer.
  const answer = decodeAskAnswer(ask as Ask, stateAny.subResponses);
  const counters = appendCollected(token, answer)!;
  stateAny.subResponses = [];

  if (counters.completed < counters.total) {
    return {
      ok: true,
      result: (tok, extra) =>
        ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { pending: true, token: tok, completed: counters.completed, total: counters.total },
                null,
                2,
              ),
            },
          ],
          structuredContent: {
            pending: true,
            token: tok,
            tier: "elicitation",
            completed: counters.completed,
            total: counters.total,
          },
          _meta: {
            elicitkit: {
              token: tok,
              pending: true,
              completed: counters.completed,
              total: counters.total,
              ...extra,
            },
          },
        }) satisfies CallToolResult,
    };
  }

  // Last ask — finalise the round.
  const final = closeCollected(token);
  if (!final.ok) {
    return {
      ok: false,
      error: "Answers rejected — re-ask (SPEC.md §5):\n- " + final.errors.join("\n- "),
    };
  }
  return {
    ok: true,
    result: (tok, extra) =>
      ({
        content: [{ type: "text", text: JSON.stringify(final.answers, null, 2) }],
        structuredContent: {
          pending: false,
          token: tok,
          tier: "elicitation",
          answers: final.answers,
        },
        _meta: {
          elicitkit: {
            token: tok,
            pending: false,
            inline: true,
            ...extra,
          },
        },
      }) satisfies CallToolResult,
  };
}

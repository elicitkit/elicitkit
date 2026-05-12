import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { validateAskSet, type AskSet, type Tier } from "@elicitkit/core";
import { runElicitation, buildPanelHtml, type ElicitFn } from "@elicitkit/renderers";
import { negotiateTier, TIER_ORDER } from "./tiers.js";
import { renderPanel } from "./render.js";
import { closeRound, openRound } from "./submit.js";

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
 *                      against the host's capabilities. Panel tiers (apps /
 *                      url / tui) return a rendering plus a round token;
 *                      answers come back later via `elicit_submit`. The
 *                      `elicitation` tier instead resolves *inline* against
 *                      the host's native MCP elicitation primitive and
 *                      returns the answers directly — no token, no submit.
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
  // The contract is a deliberate subset of MCP form-mode elicitation; the cast
  // keeps renderers free of an SDK dependency.
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
        "Pass a v0.1 AskSet. Do not fabricate answers — they arrive from the " +
        "user (via elicit_submit, or inline for the elicitation tier).",
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

      // The agent's supportedTiers may only NARROW within the host's real
      // set — it can't grant a tier the host can't do. If its narrowing
      // leaves nothing, ignore it and trust the host.
      let effective: Tier[] = [...hostTiers];
      const requested = supportedTiers as Tier[] | undefined;
      if (requested && requested.length > 0) {
        const r = new Set(requested);
        const narrowed = effective.filter((t) => r.has(t));
        if (narrowed.length > 0) effective = narrowed;
      }
      const { tier, negotiated } = negotiateTier(set, effective);

      // elicitation tier: resolve inline against the native primitive.
      if (tier === "elicitation") {
        const answers = await runElicitation(set, elicit);
        return {
          content: [{ type: "text", text: JSON.stringify(answers, null, 2) }],
          structuredContent: { answers },
          _meta: {
            elicitkit: { renderedTier: "elicitation", tierNegotiated: negotiated, inline: true, clientElicitation, hostTiers: [...hostTiers] },
          },
        };
      }

      // panel tiers: render + hand back a round token for elicit_submit.
      const token = openRound(set);
      const out = await renderPanel(set, tier, token);

      const content: CallToolResult["content"] = [
        { type: "text", text: out.text },
      ];
      if (out.ui) {
        content.push(out.ui as unknown as CallToolResult["content"][number]);
      }

      return {
        content,
        _meta: {
          elicitkit: {
            token,
            renderedTier: out.tier,
            requestedTier: tier,
            tierNegotiated: negotiated,
            hostTiers: [...hostTiers],
          },
          ...(out.ui ? { ui: { resourceUri: out.ui.resource.uri } } : {}),
        },
      };
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
        structuredContent: { answers: r.answers },
        _meta: { elicitkit: { token, ok: true } },
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
      const token = openRound(set);
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

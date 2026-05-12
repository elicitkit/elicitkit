import type { Tier } from "@elicitkit/core";
import type { createUIResource } from "@mcp-ui/server";

/** mcp-ui content block; also carries `.resource` for MCP Apps registration. */
export type UiBlock = Awaited<ReturnType<typeof createUIResource>>;

/**
 * A "panel" rendering — apps / url / tui. The whole AskSet is presented in one
 * round-trip; answers come back later via the server's `elicit_submit` tool.
 * `text` is always present so the agent can fall back to reading it aloud.
 */
export interface RenderedPanel {
  tier: Tier;
  text: string;
  ui?: UiBlock;
}

// ── elicitation tier: native MCP elicitation primitive ──
// A deliberately narrow mirror of the MCP form-mode contract — only the
// property shapes the v0.1 type set needs. Kept here so renderers don't take
// a direct @modelcontextprotocol/sdk dependency.

export type ElicitFormProperty =
  | { type: "string"; title?: string; description?: string; maxLength?: number }
  | { type: "boolean"; title?: string; description?: string; default?: boolean }
  | {
      type: "string";
      title?: string;
      description?: string;
      enum: string[];
      enumNames?: string[];
      default?: string;
    }
  | {
      type: "array";
      title?: string;
      description?: string;
      minItems?: number;
      maxItems?: number;
      items: { type: "string"; enum: string[] };
    };

export interface ElicitParams {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, ElicitFormProperty>;
    required?: string[];
  };
}

export interface ElicitResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

/** The server hands this in; it bridges to MCP `elicitation/create`. */
export type ElicitFn = (params: ElicitParams) => Promise<ElicitResult>;

/** Serialize for embedding in a <script> without breaking out of it. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

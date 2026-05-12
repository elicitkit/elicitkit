#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createElicitServer } from "./server.js";

/**
 * stdio entrypoint — the universal MCP transport (Claude Code, Codex CLI,
 * Cursor, …). HTTP/SDK and CLI surfaces land in Task #6.
 */
async function main(): Promise<void> {
  const server = createElicitServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the MCP wire.
  process.stderr.write("elicitkit MCP server ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`elicitkit fatal: ${String(err)}\n`);
  process.exit(1);
});

#!/usr/bin/env node
import { createHttpServer } from "./server.js";

// Loopback by default (security watchpoint #5: local-bind until the signed
// one-time-link envelope lands in Task #7). Override with HOST/PORT.
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

createHttpServer().listen(port, host, () => {
  process.stderr.write(`elicitkit HTTP surface on http://${host}:${port}\n`);
  process.stderr.write(
    `  POST /elicit · GET /r/:token · POST /elicit/submit · GET /health\n`,
  );
});

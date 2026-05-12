#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { buildPanelHtml } from "@elicitkit/renderers";
import { runAsk, parseAskSet } from "./ask.js";

const HELP = `elicitkit — structured questions for shell-out tools

  elicitkit ask <askset.json>      Walk the AskSet in the terminal; prints
                                   the validated Answer[] JSON to stdout.
                                   (Prompts/log go to stderr — stdout is
                                   pure JSON, pipe-friendly.)

  elicitkit render <askset.json>   Render the url-tier panel HTML.
            [--out <file.html>]    Writes to <file> (or stdout if omitted).

  elicitkit --help

AskSet = { "specVersion": "0.1.0", "asks": [ ... ] }  (Elicitkit spec v0.1)
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return cmd ? 0 : 1;
  }

  if (cmd === "ask") {
    const file = rest[0];
    if (!file) {
      process.stderr.write("usage: elicitkit ask <askset.json>\n");
      return 1;
    }
    const set = parseAskSet(readFileSync(file, "utf8"));
    const { answers, ok, errors } = await runAsk(set, process.stdin);
    process.stdout.write(JSON.stringify(answers) + "\n");
    if (!ok) {
      process.stderr.write("validation errors:\n- " + errors.join("\n- ") + "\n");
      return 1;
    }
    return 0;
  }

  if (cmd === "render") {
    const file = rest[0];
    if (!file) {
      process.stderr.write("usage: elicitkit render <askset.json> [--out <file>]\n");
      return 1;
    }
    const outIdx = rest.indexOf("--out");
    const set = parseAskSet(readFileSync(file, "utf8"));
    const html = buildPanelHtml(set, "cli-" + Date.now(), "url");
    if (outIdx >= 0 && rest[outIdx + 1]) {
      writeFileSync(rest[outIdx + 1]!, html);
      process.stderr.write(`wrote ${rest[outIdx + 1]}\n`);
    } else {
      process.stdout.write(html);
    }
    return 0;
  }

  process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
  return 1;
}

// Set exitCode and let the event loop drain — NEVER process.exit() here:
// a large `render` payload to a pipe is written asynchronously and
// process.exit() would truncate it (the panel is ~25 KB, well past the
// pipe buffer). All handles (readline/stdin) are closed by the time main
// resolves, so the process exits on its own once stdout has flushed.
main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    process.stderr.write(`elicitkit: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });

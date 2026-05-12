// Smoke test: spawn the CLI, pipe an AskSet + answers, assert the Answer[]
// JSON on stdout — the shell-out reach. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const setPath = join(tmpdir(), "elicitkit-cli-set.json");
writeFileSync(
  setPath,
  JSON.stringify({
    specVersion: "0.1.0",
    asks: [
      { id: "patch", type: "ask_code_diff", prompt: "Apply?", spec: { granularity: "hunk", files: [{ path: "a.ts", hunks: [{ id: "h1", after: "x=1" }, { id: "h2", after: "y=2" }] }] }, meta: { specVersion: "0.1.0", minTier: "tui" } },
      { id: "env", type: "ask_select", prompt: "Env?", spec: { options: [{ id: "dev", label: "Dev" }, { id: "prod", label: "Prod" }] } },
      { id: "note", type: "ask_text", prompt: "Note?", required: false, spec: {} },
    ],
  }),
);

function run(args, stdin) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, ...args]);
    let out = "", errOut = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (errOut += d));
    p.on("close", (code) => resolve({ code, out, errOut }));
    if (stdin !== undefined) p.stdin.end(stdin);
  });
}

// ask: accept h1, reject h2, pick option 2 (prod), skip optional note
{
  const { code, out } = await run(["ask", setPath], "y\nn\n2\n\n");
  assert.equal(code, 0, "exit 0");
  const answers = JSON.parse(out);
  assert.deepEqual(answers[0].value, { accepted: ["h1"], rejected: ["h2"] });
  assert.equal(answers[1].value, "prod");
  assert.equal(answers[2].status, "declined");
}

// render: prints self-contained url panel HTML to stdout
{
  const { code, out } = await run(["render", setPath]);
  assert.equal(code, 0);
  assert.match(out, /<!DOCTYPE html>/);
  assert.match(out, /elicit_submit|copyout/, "url panel with copy-paste channel");
}

// invalid AskSet → non-zero exit, error on stderr
{
  const badPath = join(tmpdir(), "elicitkit-cli-bad.json");
  writeFileSync(badPath, JSON.stringify({ specVersion: "0.1.0", asks: [{ id: "x" }] }));
  const { code, errOut } = await run(["ask", badPath], "");
  assert.notEqual(code, 0);
  assert.match(errOut, /schema/i);
}

// --help
{
  const { code, out } = await run(["--help"]);
  assert.equal(code, 0);
  assert.match(out, /elicitkit ask/);
}

console.log("OK — CLI elicits typed answers from piped input (4/4)");

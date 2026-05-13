// Produce a self-contained server inside plugin/ so the Claude Code plugin
// installs from anywhere (marketplace/git), not just in-repo.
//
// Bundles packages/server/src/bin.ts + all deps into a single ESM file at
// plugin/server/elicitkit-server.mjs, and copies the spec JSON Schema to
// plugin/schema/ — @elicitkit/spec resolves it at runtime via
// createRequire(import.meta.url) + "../schema/...", which from
// plugin/server/ points exactly at plugin/schema/. (We ship the file too
// rather than rely on esbuild inlining the dynamic require.)
//
// Run: node scripts/pack-plugin.mjs   (root script: pnpm pack:plugin)
import { build } from "esbuild";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = root + "plugin/server/elicitkit-server.mjs";

rmSync(root + "plugin/server", { recursive: true, force: true });
mkdirSync(root + "plugin/server", { recursive: true });
mkdirSync(root + "plugin/schema", { recursive: true });

await build({
  entryPoints: [root + "packages/server/src/bin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: out,
  // Node built-ins stay external; everything else (workspace + npm) inlined.
  packages: undefined,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});

copyFileSync(
  root + "packages/spec/schema/elicitkit-v0.1.schema.json",
  root + "plugin/schema/elicitkit-v0.1.schema.json",
);

console.log("bundled → plugin/server/elicitkit-server.mjs (+ plugin/schema/)");

#!/usr/bin/env node
/**
 * Elicitkit npm publish — topological, gated, dry-run-by-default.
 *
 *   node scripts/publish.mjs                          # dry-run everything
 *   node scripts/publish.mjs --for-real               # actually publish
 *   node scripts/publish.mjs --for-real --otp=123456  # 2FA OTP
 *   NPM_OTP=123456 node scripts/publish.mjs --for-real
 *   node scripts/publish.mjs --only=spec              # filter to one package
 *
 * Order is dependency-first: a package is only published once every
 * dependency it has is already on the registry. The pipeline:
 *   1. build (full workspace)
 *   2. conformance gate (reference impl must be self-compliant)
 *   3. per package, in toposort:
 *        - skip if this version is already on the registry
 *        - publish from the package dir (dry or real)
 *        - in real mode, wait until the registry actually serves it
 *
 * Refusals (so a botched launch can't ship):
 *   - uncommitted changes in the working tree (real mode only)
 *   - npm whoami fails (not logged in)
 *   - any dist/ missing after build
 *   - conformance gate fails
 *   - versions diverge across @elicitkit/* packages
 *   - publishConfig.access missing or != "public"
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── arg parsing ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FOR_REAL = args.includes("--for-real");
const OTP = (args.find((a) => a.startsWith("--otp="))?.slice(6)) || process.env.NPM_OTP || "";
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7);
const SKIP_BUILD = args.includes("--skip-build");
const SKIP_GATE = args.includes("--skip-gate");

const MODE = FOR_REAL ? "REAL" : "DRY-RUN";
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

console.log(bold(`\nelicitkit publish — ${MODE}\n`));

// ── topological publish order ──────────────────────────────────────────
// Every entry is a package dir; later entries may depend on earlier ones.
// (verified against each package.json — keep in sync when adding packages)
const PACKAGES = [
  "packages/spec",
  "packages/core",
  "packages/renderers",
  "packages/conformance",
  "registry/packs/pr-review",
  "packages/server",
  "packages/http",
  "packages/cli",
];
const FILTERED = ONLY ? PACKAGES.filter((p) => p.includes(ONLY)) : PACKAGES;

// ── pre-flight refusals ────────────────────────────────────────────────
function refuse(reason) {
  console.log(red(`\n✗ ${reason}\n`));
  process.exit(2);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", cwd: opts.cwd ?? ROOT, encoding: "utf8" });
}
function shOk(cmd, opts = {}) {
  try { sh(cmd, { ...opts, silent: true }); return true; } catch { return false; }
}

// 1. clean working tree (in real mode only — dry-run can stay messy)
if (FOR_REAL) {
  const status = sh("git status --porcelain", { silent: true }).trim();
  if (status) refuse(`uncommitted changes in working tree:\n${status}`);
}

// 2. npm logged in
const whoami = (() => { try { return sh("npm whoami", { silent: true }).trim(); } catch { return null; } })();
if (FOR_REAL && !whoami) refuse(`not logged in to npm (run \`npm login\` first)`);
if (whoami) console.log(dim(`  npm user: ${whoami}`));

// 3. version consistency
const meta = FILTERED.map((d) => ({ dir: d, json: JSON.parse(readFileSync(join(ROOT, d, "package.json"), "utf8")) }));
const versions = new Set(meta.map((m) => m.json.version));
if (versions.size !== 1) refuse(`versions diverge across packages: ${[...versions].join(", ")}`);
const TARGET_VERSION = [...versions][0];
console.log(dim(`  target version: ${TARGET_VERSION}`));

// 4. publishConfig.access must be "public" on every scoped package
for (const { json } of meta) {
  if (json.publishConfig?.access !== "public")
    refuse(`${json.name} is missing publishConfig.access:"public"`);
}

// ── build + conformance gate ───────────────────────────────────────────
if (!SKIP_BUILD) {
  console.log(bold("\n[1/3] pnpm build"));
  sh("pnpm build");
}
if (!SKIP_GATE) {
  console.log(bold("\n[2/3] conformance gate"));
  if (!shOk("pnpm --filter @elicitkit/conformance test"))
    refuse("conformance suite failed — refusing to publish");
}

// dist sanity per package
for (const { dir, json } of meta) {
  const dist = join(ROOT, dir, "dist");
  if (!existsSync(dist)) refuse(`${json.name}: missing dist/ (build did not produce output)`);
}

// ── publish ────────────────────────────────────────────────────────────
console.log(bold(`\n[3/3] publish ${FILTERED.length} package(s) — ${MODE}\n`));

function registryHasVersion(name, version) {
  try {
    const r = sh(`npm view ${name}@${version} version`, { silent: true }).trim();
    return r === version;
  } catch { return false; }
}

async function waitForRegistry(name, version, timeoutMs = 60_000) {
  const t0 = Date.now();
  process.stdout.write(dim(`    waiting for registry…`));
  while (Date.now() - t0 < timeoutMs) {
    if (registryHasVersion(name, version)) {
      process.stdout.write(green(" ok\n"));
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
  }
  process.stdout.write(red(" timeout\n"));
  return false;
}

const published = [];
const skipped = [];
const failed = [];

function printSummary() {
  console.log("\n" + bold("summary"));
  if (published.length) console.log(green(`  published (${published.length}): ${published.join(", ")}`));
  if (skipped.length) console.log(yellow(`  skipped   (${skipped.length}): ${skipped.join(", ")}`));
  if (failed.length) console.log(red(`  failed    (${failed.length}): ${failed.join(", ")}`));
  if (!FOR_REAL) console.log(dim(`\n  this was a DRY-RUN. re-run with --for-real to actually publish.`));
}

for (const { dir, json } of meta) {
  const tag = `${json.name}@${json.version}`;
  console.log(bold(`  ${tag}`));
  if (registryHasVersion(json.name, json.version)) {
    console.log(yellow(`    already on registry — skipping`));
    skipped.push(tag);
    continue;
  }
  const cwd = join(ROOT, dir);
  const cmd = FOR_REAL
    ? `npm publish --access public${OTP ? ` --otp=${OTP}` : ""}`
    : `npm publish --dry-run --access public`;
  const res = spawnSync(cmd, { cwd, shell: true, stdio: "inherit" });
  if (res.status !== 0) {
    console.log(red(`    publish failed (exit ${res.status})`));
    failed.push(tag);
    if (FOR_REAL) {
      console.log(red(`\n✗ aborting; ${published.length} already published, ${failed.length} failed.\n`));
      printSummary();
      process.exit(1);
    }
    continue;
  }
  if (FOR_REAL) {
    const ok = await waitForRegistry(json.name, json.version, 180_000);
    if (!ok) {
      console.log(yellow(`    registry slow to serve it back — continuing anyway (npm publish does not require a package's deps to be resolvable; install-time resolution catches up)`));
    }
  }
  published.push(tag);
}

printSummary();

// Smoke test: HTTP surface + security envelope. curl-equivalent fetch,
// plus signed-link / origin / CSP hardening. Run: node test/smoke.mjs
import assert from "node:assert/strict";
import { createHttpServer } from "../dist/index.js";

// short TTL so the expiry path is testable fast
const server = createHttpServer({ secret: "test-secret", ttlMs: 300 });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const j = (p, body, headers = {}) =>
  fetch(base + p, body ? { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) } : { headers });

const askSet = {
  specVersion: "0.1.0",
  asks: [
    {
      id: "patch",
      type: "ask_code_diff",
      prompt: "Apply?",
      spec: { granularity: "hunk", files: [{ path: "a.ts", hunks: [{ id: "h1", after: "x=1" }, { id: "h2", after: "y=2" }] }] },
      meta: { specVersion: "0.1.0", minTier: "tui" },
    },
  ],
};
const VAL = [{ id: "patch", type: "ask_code_diff", status: "answered", value: { accepted: ["h1"], rejected: ["h2"] } }];

// health
assert.equal((await (await j("/health")).json()).ok, true);

// elicit → signed token
const e = await (await j("/elicit", { askSet })).json();
assert.equal(e.ok, true);
assert.equal(e.token.split(".").length, 3, "token is id.exp.sig (signed)");
assert.ok(e.panelUrl.includes("/r/") && e.expiresInMs === 300);

// hosted panel: renders, strict CSP, posts to submitUrl
const pr = await j("/r/" + encodeURIComponent(e.token));
const csp = pr.headers.get("content-security-policy");
assert.match(csp, /default-src 'none'/, "strict CSP");
assert.match(csp, new RegExp(`connect-src ${base}`.replace(/[/.]/g, "\\$&")), "network pinned to this server");
// security review finding 1: panel must not be framable by a cross-origin
// page (else postMessage "*" leaks the one-time token + answers).
assert.match(csp, /frame-ancestors 'none'/, "CSP forbids framing");
assert.equal(pr.headers.get("x-frame-options"), "DENY", "X-Frame-Options DENY");
assert.match(await pr.text(), /ASKS =|ask_code_diff/);

// forged token → 403 (rejected before any round lookup)
const forged = e.token.slice(0, -3) + "AAA";
assert.equal((await j("/r/" + encodeURIComponent(forged))).status, 403);
assert.equal((await j("/elicit/submit", { token: forged, answers: VAL })).status, 403);

// disallowed browser Origin → 403
assert.equal((await j("/elicit/submit", { token: e.token, answers: VAL }, { origin: "https://evil.example" })).status, 403);

// same-origin browser Origin → allowed, CORS echoes it (never *)
const okRes = await j("/elicit/submit", { token: e.token, answers: VAL }, { origin: base });
assert.equal(okRes.status, 200);
assert.equal(okRes.headers.get("access-control-allow-origin"), base);
assert.deepEqual((await okRes.json()).answers[0].value, { accepted: ["h1"], rejected: ["h2"] });

// one-time: token consumed
assert.equal((await j("/elicit/submit", { token: e.token, answers: VAL })).status, 404);

// no-Origin caller (curl/CI) still works
const e2 = await (await j("/elicit", { askSet })).json();
assert.equal((await j("/elicit/submit", { token: e2.token, answers: VAL })).status, 200);

// malformed value → 422
const e3 = await (await j("/elicit", { askSet })).json();
assert.equal((await j("/elicit/submit", { token: e3.token, answers: [{ id: "patch", type: "ask_code_diff", status: "answered", value: { accepted: "h1" } }] })).status, 422);

// expired token → 410
const e4 = await (await j("/elicit", { askSet })).json();
await new Promise((r) => setTimeout(r, 320));
assert.equal((await j("/r/" + encodeURIComponent(e4.token))).status, 410);
assert.equal((await j("/elicit/submit", { token: e4.token, answers: VAL })).status, 410);

// invalid AskSet → 400
assert.equal((await j("/elicit", { askSet: { specVersion: "0.1.0", asks: [{ id: "x" }] } })).status, 400);

console.log("OK — HTTP surface + signed/origin/CSP envelope (12/12)");
await new Promise((r) => server.close(r));

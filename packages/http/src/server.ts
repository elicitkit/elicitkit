import http from "node:http";
import {
  validateAskSet,
  validateAnswers,
  signToken,
  verifyToken,
  newSecret,
  newRoundId,
  type AskSet,
} from "@elicitkit/core";
import { buildPanelHtml, renderTui } from "@elicitkit/renderers";

/**
 * The HTTP surface with the security envelope designed in, not retrofitted
 * (watchpoint #5). Defence in depth:
 *
 *  - **Signed one-time links** — tokens are HMAC-signed with a TTL; a forged
 *    or expired token is rejected *before* any round lookup. One round per
 *    token; consumed on submit.
 *  - **Origin allowlist** — browser POSTs (Origin header present) must come
 *    from an allowed origin; CORS echoes that origin, never `*`. Non-browser
 *    callers (curl, CI — no Origin) are unaffected.
 *  - **Strict CSP** on the panel — `default-src 'none'`, network limited to
 *    this server: rendered ask content cannot exfiltrate or phone home.
 *  - **Loopback by default**, zero telemetry (watchpoint #6 — nothing here
 *    ever calls out).
 */
export interface HttpServerOptions {
  name?: string;
  version?: string;
  /** HMAC secret. Default: ELICITKIT_SECRET, else random per-process. */
  secret?: string;
  /** Signed-link lifetime. Default: ELICITKIT_TTL_MS or 15 min. */
  ttlMs?: number;
  /** Extra browser origins allowed to POST answers (besides same-origin). */
  allowedOrigins?: string[];
}

export function createHttpServer(opts: HttpServerOptions = {}): http.Server {
  const name = opts.name ?? "elicitkit-http";
  const version = opts.version ?? "0.1.0";
  const secret = opts.secret ?? process.env.ELICITKIT_SECRET ?? newSecret();
  const ttlMs =
    opts.ttlMs ?? Number(process.env.ELICITKIT_TTL_MS ?? 15 * 60 * 1000);
  const extraOrigins = new Set([
    ...(opts.allowedOrigins ?? []),
    ...(process.env.ELICITKIT_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ]);

  // round id -> AskSet. The token (signed id) is what crosses the wire.
  const rounds = new Map<string, AskSet>();

  function send(
    res: http.ServerResponse,
    code: number,
    body: unknown,
    origin?: string,
  ): void {
    const headers: http.OutgoingHttpHeaders = { "content-type": "application/json" };
    if (origin) headers["access-control-allow-origin"] = origin;
    res.writeHead(code, headers);
    res.end(JSON.stringify(body));
  }

  function readJson(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let buf = "";
      req.on("data", (c) => {
        buf += c;
        if (buf.length > 1_000_000) reject(new Error("payload too large"));
      });
      req.on("end", () => {
        try {
          resolve(buf ? JSON.parse(buf) : {});
        } catch {
          reject(new Error("invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const base = `${url.protocol}//${url.host}`;
    const method = req.method ?? "GET";
    const origin = req.headers.origin;
    // Same-origin (the hosted panel) is always allowed; plus configured extras.
    const originOk = (o: string | undefined): boolean =>
      o === undefined || o === base || extraOrigins.has(o);

    if (method === "OPTIONS") {
      const h: http.OutgoingHttpHeaders = {
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      if (origin && originOk(origin)) h["access-control-allow-origin"] = origin;
      res.writeHead(204, h);
      return res.end();
    }

    if (method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, name, version });
    }

    // POST /elicit  { askSet }  → signed one-time token + links
    if (method === "POST" && url.pathname === "/elicit") {
      let body: { askSet?: unknown };
      try {
        body = (await readJson(req)) as { askSet?: unknown };
      } catch (e) {
        return send(res, 400, { ok: false, errors: [String((e as Error).message)] });
      }
      const v = validateAskSet(body.askSet);
      if (!v.ok) return send(res, 400, { ok: false, errors: v.errors });

      const set = body.askSet as AskSet;
      const id = newRoundId();
      rounds.set(id, set);
      const token = signToken(secret, id, ttlMs);
      return send(res, 200, {
        ok: true,
        token,
        expiresInMs: ttlMs,
        text: renderTui(set, token).text,
        panelUrl: `${base}/r/${encodeURIComponent(token)}`,
        submitUrl: `${base}/elicit/submit`,
      });
    }

    // GET /r/:token  → hosted url-tier panel (verify before lookup)
    const m = url.pathname.match(/^\/r\/([^/]+)$/);
    if (method === "GET" && m) {
      const token = decodeURIComponent(m[1]!);
      const vr = verifyToken(secret, token);
      if (!vr.ok) {
        res.writeHead(vr.reason === "expired" ? 410 : 403, { "content-type": "text/plain" });
        return res.end(`link ${vr.reason}`);
      }
      const set = rounds.get(vr.id);
      if (!set) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("unknown or consumed round");
      }
      const html = buildPanelHtml(set, token, "url", {
        submitUrl: `${base}/elicit/submit`,
      });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // Network is limited to THIS server; no external script/img/style.
        // frame-ancestors 'none' + X-Frame-Options stop a cross-origin page
        // from iframing the panel and harvesting the one-time token /
        // answers off postMessage (security review, finding 1).
        "content-security-policy":
          "default-src 'none'; " +
          "style-src 'unsafe-inline'; " +
          "script-src 'unsafe-inline'; " +
          `connect-src ${base}; ` +
          "img-src data:; base-uri 'none'; form-action 'none'; " +
          "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      return res.end(html);
    }

    // POST /elicit/submit  { token, answers }
    if (method === "POST" && url.pathname === "/elicit/submit") {
      if (!originOk(origin)) {
        return send(res, 403, { ok: false, errors: ["origin not allowed"] });
      }
      let body: { token?: unknown; answers?: unknown };
      try {
        body = (await readJson(req)) as { token?: unknown; answers?: unknown };
      } catch (e) {
        return send(res, 400, { ok: false, errors: [String((e as Error).message)] }, origin);
      }
      const token = typeof body.token === "string" ? body.token : "";
      const vr = verifyToken(secret, token);
      if (!vr.ok) {
        const code = vr.reason === "expired" ? 410 : 403;
        return send(res, code, { ok: false, errors: [`link ${vr.reason}`] }, origin);
      }
      const set = rounds.get(vr.id);
      if (!set) return send(res, 404, { ok: false, errors: ["unknown or consumed round"] }, origin);

      const r = validateAnswers(set, body.answers);
      if (!r.ok) return send(res, 422, { ok: false, errors: r.errors }, origin);
      rounds.delete(vr.id); // one-time
      return send(res, 200, { ok: true, answers: r.answers }, origin && originOk(origin) ? origin : undefined);
    }

    return send(res, 404, { ok: false, errors: ["not found"] });
  });
}

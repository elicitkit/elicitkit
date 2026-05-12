import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed one-time-link tokens (security watchpoint #5). A token is
 * `b64url(id).b64url(expiryMs).b64url(HMAC-SHA256)` — unguessable *and*
 * tamper-evident: a surface can reject a forged or expired token before any
 * round lookup, so an attacker cannot probe round state. Pure node:crypto,
 * zero deps; shared by every surface that exposes links.
 */

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

/** A fresh random secret, for servers that don't pin ELICITKIT_SECRET. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** A fresh unguessable round id (128-bit). */
export function newRoundId(): string {
  return randomBytes(16).toString("base64url");
}

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

/** Sign `id` with an absolute expiry `ttlMs` from now. */
export function signToken(secret: string, id: string, ttlMs: number): string {
  const exp = String(Date.now() + ttlMs);
  const body = `${b64url(id)}.${b64url(exp)}`;
  return `${body}.${b64url(mac(secret, body))}`;
}

export type VerifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

/** Verify signature (constant-time) then expiry. Never throws. */
export function verifyToken(secret: string, token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [idB64, expB64, sigB64] = parts as [string, string, string];
  const body = `${idB64}.${expB64}`;

  let sig: Buffer;
  let expected: Buffer;
  try {
    sig = Buffer.from(sigB64, "base64url");
    expected = mac(secret, body);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  const exp = Number(Buffer.from(expB64, "base64url").toString("utf8"));
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, id: Buffer.from(idB64, "base64url").toString("utf8") };
}

# Security Policy

## Reporting

Please report suspected vulnerabilities **privately** — do not open a public issue.

- **Preferred:** GitHub → repository **Security** tab → *Report a vulnerability* (Private Vulnerability Reporting).
- **Email:** security@elicitkit.com *(TODO: confirm before launch)*.

Please include affected version/commit, a description, and minimal reproduction. We aim to acknowledge within **3 business days** and to agree a coordinated disclosure timeline. There is no paid bug-bounty program.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (pre-release) | ✅ |
| < 0.1 | ❌ |

## Security model (what we defend)

Designed in from the start, not retrofitted:

- **Signed one-time links** — HMAC-SHA256 + absolute TTL, constant-time verification; forged/expired links are rejected before any state lookup.
- **Origin allowlist** on answer submission; CORS echoes the specific origin, never `*`. Non-browser callers (no `Origin`) are unaffected by design.
- **Strict CSP** on the panel (`default-src 'none'`, network pinned to the issuing server) plus `frame-ancestors 'none'` / `X-Frame-Options: DENY`; a `<meta>` CSP also covers the `data:`/file delivery channels.
- **Safe-color validation** — `SelectOption.color`, `ask_color` palettes, and `meta.accent` are constrained by schema + a render-time guard (no `url()`/`var()` injection).
- **Loopback default**, **zero telemetry**.

Untrusted input boundary: an `AskSet` is treated as agent-/tool-produced content rendered to a human; the renderers keep ask content `textContent`-inert. The conformance corpus encodes these invariants and regression-guards them.

## Out of scope

Denial of service / resource exhaustion, issues requiring control of trusted environment variables or CLI flags, and findings only in tests or documentation.

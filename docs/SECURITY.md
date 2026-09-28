# Security

This document describes the security model and the results of the OWASP-oriented review performed during development. Report vulnerabilities privately to the platform operator; do not open public issues.

## 1. Threat model (summary)

| Actor | Main risks addressed |
| --- | --- |
| Anonymous visitor | Scraping internal prices, abuse of search/AI budget, uploads carrying malware, SSRF via product URLs |
| Customer | Seeing supplier identity/internal cost/margins, reading another company's quotes, forging approvals |
| Partner (customs broker, lab, forwarder) | Reading customer or financial data beyond the assigned task |
| Tenant staff / admin | Reaching another tenant; reaching the internal network through connector URLs; changing bank details or margins without re-authentication |
| Super admin | Unaudited access to tenant data (impersonation) |
| Infrastructure | Stolen DB dump (secrets), leaked environment variables, TLS for arbitrary hostnames |

## 2. Controls

### Tenancy and authorisation
- Tenant from host; sessions bound to one tenant; **PostgreSQL RLS forced** on every tenant table with a runtime role that cannot bypass it (fail-closed when no tenant is set). Verified by tests that run raw SQL across tenants and assert RLS on all tables.
- RBAC permission matrix in `@sos/core` (`permissions.ts`) + ABAC checks (customer ↔ own company's projects; partner ↔ assigned tasks only).
- Customer responses are produced by **allow-list serializers**; internal cost, supplier secrets, margins, internal notes and unverified compliance states are never serialized for customers. Tests assert the absence of these fields in customer payloads.

### Authentication
- Passwords: argon2id (19 MiB, t=2), minimum length 10; generic error messages (no user enumeration); account lockout after 5 failures (15 min) and per-IP rate limits on login, MFA and step-up.
- Sessions: random 256-bit tokens stored hashed; `HttpOnly`, `SameSite=Lax`, `Secure` in production; idle and absolute expiry; rotation every 15 minutes with a 60 s grace window; revocation on password change, user disable and tenant suspension; users can list and revoke sessions.
- **MFA**: TOTP (RFC 6238) with one-time recovery codes. **Mandatory for super admins** (platform APIs return 403 until enabled; cannot be disabled). Used codes are remembered for their validity window (**replay protection**). WebAuthn passkeys supported.
- **Step-up** re-authentication (password or TOTP, 10-minute window) for `tenant.bank.write`, `tenant.connections.write`, `margin.manage`.
- Invitations: single-use, hashed, 7-day tokens. Impersonation: super admin only, reason required, 60-second one-time link, 1-hour session, every action audited with `impersonator_id`, visible banner.

### Web
- CSRF: double-submit token (`x-csrf-token` header must match the `sos_csrf` cookie) **and** Origin/Referer check on every state-changing request.
- CSP (`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy; Helmet on the API.
- Output encoding by React; no `dangerouslySetInnerHTML` except the static theme bootstrap script. Tenant-editable links are validated (`isSafeHref`: relative, http(s), mailto, tel only). Email/document template previews render in `sandbox=""` iframes.
- Open redirects: `next`/`to` parameters accept same-origin paths only (`//host` and `/\host` rejected) — covered by unit and E2E tests.

### Server-side requests (SSRF)
- All outbound HTTP goes through `safeFetch`: http(s) only, no credentials in URLs, private/loopback/link-local/CGNAT/multicast blocked, **address checked again at connect time** (undici dispatcher lookup → DNS rebinding cannot bypass the pre-check), redirects handled manually and re-validated per hop, response size limits.
- Tenant-configured connector endpoints may reach internal hosts **only** if the operator lists them in `INTERNAL_HOST_ALLOWLIST` (default `ai-worker`); cloud metadata addresses are always blocked.
- Product-URL previews respect `robots.txt`.

### Files
- Private storage; downloads via short-lived signed URLs (HMAC for local disk, presigned for S3) after an authorization check.
- Uploads: size limit, **magic-byte detection** with a per-purpose MIME allow-list (no SVG/HTML), optional ClamAV INSTREAM scan, image re-encoding in the AI worker with decompression-bomb limits.
- CSV/XLSX exports neutralise formula injection (`=`, `+`, `-`, `@`).

### Secrets
- Connector secrets encrypted with AES-256-GCM (per-installation master key) or stored in Vault KV v2 / Infisical; only the last 4 characters are ever shown; rotation keeps history; audit logs scrub secret-like keys (masked `****1234` values are kept for traceability).
- Service secrets (`APP_SIGNING_KEY`, `SECRETS_MASTER_KEY`, worker token) can be supplied via `*_FILE`; `docker compose` generates them into a dedicated volume. Production refuses to start without them, and refuses `DEV_MODE=true`.
- No real keys are committed (`.env.example` only).

### Integrity and audit
- Append-only tables for audit logs, approvals, compliance reviews, overrides, consents, documents and contract versions (UPDATE/DELETE revoked at the database level). Issued quote versions are immutable (trigger).
- Approvals record user, time, IP, user agent, version and **document SHA-256**; stale-version approvals are rejected.
- Money uses decimal arithmetic end to end.
- Idempotency keys on critical state changes.

### Operations
- Rate limits (global + per-route), request IDs, structured logs without secrets, health endpoints that hide internal errors publicly.
- On-demand TLS is issued only for the platform host, active tenant subdomains and **DNS-verified** custom domains (`/api/v1/internal/tls-allowed`).
- AI: provider circuit breaker, per-tenant monthly token budget, AI output never trusted for calculations.

## 3. OWASP Top 10 (2021) review

| Category | Status | Evidence |
| --- | --- | --- |
| A01 Broken access control | Mitigated | RLS + RBAC/ABAC; tenant-isolation, RBAC, partner and customer-payload tests; E2E cross-tenant checks |
| A02 Cryptographic failures | Mitigated | argon2id, AES-256-GCM, HMAC signed URLs, TLS at the edge, secure cookies in production |
| A03 Injection | Mitigated | Drizzle parameterised queries; zod validation on every route; Handlebars escaping; CSV formula guard |
| A04 Insecure design | Mitigated | Estimated/verified/actual separation, immutable versions, step-up for sensitive changes, DEV mocks blocked in production |
| A05 Security misconfiguration | Mitigated | Production startup guards, CSP/Helmet, private buckets, non-root containers |
| A06 Vulnerable components | Process | Pinned lockfile; run `pnpm audit` and `pip-audit` in CI; see LICENSE-THIRD-PARTY |
| A07 Identification & authentication | Mitigated | Lockout, rate limits, MFA (mandatory for super admins), TOTP replay guard, session rotation/revocation |
| A08 Software & data integrity | Mitigated | Document hashes on approvals, append-only audit, signed webhooks (`X-SOS-Signature`, timestamped HMAC-SHA256) |
| A09 Logging & monitoring | Mitigated | Audit log (tenant + platform), job dead-letter queue, system-status page, request IDs |
| A10 SSRF | Mitigated | `safeFetch` pre-check + connect-time validation + allow-list; unit tests including redirect-to-metadata |

### Issues found and fixed during the review
1. Open redirect in `/preview?to=` and login `next` → same-origin path validation.
2. Tenant-configured connectors bypassed SSRF checks (`trusted`) → operator allow-list + connect-time address validation; metadata IPs always blocked.
3. TOTP codes could be replayed within their 30-second window → used-code cache.
4. Tenant-editable links accepted any scheme → `isSafeHref` validation.
5. Floating-point arithmetic in forwarder quote totals, FX parsing and MRR → `Decimal`.
6. Super admin with pending MFA setup triggered 403 calls from the security page → UI only loads protected data after MFA is configured.

## 4. Residual risks and recommendations
- Bank account numbers are visible to users with `tenant.settings.read` (needed to print on invoices); restrict that permission to finance/admin roles.
- `script-src 'unsafe-inline'` is required by the Next.js runtime without nonces; moving to nonce-based CSP via middleware is recommended for high-assurance deployments.
- Malware scanning is optional (enable the `security` profile / `CLAMAV_HOST` in production).
- Run dependency scanning and container image scanning (e.g. Trivy) in CI; enable PostgreSQL TLS when the database is not on a private network.

# API

REST API v1 under `/api/v1`. The full, generated specification is in [`openapi.json`](openapi.json) (173 paths; regenerate with `pnpm --filter @sos/api openapi`). In development the interactive Swagger UI is served at `/api/docs` (disabled in production).

## Conventions

| Topic | Rule |
| --- | --- |
| Tenant | Resolved from the `Host` / `X-Forwarded-Host` header (subdomain or verified custom domain). There is no tenant id in URLs. |
| Auth | Session cookie `sos_session` (HttpOnly). Login: `POST /auth/login`, then `POST /auth/mfa/verify` when `mfaPending`. |
| CSRF | Every non-GET request must send `x-csrf-token` equal to the `sos_csrf` cookie, and a same-site `Origin`. |
| Step-up | Endpoints guarded by `tenant.bank.write`, `tenant.connections.write`, `margin.manage` return `403 STEP_UP_REQUIRED` unless the session re-authenticated in the last 10 minutes (`POST /auth/step-up` with password or TOTP code). The web client prompts automatically. |
| Idempotency | Send `Idempotency-Key: <uuid>` on issue/approve/payment/invoice/RFQ-reply calls. A replay returns the original response with `Idempotent-Replayed: true`; reusing a key with a different body → `422 IDEMPOTENCY_MISMATCH`. |
| Validation | Bodies/queries validated with zod. Errors: `{ code, message, details, requestId }` (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_TRANSITION`, `STALE_VERSION`, `RATE_LIMITED`, `DUPLICATE`…). Messages are Korean and safe to show. |
| Money | Decimal **strings** (`"12345.6700"`) with a currency field — never JSON numbers. |
| Audience | The same endpoint may return different shapes for staff and customers (e.g. `/projects/:id/overview`, `/quotations/:id`); customer shapes never contain internal cost, supplier identity or margins. |
| Rate limits | Global per-IP limit plus stricter limits on auth, uploads and anonymous search (`429 RATE_LIMITED`). |

## Main resources

### Public / anonymous
- `GET /public/site` — white-label configuration (brand, company info for the footer, homepage sections, policies list, enabled features). No secrets, no bank data.
- `GET /public/policies/:type`, `GET /public/assets/:fileId` (brand assets only).
- `POST /sourcing/requests` (multipart: `images[]`, `query`, `url`, `quantity`, options) → `{ requestId, accessToken }` for anonymous users.
- `GET /sourcing/requests/:id/status` · `GET /sourcing/requests/:id/result?token=` — progressive result (customer shape).
- `POST /sourcing/requests/:id/claim` — attach an anonymous request to the signed-in customer.

### Auth & account
`/auth/login`, `/auth/logout`, `/auth/me`, `/auth/mfa/{setup,enable,verify,disable}`, `/auth/step-up`, `/auth/password`, `/auth/sessions`, `/auth/passkeys/*`, `/auth/invite/accept`, `/auth/impersonate/consume`.

### Sourcing (staff)
- `GET /projects`, `GET /projects/:id/overview`
- `GET /sourcing/requests/:id/result` (staff shape: scores, evidence, internal cost), `POST /sourcing/requests/:id/rerun`
- `PATCH /candidates/:id` (pin/hide/select/notes), `GET /candidates/:id/costs`, `POST /candidates/:id/estimate`, `POST /pricing-snapshots/:id/final-price` (admin final price + reason; calculated price kept)
- `POST /products/:id/attributes` (override with reason — AI value kept), `POST /products/:id/hs/verify`, `POST /compliance-checks/:id/review`
- `GET/POST /suppliers`, `/suppliers/:id/{contacts,events,listings}`, `PATCH /listings/:id`
- `GET /regulations`, `POST /regulations`, `POST /regulations/:id/versions` (returns impact), `GET /tariff-rates`, `POST /tariff-rates/import`
- `GET/POST /freight/rates`, `POST /projects/:id/freight-rfqs`, `POST /freight-rfqs/:id/quotes`, `POST /projects/:id/freight-actuals`
- `GET/POST /fx/rates`, `POST /fx/refresh`
- `GET /partners`, `POST /partner-tasks`, `GET /partner-tasks`

### Commerce
- Quotes: `POST /projects/:id/quotations`, `PUT /quotations/:id/draft`, `POST /quotations/:id/{review,issue,versions,final-approve,reject,contract}`, `POST /quotations/:id/customer-decision` (customer), `GET /quotations`, `GET /quotations/:id`
- Contracts: `PUT /contracts/:id/clauses`, `POST /contracts/:id/{send,legal-review,customer-approve,company-approve,cancel}`, `GET /contracts/:id`
- Invoices/payments: `POST /projects/:id/invoices`, `POST /projects/:id/payments`, `PATCH /payments/:id`
- Orders: `POST /projects/:id/purchase-orders`, `PATCH /production-orders/:id`, `POST /projects/:id/inspections`, `PATCH /inspections/:id`
- Shipments: `POST /projects/:id/shipments`, `PATCH /shipments/:id`, `POST /shipments/:id/{containers,vessels,events,customs,delivery,refresh}`, `GET /shipments`, `GET /shipments/:id`
- Documents & files: `GET /documents/:id/url`, `POST /files`, `GET /files/:id/url`

### Portals
- Customer: `/portal/*` pages use the endpoints above with customer shapes, plus `/notifications*`, `/me/company`.
- Partner: `GET /partner/tasks`, `GET /partner/tasks/:id`, `POST /partner/tasks/:id/start` and the review endpoints for their assigned task only.

### Administration
`/admin/settings/:section` (+ `/draft`, `/publish`), `/admin/setup`, `/admin/domains*`, `/admin/bank-accounts*`, `/admin/connections*` (+ `/catalog`, `/:id/test`), `/admin/users*`, `/admin/policies`, `/admin/email-templates*`, `/admin/document-templates*`, `/admin/webhooks*`, `/admin/margin` (+ `/draft`, `/simulate`, `/publish`), `/admin/dashboard`, `/admin/audit`, `/admin/jobs*`, `/admin/system-status`, `/admin/emails`, `/admin/export/:entity`, `/admin/import/:entity`, `/analytics/{summary,accuracy,feedback,demand,discovery}`, `/crm/companies*`.

### Platform (super admin, MFA required)
`/platform/dashboard`, `/platform/tenants` (+ `PATCH`, `/feature-flags`, `/impersonate`), `/platform/plans`, `/platform/audit`.

### Operations
`GET /health/live`, `GET /health`, `GET /internal/tls-allowed?domain=` (edge proxy only).

## Webhooks (outbound)

`POST` to the subscriber URL with JSON `{ id, event, occurredAt, tenant, data }` and headers `X-SOS-Event`, `X-SOS-Delivery`, `X-SOS-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. Verify the signature and reject timestamps older than 5 minutes. Deliveries are retried with backoff and listed in *설정 → 웹훅*. Payloads never include internal cost or margin fields.

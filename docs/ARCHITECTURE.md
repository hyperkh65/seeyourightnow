# Architecture

## 1. Components

```
                 ┌──────────── Browser (tenant host: <slug>.<base> or custom domain) ────────────┐
                 │  Public site · Customer portal · Admin · Partner portal · Platform console      │
                 └──────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ HTTPS (Caddy on-demand TLS in production)
                          ┌─────────────────────▼─────────────────────┐
                          │ web  (Next.js, standalone)                │  /api/v1/* is rewritten to the API
                          │  server components call the API with the  │  (X-Forwarded-Host preserved → tenant)
                          │  user's cookie; no secrets in the browser  │
                          └─────────────────────┬─────────────────────┘
                                                │
┌───────────────────────────────────────────────▼───────────────────────────────────────────────┐
│ api  (Fastify 5, zod schemas, OpenAPI)                                                        │
│  request context → tenant (host) → session (cookie) → RBAC/ABAC → withTenant(tx) → RLS        │
│  modules: auth · public · sourcing · trade · quotes · fulfillment · shipments · crm · portal  │
│           partner · admin · insights · import/export · platform                              │
│  services: pricing · compliance · hs · fx · documents(PDF) · notify · workflow · tracking     │
│            connectors (registry) · AI router · vision · storage · secrets · audit · jobs      │
└───────┬──────────────────────┬──────────────────────┬──────────────────────┬──────────────────┘
        │                      │                      │                      │
┌───────▼───────┐    ┌─────────▼────────┐   ┌─────────▼────────┐   ┌─────────▼────────┐
│ PostgreSQL 16 │    │ Valkey (Redis)   │   │ worker           │   │ ai-worker        │
│ pgvector,     │    │ cache, rate-limit│   │ same image as API│   │ FastAPI: segment │
│ pg_trgm, RLS  │    │ counters, TOTP   │   │ job queue +      │   │ OCR · embedding  │
│ job queue     │    │ replay guard     │   │ schedulers       │   │ caption · AIS    │
└───────────────┘    └──────────────────┘   └──────────────────┘   └──────────────────┘
        Gotenberg (HTML→PDF, JS disabled) · optional ClamAV · S3-compatible object storage
```

- **packages/core** holds every deterministic engine (money with `decimal.js`, landed cost, margin rules, freight feasibility, clustering and explainable Best Match, compliance rule evaluation, risk, freshness, numbering, state machines, permission matrix, settings schemas). It has no I/O and is unit-tested in isolation; API and web import the same code.
- **apps/api** is the only component that talks to the database, external APIs and secrets.
- **apps/web** never receives API keys, supplier secrets or internal cost fields: customer-facing API responses are built with allow-list serializers (`services/serializers.ts`).

## 2. Multi-tenancy

| Layer | Mechanism |
| --- | --- |
| Routing | Tenant resolved from the host: `slug.PLATFORM_BASE_DOMAIN` → verified custom domain (`tenant_domains`) → `DEFAULT_TENANT_SLUG`. `PLATFORM_ADMIN_HOST` is the super-admin console. |
| Session | A session belongs to one tenant; a cookie presented on another tenant host is rejected. |
| Database | Every tenant table has `tenant_id` + **forced RLS** (`sos_apply_rls`). Runtime role `sos_app` has `NOBYPASSRLS`; each request runs in a transaction with `set_config('app.tenant_id', …, true)`. The policy fails closed when the setting is missing. Shared reference tables (HS codes, tariff rates, regulations, FX) allow `tenant_id IS NULL` rows read-only. |
| System role | `sos_system` (BYPASSRLS) is used only for login, host resolution, the job poller and platform-admin endpoints. |
| Tests | `test/tenant-isolation.test.ts` checks API-level and raw-SQL isolation and asserts that **every** table with `tenant_id` has RLS enabled and forced. |

## 3. Data integrity rules

- Money is `numeric(20,4)` in the database and `Decimal` in code. No floating point in any price, cost, duty, FX or margin path.
- **Estimated / verified / actual** values are separate columns (e.g. `estimated_hs`, `verified_hs`, `actual_hs`; `estimated_status`, `verified_status`; freight estimate vs RFQ quote vs actual). Humans never overwrite AI values; they add a verified value and the AI value remains for accuracy analytics (`model_predictions`).
- Append-only tables (UPDATE/DELETE revoked): `audit_logs`, `approvals`, `compliance_reviews`, `overrides`, `policy_consents`, `documents`, `contract_versions`.
- Issued quotation versions and their items are immutable (trigger). Changes create a new version; approvals reference the version and the document SHA-256.

## 4. Background work

- **Job queue in PostgreSQL** (`jobs` table, `FOR UPDATE SKIP LOCKED`): states PENDING → RUNNING → SUCCESS / RETRYING → DEAD_LETTER, exponential backoff, stuck-job recovery, dedupe keys, per-tenant context. Admins see and retry jobs in *시스템 상태*.
- **Schedulers** (worker process): FX refresh, quote expiry, change detection (supplier price / regulation / tariff changes affecting open quotes), AIS polling, maintenance and retention.
- **Idempotency**: state-changing endpoints that must not double-fire (quote issue, approvals, payments, invoices, RFQ replies) accept `Idempotency-Key`; replays return the stored response with `Idempotent-Replayed: true`.

### ADR-001: Durable workflow engine — PostgreSQL state machine instead of Temporal (for now)

*Context.* The order lifecycle (quote → contract → deposit → PO → production → inspection → shipment → customs → delivery → settlement) has long human-in-the-loop waits and must survive restarts.

*Decision.* Implement `ORDER_FULFILLMENT` as a DB-persisted workflow (`workflow_instances`) with explicit steps, `waitingFor`, and completion events emitted from domain actions (`completeStep`). Steps are idempotent and replayable. The API mirrors Temporal concepts (workflow id, activities, signals) so the implementation can be swapped.

*Consequences.* No extra infrastructure for small/medium installations and transactional consistency with domain writes. For very high volume or complex compensation logic, migrate to **Temporal** (MIT) — the workflow boundaries already map 1:1 to Temporal workflows/activities.

### ADR-002: Automation (n8n)

Tenants who want no-code automation connect **webhooks** (signed, retried, delivery log) to n8n or any other tool. n8n is *not* embedded: its "Sustainable Use License" is not OSI-approved and restricts offering it as part of a hosted product. It can be run by the customer as a separate service.

### ADR-003: Search

PostgreSQL `pg_trgm` + `pgvector` (HNSW) cover text and image similarity for the expected catalogue size. A dedicated search engine (Meilisearch, MIT) can be added behind the same repository interface when catalogues exceed a few million listings.

## 5. AI and data sources

- **AI router**: primary/fallback per task (text, vision), circuit breaker (3 consecutive failures → 5 min open), token metering (`ai_usage`) and monthly budget. Providers: Groq / OpenAI-compatible / Anthropic, plus the self-hosted AI worker.
- **AI output is advisory.** Structured JSON is validated; unknown attributes stay `UNKNOWN`; calculations are done by `@sos/core`, never by the model.
- **Connectors** implement a common adapter interface with test, rate-limit and error recording. Unavailable sources degrade to: private supply network → manual RFQ. Mock listings exist only when `DEV_MODE=true`, are titled `[DEV MOCK]`, flagged `isDevMock`, ranked after real results and blocked in production by a startup guard.

## 6. Documents

Handlebars templates (isolated instance, escaped output, fixed helper set) → HTML → PDF via Gotenberg (JavaScript disabled) or bundled Chromium with network blocked. Each PDF is stored privately with its SHA-256; approvals record that hash. Templates are versioned per tenant.

## 7. Front-end

Next.js App Router, React Server Components for the public site (SEO, white-label metadata), TanStack Query in the consoles, Tailwind with CSS-variable tokens so each tenant's brand colours/radius/font apply without rebuilds. Settings sections are versioned with Draft → Preview (signed preview token cookie) → Publish.

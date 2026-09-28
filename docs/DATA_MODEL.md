# Data model

PostgreSQL 16 with `pgvector`, `pg_trgm`, `citext`, `pgcrypto`. Schema source: `apps/api/src/db/schema/*.ts` (Drizzle). Migrations: `apps/api/drizzle/` — `0000_init.sql` (generated) and `0001_security.sql` (RLS, grants, triggers, indexes). Never edit the database by hand; change the schema and generate a migration (`pnpm --filter @sos/api db:generate`).

## Conventions

- Primary keys: UUID (`gen_random_uuid()`); timestamps `timestamptz`.
- **`tenant_id` on every tenant-owned table** + forced RLS policy `tenant_id = app_tenant()`. Shared reference rows use `tenant_id IS NULL` (read-only for tenants): `hs_codes`, `tariff_rates`, `regulations`, `regulation_versions`, `fx_rates`, `ports`.
- Money: `numeric(20,4)` + ISO currency column. Percentages as `numeric` strings.
- Provenance on legally/financially significant values: `source`, `verification` (`UNVERIFIED`, `AI_ESTIMATE`, `SYSTEM_CALCULATED`, `PARTNER_VERIFIED`, `EXPERT_VERIFIED`, `ACTUAL`), `confidence`, `collected_at` / `valid_until`.
- Three-value facts stay separate: *estimated* (AI/system) · *verified* (expert) · *actual* (post-shipment). Example: `hs_classifications.estimated_hs / verified_hs / actual_hs`.
- Product attributes are tri-state (`TRUE` / `FALSE` / `UNKNOWN`); overrides are stored in `overrides` with who/why, the AI value is never replaced.

## Tables by domain (92)

### Platform & identity
| Table | Purpose |
| --- | --- |
| `plans`, `subscriptions`, `usage_counters`, `feature_flags` | SaaS plans, per-tenant plan/limit/feature overrides, monthly usage metering |
| `tenants`, `tenant_domains` | Tenants (slug, status, demo flag, setup state); custom domains with DNS verification/TLS status |
| `config_versions` | Versioned settings sections (brand, company, social, footer, homepage, pricing, numbering, locale, search, ai, notifications, privacy) with DRAFT/PUBLISHED status and preview tokens |
| `bank_accounts` | Tenant bank accounts printed on documents (changes need step-up) |
| `users`, `user_roles`, `sessions`, `passkeys`, `auth_challenges`, `login_attempts` | Accounts (tenant or platform), roles, hashed session tokens with rotation, WebAuthn credentials, invites/impersonation/WebAuthn challenges (hashed), throttling |

### CRM & sourcing
| Table | Purpose |
| --- | --- |
| `companies`, `contacts`, `customer_notes` | Customer companies, contacts, internal notes (never exposed to customers) |
| `sourcing_projects` | One project per sourcing need: stage, stage history, attention flags |
| `sourcing_requests` | Search input (images, URL, text, quantity, options), pipeline progress, anonymous access token hash |
| `products`, `product_variants`, `product_images`, `product_embeddings` | Understood product (tri-state attributes, conflicts, sources), images with OCR text/pHash, 768-d embeddings (HNSW) |
| `product_clusters` | Same-product groups across suppliers (pHash, cosine, model number, jaccard) |
| `suppliers`, `supplier_contacts`, `supplier_events` | Suppliers (display alias vs real name), secret contact data, history (orders, samples, claims, late deliveries) feeding reliability metrics |
| `source_listings`, `listing_price_history` | Supplier offers (price tiers, MOQ, packaging, provenance, `is_dev_mock`), price changes |
| `request_candidates` | Ranked candidates per request with explainable score components, tags, pinned/hidden/selected, internal recommendation |
| `market_listings`, `market_price_history` | Korean market prices from connectors with collection time |
| `search_events`, `watched_items` | De-identified demand signals; watch lists |
| `fx_rates` | FX with rate date, source and verification |

### Trade compliance & cost
| Table | Purpose |
| --- | --- |
| `hs_codes`, `tariff_rates` | HS nomenclature and imported tariff rates (rate type, origin, C/O requirement, validity, source) |
| `hs_classifications` | Estimated / verified / actual HS per product with candidates and notes |
| `regulations`, `regulation_versions` | Korean import regulations as versioned rules (HS prefixes, attribute triggers, exceptions, documents, tests, expert type, official source) |
| `compliance_checks`, `compliance_reviews` | Rule evaluation per product (estimated status, confidence, reasons, missing attributes) and append-only expert reviews |
| `partner_tasks` | Work assigned to customs brokers, labs, forwarders |
| `ports` | UN/LOCODE ports with coordinates |
| `freight_rates`, `freight_rfqs`, `freight_quotes` | Rate tables by source priority, RFQs to forwarders and their quotes (incl. actual freight) |
| `cost_calculations`, `cost_items` | Landed-cost snapshots (lines, FX used, completeness, warnings) |
| `margin_rule_sets` | Versioned margin configuration (DRAFT / PUBLISHED / ARCHIVED) |
| `pricing_snapshots` | Calculated price, admin final price and reason per candidate |

### Commerce & logistics
| Table | Purpose |
| --- | --- |
| `quotations`, `quotation_versions`, `quotation_items` | Quote header; immutable issued versions (trigger); items with customer price, visible breakdown and internal cost (staff only) |
| `approvals` | Append-only approval evidence (actor, role, IP, UA, version, document SHA-256) for quotes and contracts |
| `contracts`, `contract_versions` | Contract state and append-only clause/snapshot versions |
| `invoices`, `payments` | PI/CI/PL/거래명세서/영수증 etc.; inbound and outbound payments |
| `purchase_orders`, `production_orders`, `inspections` | Supplier POs (never visible to customers), production progress, QC results |
| `shipments`, `shipment_containers`, `shipment_vessels`, `shipment_events`, `vessel_positions`, `shipment_etas` | Shipments with DCSA-style events (source + classifier + confirmation), containers, vessel legs, AIS positions, ETAs per source |

### System
| Table | Purpose |
| --- | --- |
| `files` | Private objects (key, MIME from magic bytes, size, SHA-256, purpose, scan result) |
| `document_templates`, `document_template_versions`, `documents` | Versioned templates; issued documents (append-only) with SHA-256 |
| `policies`, `policy_consents` | Versioned legal texts and append-only consent records |
| `api_connections`, `secrets` | Connector configuration and encrypted secret versions (masks only leave the server) |
| `webhooks`, `webhook_deliveries` | Outbound signed webhooks and delivery log |
| `email_templates`, `emails`, `notifications`, `notification_preferences` | Mail templates per trigger, outbound mail log, in-app notifications, user preferences |
| `jobs`, `idempotency_keys`, `workflow_instances` | Job queue, idempotent responses, durable order workflow |
| `audit_logs` | Append-only audit trail (actor, role, impersonator, before/after scrubbed, IP, request id) |
| `ai_usage`, `model_predictions` | AI metering; prediction vs human vs actual for accuracy and approved training data |
| `overrides`, `analytics_events`, `number_sequences`, `import_jobs` | Human overrides of AI values, product analytics, gap-free document numbering, CSV/XLSX imports |

## Database-level protections (`0001_security.sql`)

- `sos_apply_rls(table, shared)` enables **and forces** RLS with `USING/WITH CHECK (tenant_id = app_tenant())` (plus `tenant_id IS NULL` visibility for shared tables).
- Grants: `sos_app` gets DML on application tables only; `UPDATE`/`DELETE` revoked on append-only tables.
- Triggers `trg_guard_issued_quotation_version` and `trg_guard_quotation_items` block changes to issued quotation versions and their items.
- Indexes: HNSW (`vector_cosine_ops`) on product embeddings, trigram GIN on listing titles and HS descriptions, job-queue indexes on `(status, run_at)`.

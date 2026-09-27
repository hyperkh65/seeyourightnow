-- Security layer: tenant isolation (RLS), role grants, append-only tables, immutability guards.
-- Runs as sos_owner. Roles sos_app / sos_system are created by infra/postgres/01-roles.sh.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- Current tenant from the transaction-local setting. NULL when unset → every policy fails closed.
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Applies the standard isolation policy to a table.
--   shared = true: rows with tenant_id IS NULL are platform reference data, readable by every tenant, writable by none.
CREATE OR REPLACE FUNCTION sos_apply_rls(tbl text, shared boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
  IF shared THEN
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id IS NULL OR tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', tbl);
  ELSE
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', tbl);
  END IF;
END $$;

DO $$
DECLARE r record;
  shared_tables text[] := ARRAY['hs_codes','tariff_rates','regulations','regulation_versions','fx_rates'];
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    PERFORM sos_apply_rls(r.table_name, r.table_name = ANY(shared_tables));
  END LOOP;
END $$;

-- The tenants table: a tenant may only see its own row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants USING (id = app_tenant()) WITH CHECK (id = app_tenant());

-- Grants ------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO sos_app, sos_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sos_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO sos_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sos_app, sos_system;
GRANT EXECUTE ON FUNCTION app_tenant() TO sos_app, sos_system;

-- Reference tables: read-only for the runtime role.
REVOKE INSERT, UPDATE, DELETE ON plans, ports FROM sos_app;
-- Tenants cannot create or delete tenants; they can update their own row (setup state).
REVOKE INSERT, DELETE ON tenants FROM sos_app;

-- Append-only evidence tables.
REVOKE UPDATE, DELETE ON audit_logs, approvals, compliance_reviews, overrides, policy_consents, documents FROM sos_app;
REVOKE UPDATE, DELETE ON audit_logs FROM sos_system;

ALTER DEFAULT PRIVILEGES FOR ROLE sos_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sos_owner IN SCHEMA public GRANT ALL ON TABLES TO sos_system;

-- Immutability guard: an issued quotation version cannot change its commercial content.
CREATE OR REPLACE FUNCTION guard_issued_quotation_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL AND (
       NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.vat IS DISTINCT FROM OLD.vat
    OR NEW.terms IS DISTINCT FROM OLD.terms OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
    RAISE EXCEPTION 'issued quotation version % is immutable; create a new version', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_issued_quotation_version ON quotation_versions;
CREATE TRIGGER trg_guard_issued_quotation_version BEFORE UPDATE ON quotation_versions
  FOR EACH ROW EXECUTE FUNCTION guard_issued_quotation_version();

CREATE OR REPLACE FUNCTION guard_quotation_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sent timestamptz;
BEGIN
  SELECT sent_at INTO sent FROM quotation_versions WHERE id = COALESCE(OLD.quotation_version_id, NEW.quotation_version_id);
  IF sent IS NOT NULL THEN
    RAISE EXCEPTION 'items of an issued quotation version are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_guard_quotation_items ON quotation_items;
CREATE TRIGGER trg_guard_quotation_items BEFORE UPDATE OR DELETE ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION guard_quotation_items();

-- Contract versions are immutable once written.
REVOKE UPDATE, DELETE ON contract_versions FROM sos_app;

-- Vector similarity index (cosine) for image/product embeddings.
CREATE INDEX IF NOT EXISTS product_embeddings_hnsw ON product_embeddings USING hnsw (embedding vector_cosine_ops);
-- Trigram indexes for fuzzy product/supplier search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS source_listings_title_trgm ON source_listings USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS hs_codes_desc_trgm ON hs_codes USING gin ((description_ko || ' ' || description_en) gin_trgm_ops);

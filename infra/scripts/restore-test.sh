#!/usr/bin/env bash
# Restore drill: restores the newest dump into a throw-away database and runs integrity checks.
# A backup that has never been restored is not a backup — run this at least monthly (cron/CI).
# Usage: BACKUP_DIR=/backups ./infra/scripts/restore-test.sh
set -euo pipefail
BACKUP_DIR=${BACKUP_DIR:-./backups}
COMPOSE=${COMPOSE:-docker compose}
DUMP=$(ls -1t "$BACKUP_DIR"/sourcing_os-*.dump | head -1)
[ -n "$DUMP" ] || { echo "no dump found in $BACKUP_DIR"; exit 1; }
echo "[restore-test] verifying checksum of $DUMP"
sha256sum -c "$DUMP.sha256"
DB=restore_test_$(date +%s)
psql() { $COMPOSE exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
trap 'psql -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
psql -d postgres -c "CREATE DATABASE $DB OWNER sos_owner" >/dev/null
psql -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;" >/dev/null
echo "[restore-test] pg_restore into $DB"
$COMPOSE exec -T postgres pg_restore -U postgres -d "$DB" --no-owner --no-comments --role=sos_owner < "$DUMP"
echo "[restore-test] integrity checks"
psql -d "$DB" -At <<'SQL'
\set QUIET on
select 'tenants=' || count(*) from tenants;
select 'users=' || count(*) from users;
select 'quotations=' || count(*) from quotations;
select 'documents=' || count(*) from documents;
select 'audit_logs=' || count(*) from audit_logs;
select 'migrations=' || count(*) from drizzle.__drizzle_migrations;
-- every table that has tenant_id must still have RLS forced after restore
select 'tables_without_forced_rls=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and exists (select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'tenant_id')
   and not (c.relrowsecurity and c.relforcerowsecurity);
SQL
echo "[restore-test] OK"

#!/bin/bash
# Creates the three database roles used by Sourcing OS.
#   sos_owner  — owns the schema, runs migrations
#   sos_app    — runtime role; Row Level Security is ENFORCED (no BYPASSRLS)
#   sos_system — trusted system role for auth, job polling and platform admin (BYPASSRLS)
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sos_owner') THEN
      CREATE ROLE sos_owner LOGIN PASSWORD '${SOS_OWNER_PASSWORD:-sos_owner}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sos_app') THEN
      CREATE ROLE sos_app LOGIN PASSWORD '${SOS_APP_PASSWORD:-sos_app}' NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sos_system') THEN
      CREATE ROLE sos_system LOGIN PASSWORD '${SOS_SYSTEM_PASSWORD:-sos_system}' BYPASSRLS;
    END IF;
  END \$\$;
  GRANT ALL ON DATABASE "$POSTGRES_DB" TO sos_owner;
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO sos_app, sos_system;
  ALTER SCHEMA public OWNER TO sos_owner;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
# Separate database for automated tests (same roles).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE sourcing_os_test OWNER sos_owner" || true
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname sourcing_os_test <<-SQL
  GRANT CONNECT ON DATABASE sourcing_os_test TO sos_app, sos_system;
  ALTER SCHEMA public OWNER TO sos_owner;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

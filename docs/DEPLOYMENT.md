# Deployment

> Test locally first (`pnpm test`, `pnpm test:e2e`, `docker compose up`). Deploy to a server only after the checklist in §8 passes.

## 1. Topology

| Service | Image | Notes |
| --- | --- | --- |
| `web` | `apps/web/Dockerfile` | Next.js standalone, port 3000 |
| `api` | `apps/api/Dockerfile` | Fastify, port 4000, runs migrations/seed on start when enabled |
| `worker` | same as `api`, `node dist/worker.js` | job queue + schedulers; scale horizontally (SKIP LOCKED) |
| `ai-worker` | `ai-worker/Dockerfile` | internal only; `INSTALL_ML=true` for model engines (CPU; GPU optional) |
| `postgres` | `pgvector/pgvector:pg16` | or managed PostgreSQL 16 with `vector`, `pg_trgm`, `citext`, `pgcrypto` |
| `valkey` | `valkey/valkey:8` | or managed Redis-compatible cache |
| `gotenberg` | `gotenberg/gotenberg:8` | PDF rendering, JavaScript disabled |
| `caddy` (profile `edge`) | `caddy:2` | HTTPS, on-demand certificates |
| `clamav` (profile `security`) | `clamav/clamav` | upload scanning |
| Object storage | any S3-compatible (AWS S3, Cloudflare R2, Garage, SeaweedFS, MinIO*) | private bucket |

\* MinIO is AGPL-3.0 — acceptable as an unmodified separate service, but review with counsel; Garage (AGPL) / SeaweedFS (Apache-2.0) are alternatives.

## 2. Production configuration

Required environment (use a secret manager or `*_FILE` variables — never commit values):

```
NODE_ENV=production
DEV_MODE=false                       # startup fails if true
APP_SIGNING_KEY_FILE=/run/secrets/app_signing_key
SECRETS_MASTER_KEY_FILE=/run/secrets/secrets_master_key   # 32 bytes, base64 (or SECRETS_BACKEND=VAULT/INFISICAL)
DATABASE_URL=postgres://sos_app:…@db:5432/sourcing_os          # NOBYPASSRLS
DATABASE_SYSTEM_URL=postgres://sos_system:…@db:5432/sourcing_os
DATABASE_OWNER_URL=postgres://sos_owner:…@db:5432/sourcing_os   # migrations only
REDIS_URL=redis://cache:6379
PLATFORM_BASE_DOMAIN=example-sourcing.com
PLATFORM_ADMIN_HOST=admin.example-sourcing.com
PUBLIC_WEB_URL=https://www.example-sourcing.com
COOKIE_SECURE=true
STORAGE_DRIVER=s3  S3_ENDPOINT=…  S3_BUCKET=…  S3_ACCESS_KEY_FILE=…  S3_SECRET_KEY_FILE=…
GOTENBERG_URL=http://gotenberg:3000
AI_WORKER_URL=http://ai-worker:8000
INTERNAL_HOST_ALLOWLIST=ai-worker    # internal hosts tenant connectors may reach
RUN_WORKER_IN_PROCESS=false
CLAMAV_HOST=clamav                   # recommended
SMTP_HOST / SMTP_PORT / EMAIL_FROM_DEFAULT   # system default mail (tenants may set their own)
```

Database roles are created by `infra/postgres/01-roles.sh` (set `SOS_OWNER_PASSWORD`, `SOS_APP_PASSWORD`, `SOS_SYSTEM_PASSWORD`). On managed PostgreSQL, run the same SQL once as an administrator.

## 3. First start

```bash
# 1. Build and start infrastructure
docker compose up -d postgres valkey gotenberg secrets-init
# 2. Migrate and create reference data + the platform super admin (no demo tenants)
docker compose run --rm -e SEED_MODE=base -e SEED_SUPERADMIN_EMAIL=ops@example.com \
  -e SEED_SUPERADMIN_PASSWORD_FILE=/secrets/initial_admin_password api \
  sh -c "node dist/db/migrate.js && node dist/db/seed.js"
# The generated one-time admin password (change it after the first login):
docker compose run --rm --entrypoint cat api /secrets/initial_admin_password
# 3. Start the application
docker compose up -d api worker web ai-worker
```

Then sign in on `PLATFORM_ADMIN_HOST`: **MFA setup is forced on first login.** Create tenants in *플랫폼 → 테넌트*; each tenant owner receives a one-time invite link and completes the in-app setup wizard (회사 정보 → 브랜드 → 도메인 → 계좌 → API 연결 → …).

For the compose file in this repository set `SEED_MODE=base`, `ALLOW_DEMO_SEED=false` and remove `SEED_PASSWORD` before using it on a server.

## 4. Domains and TLS

- DNS: `*.PLATFORM_BASE_DOMAIN` and `PLATFORM_ADMIN_HOST` → edge proxy.
- `docker compose --profile edge up -d` starts Caddy (`infra/caddy/Caddyfile`) with **on-demand TLS**. Caddy asks `GET /api/v1/internal/tls-allowed?domain=…` before issuing a certificate; only the platform host, active tenant subdomains and custom domains with verified DNS TXT records are allowed.
- Custom domain flow for tenants: *설정 → 도메인* shows a TXT record (`_sos-verify.<domain>`) and a CNAME to `<slug>.<base>`; after “DNS 확인” succeeds the domain can be activated and the certificate is issued on the first HTTPS request.
- Keep `TRUST_PROXY=true` behind the proxy so client IPs (rate limits, approval evidence) are correct.

## 5. Scaling

- `web` and `api` are stateless — run several replicas behind the proxy.
- `worker` scales horizontally; jobs are claimed with `SKIP LOCKED`, schedulers deduplicate with keys.
- Move `ai-worker` to a GPU node for Florence-2/SigLIP throughput; it has no database access.
- PostgreSQL: enable connection pooling (PgBouncer in *transaction* mode is compatible because tenant context is set with `set_config(..., true)` inside each transaction).

## 6. Backup, PITR and restore testing

1. **Daily logical backup** — `infra/scripts/backup.sh` (pg_dump custom format + SHA-256 + storage archive, retention `KEEP=14`). Copy the output to off-site storage.
2. **Point-in-time recovery** — enable WAL archiving on PostgreSQL:
   ```
   wal_level = replica
   archive_mode = on
   archive_command = 'wal-g wal-push %p'        # or pgBackRest / cloud-managed PITR
   ```
   Take a weekly base backup (`wal-g backup-push $PGDATA`). Restore to a timestamp with `recovery_target_time` in `postgresql.conf` + `recovery.signal`. Managed databases (RDS, Cloud SQL, Neon, Supabase) provide PITR natively — prefer that.
3. **Restore drill** — `infra/scripts/restore-test.sh` restores the newest dump into a throw-away database, verifies the checksum, counts core tables and asserts that RLS is still enabled and forced on every tenant table. Schedule it monthly (or in CI) and alert on failure.
4. Object storage: enable bucket versioning and lifecycle rules; documents are referenced by SHA-256 so tampering is detectable.

## 7. Observability

- API/worker logs are structured JSON (pino) with request IDs; ship them to your log stack.
- `/api/v1/health` (public summary) and *관리자 → 시스템 상태* (component latency, queue lag, dead letters, connector errors, AI usage).
- Metrics/tracing export (OpenTelemetry) is not built in yet; use the structured logs and the system-status API, or add the OTel Node SDK at the process entry point.

## 8. Go-live checklist

- [ ] `DEV_MODE=false`, secrets from files/secret manager, `COOKIE_SECURE=true`
- [ ] Super admin MFA enabled; demo tenants **not** seeded
- [ ] Private bucket, signed URLs working, ClamAV enabled
- [ ] SMTP (SPF/DKIM/DMARC) configured; test mail from *설정 → 이메일 양식*
- [ ] Tenant policies (이용약관, 개인정보처리방침) replaced with legally reviewed text
- [ ] Tariff rates imported from official sources; FX connector (한국수출입은행) connected
- [ ] Backups + WAL archiving running; restore drill passed
- [ ] `pnpm audit` / `pip-audit` / image scan clean; firewall allows only 80/443 publicly

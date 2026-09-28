#!/bin/sh
# API container entrypoint: optional migrations/seed, then the requested process.
set -e
if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  node dist/db/migrate.js
fi
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] seeding (${SEED_MODE:-auto})"
  node dist/db/seed.js
fi
exec "$@"

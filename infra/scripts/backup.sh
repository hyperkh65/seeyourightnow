#!/usr/bin/env bash
# Logical backup of the Sourcing OS database + object storage manifest.
# Usage: BACKUP_DIR=/backups ./infra/scripts/backup.sh
# For point-in-time recovery use WAL archiving (see docs/DEPLOYMENT.md §6); this script
# produces the daily logical snapshot that is also used by restore-test.sh.
set -euo pipefail
BACKUP_DIR=${BACKUP_DIR:-./backups}
COMPOSE=${COMPOSE:-docker compose}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/sourcing_os-$STAMP.dump"
echo "[backup] pg_dump → $OUT"
$COMPOSE exec -T postgres pg_dump -U postgres -d sourcing_os --format=custom --no-owner --no-privileges > "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
if [ "${INCLUDE_STORAGE:-true}" = "true" ]; then
  echo "[backup] storage volume → $BACKUP_DIR/storage-$STAMP.tar.gz"
  $COMPOSE run --rm --no-deps -v "$(realpath "$BACKUP_DIR")":/backup --entrypoint sh api \
    -c "tar -czf /backup/storage-$STAMP.tar.gz -C /app storage"
fi
# Retention: keep the newest N dumps (default 14)
ls -1t "$BACKUP_DIR"/sourcing_os-*.dump 2>/dev/null | tail -n +"$(( ${KEEP:-14} + 1 ))" | while read -r f; do rm -f "$f" "$f.sha256"; done
echo "[backup] done"

#!/bin/bash
# Nightly SQLite backup — VACUUM INTO + WAL checkpoint, versioned, with restore drill log.
# For Postgres this would be pg_basebackup + WAL; for SQLite we use the online backup API.
# Run via cron: 0 2 * * * /app/scripts/backup.sh >> /var/log/backup.log 2>&1
set -euo pipefail
DB_PATH="${DB_PATH:-/data/loadbyton.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/loadbyton-$TIMESTAMP.db"
WAL_FILE="$BACKUP_DIR/loadbyton-$TIMESTAMP.wal"

# SQLite online backup — VACUUM INTO is atomic and works while DB is in WAL mode
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" "VACUUM INTO '$BACKUP_FILE';"
  # Also checkpoint WAL for point-in-time consistency
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);"
  cp -a "$DB_PATH-wal" "$WAL_FILE" 2>/dev/null || true
  cp -a "$DB_PATH-shm" "$BACKUP_DIR/loadbyton-$TIMESTAMP.shm" 2>/dev/null || true
  echo "[$(date -u +%FT%TZ)] backup ok -> $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  # Retention
  find "$BACKUP_DIR" -name "loadbyton-*.db" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  # Verify: can the backup be opened and does it have the expected tables?
  sqlite3 "$BACKUP_FILE" "SELECT 'backup verify: ' || (SELECT count(*) FROM users) || ' users, ' || (SELECT count(*) FROM jobs) || ' jobs';" || { echo "backup verify failed"; exit 1; }
  # Log ENCRYPTION_KEY version — the key itself is in Vault, not in the backup, but the version tag matters for restore
  echo "[$(date -u +%FT%TZ)] ENCRYPTION_KEY version: ${ENCRYPTION_KEY_VERSION:-enc:v1} (store in Vault, see docs/PAYMENTS.md §7)"
else
  echo "[$(date -u +%FT%TZ)] no DB at $DB_PATH — skipping (dev mode with :memory:?)"
fi
# Monthly restore drill reminder (manual): see docs/operations-runbook.md § Backup
if [ "$(date +%d)" = "01" ]; then
  echo "[$(date -u +%FT%TZ)] REMINDER: monthly restore drill due — follow docs/operations-runbook.md § Backup, log RTO <1h"
fi

#!/usr/bin/env node
// Loadbyton — database backup script (SQLite or Postgres, whichever is live)
// Usage: node scripts/backup-db.js [output-dir]
// Intended for cron: 0 2 * * * /path/to/node /path/to/scripts/backup-db.js /mnt/backups/loadbyton
//
// Postgres mode also pushes the dump offsite to whatever S3-compatible
// bucket the app itself already uses for document storage (same
// S3_BUCKET/S3_ENDPOINT/AWS_* env vars as server/lib/storage.js — see
// docs/DEVELOPER_GUIDE.md §5 "Backups"), under a backups/ key prefix, so a
// backup survives losing the VM entirely, not just the disk.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'loadbyton.db');
const OUTPUT_DIR = process.argv[2] || path.join(__dirname, '..', 'backups');
const USE_POSTGRES = process.env.USE_POSTGRES === 'true' && !!process.env.DATABASE_URL;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupSqlite() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] SQLite database not found at ${DB_PATH}`);
    process.exit(1);
  }
  const outputFile = path.join(OUTPUT_DIR, `loadbyton-${timestamp()}.sqlite3`);

  // Use sqlite3 .backup command for a consistent snapshot (works on WAL mode)
  // Falls back to file copy if sqlite3 CLI not available
  let result;
  if (fs.existsSync('/usr/bin/sqlite3') || fs.existsSync('/usr/local/bin/sqlite3')) {
    result = spawnSync('sqlite3', [DB_PATH, `.backup '${outputFile}'`], { shell: true });
  } else {
    console.warn('[backup] sqlite3 CLI not found — falling back to file copy (may be inconsistent on WAL)');
    fs.copyFileSync(DB_PATH, outputFile);
    result = { status: 0 };
  }
  if (result.status !== 0) {
    console.error(`[backup] sqlite3 backup failed: ${result.stderr?.toString() || 'unknown error'}`);
    process.exit(1);
  }

  const gzFile = `${outputFile}.gz`;
  const gzipResult = spawnSync('gzip', ['-c', outputFile], { shell: true });
  if (gzipResult.status === 0) {
    fs.writeFileSync(gzFile, gzipResult.stdout);
    fs.unlinkSync(outputFile);
    return gzFile;
  }
  return outputFile;
}

function backupPostgres() {
  // pg_dump needs a direct (session) connection, not a transaction-pooled
  // one — Supabase's pooled DATABASE_URL (Supavisor, port 6543) doesn't
  // support the multi-statement session pg_dump needs. Prefer
  // DIRECT_DATABASE_URL (Supabase's "direct connection" string, port 5432)
  // if set; fall back to DATABASE_URL with a loud warning, since a pooled
  // connection may simply fail here rather than silently produce a bad dump.
  const dumpUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!process.env.DIRECT_DATABASE_URL) {
    console.warn('[backup] DIRECT_DATABASE_URL not set — using DATABASE_URL for pg_dump. If that\'s a pooled (pgbouncer/Supavisor) connection string, this will likely fail; set DIRECT_DATABASE_URL to the non-pooled connection string instead.');
  }
  const outputFile = path.join(OUTPUT_DIR, `loadbyton-${timestamp()}.pgdump`);
  const result = spawnSync('pg_dump', ['--format=custom', '--file', outputFile, dumpUrl], { shell: false });
  if (result.status !== 0) {
    console.error(`[backup] pg_dump failed: ${result.stderr?.toString() || 'unknown error'}`);
    process.exit(1);
  }
  return outputFile;
}

async function pushOffsite(localFile) {
  if (!process.env.S3_BUCKET) {
    console.log('[backup] S3_BUCKET not set — backup stays local only, no offsite copy.');
    return;
  }
  const storage = require('../server/lib/storage');
  const buffer = fs.readFileSync(localFile);
  const key = `backups/${path.basename(localFile)}`;
  await storage.putObject(key, buffer, 'application/octet-stream');
  console.log(`[backup] Pushed offsite: s3://${process.env.S3_BUCKET}/${key} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

function pruneLocal(pattern) {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith('loadbyton-') && pattern.test(f))
    .map((f) => ({ name: f, path: path.join(OUTPUT_DIR, f), mtime: fs.statSync(path.join(OUTPUT_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  const toKeep = new Set();
  const monthlyKept = new Set();
  for (const f of files) {
    const date = new Date(f.mtime);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (toKeep.size < 30) {
      toKeep.add(f.name);
    } else if (!monthlyKept.has(monthKey) && monthlyKept.size < 12) {
      toKeep.add(f.name);
      monthlyKept.add(monthKey);
    }
  }
  for (const f of files) {
    if (!toKeep.has(f.name)) {
      fs.unlinkSync(f.path);
      console.log(`[backup] Pruned old local backup: ${f.name}`);
    }
  }
  // Offsite copies are NOT pruned by this script — configure an R2 bucket
  // lifecycle rule in the Cloudflare dashboard instead (no code needed) if
  // you want automatic offsite expiry too.
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const localFile = USE_POSTGRES ? backupPostgres() : backupSqlite();
  const sizeMb = (fs.statSync(localFile).size / 1024 / 1024).toFixed(2);
  console.log(`[backup] Created ${localFile} (${sizeMb} MB)`);

  await pushOffsite(localFile);

  pruneLocal(USE_POSTGRES ? /\.pgdump$/ : /\.sqlite3\.gz$/);
  console.log('[backup] Done');
}

main().catch((err) => {
  console.error('[backup] Unhandled error:', err);
  process.exit(1);
});

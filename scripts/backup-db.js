#!/usr/bin/env node
// Loadbyton — SQLite backup script
// Usage: node scripts/backup-db.js [output-dir]
// Intended for cron: 0 2 * * * /path/to/node /path/to/scripts/backup-db.js /mnt/backups/loadbyton

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'loadbyton.db');
const OUTPUT_DIR = process.argv[2] || path.join(__dirname, '..', 'backups');

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(OUTPUT_DIR, `loadbyton-${timestamp}.sqlite3`);

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
    console.error(`[backup] Failed: ${result.stderr?.toString() || 'unknown error'}`);
    process.exit(1);
  }

  // Compress
  const gzFile = `${outputFile}.gz`;
  const gzipResult = spawnSync('gzip', ['-c', outputFile], { shell: true });
  if (gzipResult.status === 0) {
    fs.writeFileSync(gzFile, gzipResult.stdout);
    fs.unlinkSync(outputFile);
    console.log(`[backup] Created ${gzFile} (${(fs.statSync(gzFile).size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log(`[backup] Created ${outputFile} (${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // Retention: keep last 30 daily + 12 monthly
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('loadbyton-') && f.endsWith('.sqlite3.gz'))
    .map(f => ({ name: f, path: path.join(OUTPUT_DIR, f), mtime: fs.statSync(path.join(OUTPUT_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  const toKeep = new Set();
  const monthlyKept = new Set();

  for (const f of files) {
    const date = new Date(f.mtime);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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
      console.log(`[backup] Pruned old backup: ${f.name}`);
    }
  }

  console.log('[backup] Done');
}

main();
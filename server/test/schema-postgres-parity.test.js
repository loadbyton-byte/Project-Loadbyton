// Regression guard for the 2026-09-11 production outage: schema.js's
// addColumn() calls (SQLite path) and postgres_init.sql's CREATE TABLE /
// ALTER TABLE ADD COLUMN IF NOT EXISTS statements (Postgres path) are two
// hand-maintained, independent lists that are supposed to describe the
// same columns. audit_log.acting_admin_id (added to schema.js by the
// admin-impersonation-attribution fix) was never mirrored into
// postgres_init.sql, so every writeAudit() call — including login —
// failed on Postgres with 42703 "column does not exist" the moment that
// commit reached a Postgres-backed deployment. This test parses both
// files statically (no DB required) and fails if schema.js ever again
// adds a column that postgres_init.sql doesn't also define.
//
// Postgres-only columns (present in postgres_init.sql but not as an
// addColumn() call — e.g. columns only ever created via CREATE TABLE, or
// intentionally Postgres-specific) are NOT flagged; this only checks the
// direction that actually broke production: SQLite got something Postgres
// didn't.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function sqliteAddedColumns() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'schema.js'), 'utf8');
  const cols = new Map(); // table -> Set(column)
  const re = /addColumn\('([a-zA-Z_]+)',\s*'([a-zA-Z_]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const [, table, column] = m;
    if (!cols.has(table)) cols.set(table, new Set());
    cols.get(table).add(column);
  }
  return cols;
}

function postgresColumns() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'postgres_init.sql'), 'utf8');
  const cols = new Map();

  // CREATE TABLE IF NOT EXISTS <table> ( ...columns... );
  const createRe = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
  let cm;
  while ((cm = createRe.exec(sql))) {
    const [, table, body] = cm;
    if (!cols.has(table)) cols.set(table, new Set());
    for (const line of body.split('\n')) {
      const colMatch = line.trim().match(/^"?([a-zA-Z_]+)"?\s+[A-Z]/);
      if (colMatch && !['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT'].includes(colMatch[1].toUpperCase())) {
        cols.get(table).add(colMatch[1]);
      }
    }
  }

  // ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <column>
  const alterRe = /ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/g;
  let am;
  while ((am = alterRe.exec(sql))) {
    const [, table, column] = am;
    if (!cols.has(table)) cols.set(table, new Set());
    cols.get(table).add(column);
  }

  return cols;
}

test('every schema.js addColumn() is mirrored in postgres_init.sql', () => {
  const sqlite = sqliteAddedColumns();
  const postgres = postgresColumns();
  const missing = [];

  for (const [table, columns] of sqlite) {
    const pgColumns = postgres.get(table) || new Set();
    for (const column of columns) {
      if (!pgColumns.has(column)) missing.push(`${table}.${column}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Columns added in schema.js (SQLite) but missing from postgres_init.sql: ${missing.join(', ')}. ` +
    'Any production deployment on Postgres will 500 with SQLSTATE 42703 the first time code touches these.'
  );
});

// Loadbyton — Unified database abstraction.
// Default: SQLite (zero-config, works everywhere)
// Opt-in: Postgres via USE_POSTGRES=true + DATABASE_URL
//
// All route/service files import this module. The exported object exposes
// both the legacy synchronous API (db.prepare(sql).get(params)) for
// backwards compatibility on SQLite, AND an async query() method that
// works identically on both backends.
//
// New code should use: await db.query(sql, params)
// Legacy code using db.prepare(sql).get/run/all continues to work on
// SQLite (sync) but MUST be awaited on Postgres (async).

'use strict';

// Use Postgres only if explicitly enabled (for production with proper DB)
// Default to SQLite for development/demo to avoid connection issues
const usePostgres = process.env.USE_POSTGRES === 'true' && process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');

let db;

if (usePostgres) {
  // -----------------------------------------------------------------------
  // Postgres path — async pg.Pool with SQLite-compatible prepare() shim
  // -----------------------------------------------------------------------
  const { Pool } = require('pg');

  // For Prisma PostgreSQL (pooled via PgBouncer), we MUST use connectionString directly
  // with pgbouncer=true to work with Prisma's pooled PostgreSQL proxy
  const poolConfig = { 
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    statement_timeout: 60000,
    query_timeout: 60000,
    pgbouncer: true,
  };
  
  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('[db] Postgres pool error:', err.message);
  });

  // Convert ? placeholders to $1, $2, ... for pg, and translate SQLite's
  // datetime('now'[, '+N unit'|'-N unit']) — used across ~20 files
  // (award/escrow/payout services, most route files, seed.js) — into a
  // Postgres equivalent. datetime() isn't a Postgres function at all
  // ("function datetime(unknown) does not exist", confirmed against a
  // real Postgres instance), so every one of those call sites hard-failed
  // on first use. to_char(...,'YYYY-MM-DD HH24:MI:SS') matches SQLite's
  // datetime('now') text output exactly (UTC, no offset, no fractional
  // seconds), so every existing string comparison/parse of these TEXT
  // date columns keeps working unchanged on both engines.
  const toPg = (sql) => {
    let i = 0;
    let out = sql.replace(/\?/g, () => `$${++i}`);
    out = out.replace(/datetime\(\s*'now'\s*(?:,\s*'([+-]\d+)\s+(\w+)'\s*)?\)/gi, (_m, amount, unit) => {
      const base = `(NOW() AT TIME ZONE 'UTC')`;
      const expr = amount && unit ? `${base} ${amount[0]} INTERVAL '${amount.slice(1)} ${unit}'` : base;
      return `to_char(${expr}, 'YYYY-MM-DD HH24:MI:SS')`;
    });
    return out;
  };

  db = {
    _pool: pool,
    isPostgres: true,

    // Primary async API — use this in new code
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),

    // Transaction helper — works on both backends
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) => client.query(toPg(text), params),
          exec: (sql) => client.query(sql),
          prepare: (sql) => ({
            get: async (...p) => { const r = await client.query(toPg(sql), p); return r.rows[0] || null; },
            all: async (...p) => { const r = await client.query(toPg(sql), p); return r.rows; },
            run: async (...p) => { const r = await client.query(toPg(sql), p); return { lastInsertRowid: r.rows[0]?.id || null, changes: r.rowCount }; },
          }),
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    // SQLite-compatible prepare() shim — returns async callables. Every
    // path here awaits migrationPromise first (assigned below, after this
    // object exists) — this is the API nearly the entire codebase actually
    // uses (db.query/exec are the minority path), so without this guard
    // any request that lands early in boot races the schema migration
    // directly against the raw pool and can hit "relation does not exist"
    // on a fresh database.
    prepare(sql) {
      const pgSql = toPg(sql);
      return {
        get: async (...params) => {
          await migrationPromise.catch(() => {});
          const r = await pool.query(pgSql, params);
          return r.rows[0] || null;
        },
        all: async (...params) => {
          await migrationPromise.catch(() => {});
          const r = await pool.query(pgSql, params);
          return r.rows;
        },
        run: async (...params) => {
          await migrationPromise.catch(() => {});
          // For INSERT RETURNING, capture the inserted row
          const sqlUpper = sql.trim().toUpperCase();
          if (!sqlUpper.includes('RETURNING')) {
            const r = await pool.query(pgSql, params);
            return { lastInsertRowid: null, changes: r.rowCount };
          }
          const r = await pool.query(pgSql, params);
          return {
            lastInsertRowid: r.rows[0]?.id || r.rows[0]?.last_insert_rowid || null,
            changes: r.rowCount,
          };
        },
      };
    },

    // Pool management
    end: () => pool.end(),
  };

  console.log('[db] Postgres mode — DATABASE_URL detected');

  // Run migration with retry logic
  async function runMigrationWithRetry(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check the LAST table postgres_init.sql creates (outbox_events),
        // not the first (users) — the whole file runs as one explicit
        // BEGIN/COMMIT transaction so this "should" be all-or-nothing, but
        // checking the first table is still the wrong signal if 'users' can
        // ever exist without the rest (a differently-provisioned database,
        // an interrupted/partial run from before this fix, etc.): it makes
        // this check falsely conclude migration is done and skip it
        // forever, permanently missing every later table. Every statement
        // in the file is IF NOT EXISTS / ON CONFLICT DO NOTHING, so
        // re-running it when some — but not all — tables exist is always
        // safe and fills in exactly what's missing.
        const check = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'outbox_events'
          )
        `);
        if (!check.rows[0].exists) {
          console.log('[db] Tables missing — running migration...');
          const fs = require('fs');
          const path = require('path');
          const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'postgres_init.sql'), 'utf8');
          await pool.query(sql);
          console.log('[db] Migration completed');
        }
        return;
      } catch (e) {
        console.error(`[db] Migration attempt ${attempt}/${maxRetries} failed:`, e.message);
        if (attempt === maxRetries) {
          console.error('[db] All migration attempts failed');
          throw e;
        }
        // Wait before retry with exponential backoff
        await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 30000)));
      }
    }
  }

  let migrationPromise = runMigrationWithRetry(5);

  // Ensure migration completes before first real query — await the promise instead of polling
  const originalPoolQuery = pool.query.bind(pool);
  db.query = async function(text, params) {
    await migrationPromise.catch(() => {}); // migration errors surface via pool.on('error')
    return originalPoolQuery(text, params);
  };
  db.exec = async function(sql) {
    await migrationPromise.catch(() => {});
    return originalPoolQuery(sql);
  };
} else {
  // -----------------------------------------------------------------------
  // SQLite path — synchronous node:sqlite with async wrapper methods
  // -----------------------------------------------------------------------
  const path = require('node:path');
  const fs = require('node:fs');
  const { DatabaseSync } = require('node:sqlite');

  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'loadbyton.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqliteDb = new DatabaseSync(DB_PATH);

  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  // Run schema initialization (tables + migrations)
  require('./schema')(sqliteDb);

  db = {
    _sqlite: sqliteDb,
    isPostgres: false,

    // Async query wrapper for new code (wraps sync SQLite)
    query: async (sql, params = []) => {
      const stmt = sql.trim().toUpperCase();
      if (stmt.startsWith('SELECT')) {
        const rows = sqliteDb.prepare(sql).all(...params);
        return { rows };
      }
      const r = sqliteDb.prepare(sql).run(...params);
      return { rows: [], rowCount: r.changes };
    },

    exec: (sql) => { sqliteDb.exec(sql); return Promise.resolve(); },

    // Transaction helper — SQLite uses BEGIN IMMEDIATE for atomicity
    transaction: async (fn) => {
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn({
          query: (sql, params = []) => {
            // Strip FOR UPDATE for SQLite (not supported)
            const cleanSql = sql.replace(/\sFOR\s+UPDATE\s*$/i, '').replace(/\sFOR\s+UPDATE\s+OF\s+.*$/i, '');
            const stmt = cleanSql.trim().toUpperCase();
            if (stmt.startsWith('SELECT')) {
              return Promise.resolve({ rows: sqliteDb.prepare(cleanSql).all(...params) });
            }
            const r = sqliteDb.prepare(cleanSql).run(...params);
            return Promise.resolve({ rows: [], rowCount: r.changes });
          },
          exec: (sql) => { sqliteDb.exec(sql); return Promise.resolve(); },
          prepare: (sql) => {
            const cleanSql = sql.replace(/\sFOR\s+UPDATE\s*$/i, '');
            return {
              get: (...p) => sqliteDb.prepare(cleanSql).get(...p),
              all: (...p) => sqliteDb.prepare(cleanSql).all(...p),
              run: (...p) => sqliteDb.prepare(cleanSql).run(...p),
            };
          },
        });
        sqliteDb.exec('COMMIT');
        return result;
      } catch (err) {
        try { sqliteDb.exec('ROLLBACK'); } catch {}
        throw err;
      }
    },

    // Native sync prepare — existing code continues to work unchanged
    prepare: (sql) => sqliteDb.prepare(sql),

    end: () => Promise.resolve(),
  };

  console.log('[db] SQLite mode —', DB_PATH);
}

module.exports = db;
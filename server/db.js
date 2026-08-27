// Loadbyton — Unified database abstraction.
// Detects DATABASE_URL env var to choose backend:
//   - postgres://... → async pg.Pool (production)
//   - unset          → synchronous node:sqlite (development)
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

const isPostgres = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'));

let db;

if (isPostgres) {
  // -----------------------------------------------------------------------
  // Postgres path — async pg.Pool with SQLite-compatible prepare() shim
  // -----------------------------------------------------------------------
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('[db] Postgres pool error:', err.message);
  });

  // Convert ? placeholders to $1, $2, ... for pg
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
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

    // SQLite-compatible prepare() shim — returns async callables
    prepare(sql) {
      const pgSql = toPg(sql);
      return {
        get: async (...params) => {
          const r = await pool.query(pgSql, params);
          return r.rows[0] || null;
        },
        all: async (...params) => {
          const r = await pool.query(pgSql, params);
          return r.rows;
        },
        run: async (...params) => {
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

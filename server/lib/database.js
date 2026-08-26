let db;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
  });
  // Async Postgres wrapper with sqlite-compatible shim for incremental migration.
  // New code: await db.query('SELECT ...', [params])
  // Legacy sync call sites: await db.prepare(sql).get(...params)  — shim translates ? → $n
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  db = {
    _pool: pool,
    isPostgres: true,
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
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
          const r = await pool.query(pgSql, params);
          return { lastInsertRowid: r.rows[0]?.id || null, changes: r.rowCount };
        },
      };
    },
  };
  console.log('[db] Postgres mode — Supabase/AWS RDS via DATABASE_URL');
} else {
  db = require('../db');
  db.isPostgres = false;
  // add async query shim for new code running on SQLite (wrap sync)
  if (!db.query) {
    db.query = async (sql, params = []) => {
      const stmt = sql.trim().toUpperCase();
      if (stmt.startsWith('SELECT')) {
        const rows = db.prepare(sql).all(...params);
        return { rows };
      }
      const r = db.prepare(sql).run(...params);
      return { rows: [], rowCount: r.changes };
    };
  }
}
module.exports = db;

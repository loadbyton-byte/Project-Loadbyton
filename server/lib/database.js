let db;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  // Minimal sqlite-compatible wrapper for the 95% of queries that are simple
  // db.prepare(sql).get/run/all — for Postgres we translate ? placeholders to $1,$2...
  db = {
    _pool: pool,
    prepare(sql) {
      const pgSql = sql.replace(/\?/g, (_, i) => `$${++i}`);
      // This is a stub — full Postgres port requires async/await and rewriting all call sites.
      // For now, throw a clear error so prod misconfig is loud, not silent.
      // See docs/enterprise-roadmap.md § Postgres for the full port plan.
      return {
        get: () => { throw new Error('Postgres mode: use async db.query — see docs/enterprise-roadmap.md'); },
        run: () => { throw new Error('Postgres mode: use async db.query'); },
        all: () => { throw new Error('Postgres mode: use async db.query'); },
      };
    },
    exec(sql) { return pool.query(sql); },
    isPostgres: true,
  };
  console.log('[db] Postgres mode via DATABASE_URL — ensure migrations have run (see server/migrations/)');
} else {
  db = require('../db');
  db.isPostgres = false;
}
module.exports = db;

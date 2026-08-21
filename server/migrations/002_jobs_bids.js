exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_code TEXT UNIQUE NOT NULL,
      shipper_id INTEGER NOT NULL REFERENCES users(id),
      carrier_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'OPEN',
      escrow_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      carrier_id INTEGER NOT NULL REFERENCES users(id),
      amount_aed REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};
exports.down = (db) => { db.exec(`DROP TABLE IF EXISTS bids; DROP TABLE IF EXISTS jobs;`); };

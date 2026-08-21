exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'BRONZE',
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      trn_number TEXT,
      trade_license_number TEXT,
      phone TEXT,
      iban TEXT,
      coverage_zones TEXT,
      fleet_size INTEGER NOT NULL DEFAULT 0,
      owned_chassis INTEGER NOT NULL DEFAULT 0,
      insurance_uploaded INTEGER NOT NULL DEFAULT 0,
      rating_avg REAL NOT NULL DEFAULT 5.0,
      completed_jobs INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT
    );
  `);
};
exports.down = (db) => { db.exec(`DROP TABLE IF EXISTS profiles; DROP TABLE IF EXISTS users;`); };

// Structural regression guard for a real production bug (2026-09-08): a
// direct `db.query(sqlWithQuestionMarks, params)` call is valid SQLite but
// a raw Postgres syntax error — db.js's toPg() (which turns SQLite's `?`
// placeholders into Postgres's `$1,$2,...`) only runs inside db.prepare(),
// never inside the top-level db.query() passthrough. lib/helpers.js's
// writeAudit() shipped exactly this bug (called from every successful
// login), and lib/ledger.js's getAccountBalance() had the same bug
// independently — both invisible to this repo's SQLite-only test suite,
// both only surfaced by a real Postgres production deployment.
//
// This scans every server source file for the literal pattern `db.query(`
// (the raw global db import — never a transaction's trx, which DOES
// translate placeholders on both backends, see db.js's transaction()) and
// fails if the SQL string passed to it contains a `?` placeholder. This is
// a heuristic, not a parser — it trusts the codebase's own established
// convention of importing the raw db module as `db` (confirmed via
// `grep -rn "require('../db')"` / `require('../../db')` — every call site
// does this) rather than parsing real JS, which is deliberately simple and
// good enough for what it guards against.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['lib', 'routes', 'services', 'middleware', 'validators'];

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no db.query(...) call site passes a SQLite-style `?` placeholder (breaks on Postgres — use db.prepare(sql).get/all/run instead)', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(SERVER_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of listJsFiles(full)) {
      const src = fs.readFileSync(file, 'utf8');
      // Match `db.query(` (not trx.query/dbOrTrx.query/client.query — those
      // already translate placeholders on both backends) followed by a
      // template-literal or string SQL argument containing a `?`.
      const re = /\bdb\.query\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
      let m;
      while ((m = re.exec(src))) {
        const sqlLiteral = m[1];
        if (sqlLiteral.includes('?')) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(SERVER_ROOT, file)}:${line}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `Found db.query() call(s) with a SQLite-style '?' placeholder — these are a raw Postgres syntax error (db.js's toPg() translation only runs inside db.prepare()). Switch to db.prepare(sql).get/all/run(...params) instead:\n${offenders.join('\n')}`);
});

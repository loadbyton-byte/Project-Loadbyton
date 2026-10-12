// Guards the SQLite -> Postgres SQL translation in lib/sqlTranslate.js. A
// regression here is invisible to the SQLite-backed suite and only shows up
// as a 500 on production Postgres (that is how the scalar MAX(a, b) bug
// shipped: `function max(integer, real) does not exist`).
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPgSql, translateScalarMinMax } = require('../lib/sqlTranslate');

test('scalar MAX(a, b) becomes GREATEST(a, b)', () => {
  assert.equal(
    translateScalarMinMax('UPDATE profiles SET reliability_score = MAX(0, reliability_score - 1) WHERE user_id=?'),
    'UPDATE profiles SET reliability_score = GREATEST(0, reliability_score - 1) WHERE user_id=?'
  );
});

test('nested scalar MAX(0, MIN(5, x + ?)) translates both levels', () => {
  assert.equal(
    translateScalarMinMax('SET s = MAX(0, MIN(5, s + ?))'),
    'SET s = GREATEST(0, LEAST(5, s + ?))'
  );
});

test('aggregate MAX(col) / MIN(col) are left alone', () => {
  const sql = 'SELECT MAX(created_at) m, MIN(id) FROM jobs';
  assert.equal(translateScalarMinMax(sql), sql);
});

test('a comma inside a nested call is not mistaken for a scalar MAX', () => {
  const sql = 'SELECT MAX(COALESCE(a, 0)) FROM t';
  assert.equal(translateScalarMinMax(sql), sql);
});

test('a comma inside a string literal is not mistaken for a scalar MAX', () => {
  const sql = "SELECT MAX('a,b') FROM t";
  assert.equal(translateScalarMinMax(sql), sql);
});

test('lower-case and spaced forms are handled', () => {
  assert.equal(translateScalarMinMax('SELECT max (1, 2), Min(3,4)'), 'SELECT GREATEST (1, 2), LEAST(3,4)');
});

test('toPgSql combines placeholders, datetime() and scalar MAX in one statement (the real payout-release statement)', () => {
  const sql = `UPDATE payouts SET status='RELEASED', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours'), net_aed = MAX(0, net_aed - ?) WHERE job_id=? AND status != 'RELEASED'`;
  const out = toPgSql(sql);
  assert.match(out, /GREATEST\(0, net_aed - \$1\)/);
  assert.match(out, /job_id=\$2/);
  assert.match(out, /INTERVAL '48 hours'/);
  assert.doesNotMatch(out, /datetime\(/);
  assert.doesNotMatch(out, /\bMAX\(/);
});

test('LIKE becomes ILIKE so searches stay case-insensitive on Postgres, as they are on SQLite', () => {
  const { translateLike } = require('../lib/sqlTranslate');
  assert.equal(translateLike('WHERE job_code LIKE ? OR notes like ?'), 'WHERE job_code ILIKE ? OR notes ILIKE ?');
  assert.equal(translateLike('WHERE x NOT LIKE ?'), 'WHERE x NOT ILIKE ?');
});

test('LIKE translation leaves ILIKE and string literals alone', () => {
  const { translateLike } = require('../lib/sqlTranslate');
  assert.equal(translateLike('WHERE a ILIKE ?'), 'WHERE a ILIKE ?');
  assert.equal(translateLike("SELECT 'a LIKE b' AS t WHERE c LIKE ?"), "SELECT 'a LIKE b' AS t WHERE c ILIKE ?");
  assert.equal(translateLike("SELECT 'it''s LIKE this' WHERE c LIKE '%x'"), "SELECT 'it''s LIKE this' WHERE c ILIKE '%x'");
});

test('toPgSql applies LIKE translation together with placeholders', () => {
  assert.equal(toPgSql('SELECT 1 FROM jobs WHERE job_code LIKE ? AND id=?'), 'SELECT 1 FROM jobs WHERE job_code ILIKE $1 AND id=$2');
});

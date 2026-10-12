// On Postgres, COUNT(*) is a BIGINT and node-pg hands it back as a string, so
// API responses carried {"total":"28"} where SQLite gives {"total":28}.
const test = require('node:test');
const assert = require('node:assert/strict');
const { types } = require('pg');
const { registerPgTypeParsers } = require('../lib/pgTypes');

test('BIGINT and NUMERIC come back as numbers (matching SQLite), NULL stays null', () => {
  const before = types.getTypeParser(20)('7');
  assert.equal(typeof before, 'string', 'sanity: node-pg returns bigint as a string by default');
  registerPgTypeParsers(types);
  assert.strictEqual(types.getTypeParser(20)('28'), 28);
  assert.strictEqual(types.getTypeParser(1700)('1234.50'), 1234.5);
  assert.strictEqual(types.getTypeParser(20)(null), null);
});

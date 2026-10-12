// node-pg returns BIGINT (OID 20 — what COUNT(*) and SUM(integer) produce) and
// NUMERIC (OID 1700) as strings, to avoid silently losing precision. SQLite
// returns plain numbers for the same queries, and the whole codebase was
// written against that: on production Postgres `/api/jobs` answered
// {"total":"28"} instead of {"total":28}, so strict checks such as
// `total === 0` / `typeof n === 'number'`, arithmetic like `count + 1`
// (string concatenation!) and JSON consumers all behaved differently from the
// dev database.
//
// Safe here: counts and sums of AED/fils amounts stay far below 2^53.
'use strict';

function registerPgTypeParsers(types) {
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
  types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
}

module.exports = { registerPgTypeParsers };

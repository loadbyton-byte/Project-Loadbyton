// SQLite -> Postgres SQL translation, kept in its own module so it can be
// unit-tested without a database (see test/sql-translate.test.js).
//
// The codebase is written against SQLite's dialect (that is what the dev
// database, the test suite and every route file speak) and db.js translates
// it on the fly when USE_POSTGRES=true. Four things need translating:
//
//   1. `?` placeholders           -> $1, $2, ...
//   2. datetime('now'[, '+N unit']) -> to_char(... UTC ...)
//   3. scalar MAX(a, b) / MIN(a, b) -> GREATEST(a, b) / LEAST(a, b)
//   4. LIKE -> ILIKE (SQLite's LIKE is case-insensitive for ASCII, Postgres's
//      is case-sensitive — without this every search box that works on the
//      SQLite dev DB found nothing on production Postgres unless the user
//      typed the exact capitalisation: "lb-1008" -> 0 results, "LB-1008" -> 1)
//
// (3) was the missing one: SQLite overloads MAX/MIN as both an aggregate
// (one argument) and a scalar "larger of these" (two or more arguments).
// Postgres only has the aggregate form, so a statement such as
//   UPDATE profiles SET reliability_score = MAX(0, reliability_score - 1)
// fails there with `function max(integer, real) does not exist` — which
// turned awarding-adjacent flows (cancel-with-penalty, dispute resolution,
// credit repayment) into hard 500s on production Postgres while passing
// every SQLite-backed test.

'use strict';

// Index just past the ')' that closes the '(' at `openIdx`, or -1 if
// unbalanced. Skips over '...' string literals so a ')' or ',' inside one
// is never mistaken for SQL structure.
function findClosingParen(sql, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// True if the parenthesised argument list starting at `openIdx` has a comma
// at its own top level (i.e. MAX(a, b) — not MAX(COALESCE(a, b)) whose comma
// belongs to a nested call, and not a comma inside a string literal).
function hasTopLevelComma(sql, openIdx, closeIdx) {
  let depth = 0;
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < closeIdx && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

function translateScalarMinMax(sql) {
  if (!/\b(?:max|min)\s*\(/i.test(sql)) return sql;
  const re = /\b(max|min)(\s*)\(/gi;
  const edits = [];
  let m;
  while ((m = re.exec(sql))) {
    const openIdx = m.index + m[1].length + m[2].length;
    const closeIdx = findClosingParen(sql, openIdx);
    if (closeIdx === -1) continue;
    if (hasTopLevelComma(sql, openIdx, closeIdx)) {
      edits.push({ start: m.index, len: m[1].length, to: m[1].toLowerCase() === 'max' ? 'GREATEST' : 'LEAST' });
    }
  }
  // Apply back-to-front so earlier offsets stay valid. Nested calls
  // (MAX(0, MIN(5, x))) are separate regex matches, so each gets its own edit.
  let out = sql;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.to + out.slice(e.start + e.len);
  return out;
}

// Apply `fn` only to the parts of the SQL that are not inside '...' string
// literals, so a literal that happens to contain the word is never rewritten.
function outsideLiterals(sql, fn) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const q = sql.indexOf("'", i);
    if (q === -1) { out += fn(sql.slice(i)); break; }
    out += fn(sql.slice(i, q));
    let j = q + 1;
    while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
    out += sql.slice(q, j + 1);
    i = j + 1;
  }
  return out;
}

const translateLike = (sql) => (/\blike\b/i.test(sql) ? outsideLiterals(sql, (part) => part.replace(/\bLIKE\b/gi, 'ILIKE')) : sql);

function toPgSql(sql) {
  let i = 0;
  let out = sql.replace(/\?/g, () => `$${++i}`);
  out = out.replace(/datetime\(\s*'now'\s*(?:,\s*'([+-]\d+)\s+(\w+)'\s*)?\)/gi, (_m, amount, unit) => {
    const base = `(NOW() AT TIME ZONE 'UTC')`;
    const expr = amount && unit ? `${base} ${amount[0]} INTERVAL '${amount.slice(1)} ${unit}'` : base;
    return `to_char(${expr}, 'YYYY-MM-DD HH24:MI:SS')`;
  });
  return translateLike(translateScalarMinMax(out));
}

module.exports = { toPgSql, translateScalarMinMax, translateLike };

#!/usr/bin/env node
// Runs the server test suite against a REAL Postgres, one throw-away database
// per test file — production runs on Postgres, but the default `npm test` runs
// on SQLite, and every difference between the two engines (scalar MAX(), LIKE
// case-sensitivity, BIGINT-as-string, unique-violation behaviour...) shipped
// to production unnoticed until this existed. See docs/REVIEW-2026-10-12.md.
//
//   PG_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:pg
//   npm run test:pg -- test/core-loop.test.js        # just some files
//
// PG_TEST_URL must point at a server where the role can CREATE DATABASE (any
// database on it is used only to issue that command). Files listed in
// test/postgres-skip.json are tests that open the SQLite file directly (or
// call the sync SQLite driver) and so can only ever run on SQLite.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const base = process.env.PG_TEST_URL;
if (!base) {
  console.error('PG_TEST_URL is not set (e.g. postgres://postgres:postgres@localhost:5432/postgres)');
  process.exit(2);
}

const skip = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'postgres-skip.json'), 'utf8')).files);
const requested = process.argv.slice(2);
const files = (requested.length ? requested : fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`))
  .filter((f) => requested.length || !skip.has(path.basename(f)));

const withDb = (name) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

(async () => {
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const failed = [];
  for (const file of files) {
    const dbName = `lbt_${path.basename(file, '.test.js').replace(/[^a-z0-9]/gi, '_').toLowerCase()}`.slice(0, 60);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const started = Date.now();
    const r = spawnSync(process.execPath, ['--test', file], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, USE_POSTGRES: 'true', DATABASE_URL: withDb(dbName), REDIS_URL: '', NODE_ENV: 'test' },
      timeout: 3 * 60 * 1000,
      encoding: 'utf8',
    });
    const out = `${r.stdout}\n${r.stderr}`;
    const pass = (out.match(/^# pass (\d+)/m) || [])[1] || '0';
    const fail = (out.match(/^# fail (\d+)/m) || [])[1] || (r.status === 0 ? '0' : '?');
    const ok = r.status === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(52)} pass=${pass} fail=${fail}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (!ok) {
      failed.push(file);
      console.log(out.split('\n').filter((l) => /^not ok|^\s+error:|Error:/.test(l)).slice(0, 12).join('\n'));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  }
  await admin.end();
  console.log(failed.length ? `\n${failed.length} file(s) failed on Postgres:\n  ${failed.join('\n  ')}` : '\nAll Postgres test files passed.');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

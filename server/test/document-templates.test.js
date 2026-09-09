// Branded documents (settlement statement, load confirmation, POD
// certificate) are server-rendered off real payout/job rows. This guards
// against the exact regression a live walkthrough surfaced: seed.js's
// scenario jobs were inserted directly with SQL for every AWARDED-or-beyond
// job, bypassing award.service.js's real award flow — which is what
// actually creates the matching `payouts` row in production. Without a
// payout row, GET /api/jobs/:id/documents/settlement 404s with "No payout
// on file for this job yet", and since Job History's "Settlement" link was
// a plain <a href> straight to that API route, the raw JSON error body
// rendered directly in the browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

test('every seeded AWARDED-or-beyond job has a matching payouts row (no orphaned "awarded" job with no payout)', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const orphans = db.prepare(
    `SELECT j.job_code FROM jobs j
     LEFT JOIN payouts p ON p.job_id = j.id
     WHERE j.carrier_id IS NOT NULL AND j.agreed_price_aed IS NOT NULL
       AND j.status NOT IN ('OPEN','CANCELLED') AND p.id IS NULL`
  ).all();
  db.close();
  assert.deepEqual(orphans, [], 'every awarded-or-beyond job must have a payouts row — see seed.js\'s payout backfill');
});

test('the Settlement document renders for a seeded COMPLETED job instead of 404ing', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const job = db.prepare(`SELECT id FROM jobs WHERE job_code='LB-1005'`).get();
  db.close();
  assert.ok(job, 'seeded job LB-1005 should exist');

  const res = await admin.get(`/api/jobs/${job.id}/documents/settlement`);
  assert.equal(res.status, 200, `settlement document must render, not 404 with "No payout on file": ${res.raw}`);
  assert.match(res.raw, /Settlement Statement/);
});

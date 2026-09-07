// End-to-end: the compliance sweep endpoint auto-pauses a driver with an
// expired document (a RED blocker), not just a warning, and requires the
// internal key exactly like every other sweep endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer, makeClient } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

test('compliance sweep requires the internal key', async () => {
  const res = await fetch(`${server.baseUrl}/api/system/compliance-check`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('compliance sweep auto-pauses a driver with an expired visa', async () => {
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const created = await carrier.post('/api/fleet/drivers', { name: 'Expired Visa Driver', phone: '0501112233' });
  assert.equal(created.status, 201, created.raw);
  const driverId = created.body.driver.id;

  // visa_expiry/visa_status have no API yet in this pass — set directly,
  // matching local-transport.test.js's precedent for backdating fields the
  // public API doesn't expose.
  const db = new DatabaseSync(server.dbPath);
  db.prepare(`UPDATE drivers SET visa_status='RESIDENCE', visa_expiry='2020-01-01' WHERE id=?`).run(driverId);
  db.close();

  const sweep = await fetch(`${server.baseUrl}/api/system/compliance-check`, {
    method: 'POST',
    headers: { 'x-internal-key': 'test-internal-key' },
  });
  assert.equal(sweep.status, 200);
  const body = await sweep.json();
  assert.ok(body.paused >= 1, 'at least the expired-visa driver should be paused');

  const drivers = await carrier.get('/api/fleet/drivers');
  assert.ok(!drivers.body.drivers.some((d) => d.id === driverId), 'paused driver no longer shows in the active roster');
});

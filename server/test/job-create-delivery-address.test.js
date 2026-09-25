// jobs.delivery_address is a NOT NULL column, but the web form's "Delivery
// address detail" field (which is what the `deliveryAddress` request field
// actually is) has no `required` attribute for IMPORT/EXPORT shipments —
// it reads as an optional, supplementary field, not an essential one. A
// shipper who posts an IMPORT or EXPORT job without filling it (the
// deliveryArea dropdown alone already satisfies the validator's own
// "deliveryArea or deliveryAddress is required" check) used to hit a raw,
// unhandled NOT NULL constraint violation on INSERT — surfaced to the
// shipper as a bare "Internal server error" with no indication of what
// went wrong. Reproduced against a real Postgres instance (this
// SQLite-backed harness enforces the same NOT NULL constraint, so it
// catches the same bug) before being fixed in validators/job.schema.js.
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

test('posting an IMPORT job with no deliveryAddress succeeds and falls back to a real delivery_address value', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', containerCount: 1,
    pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    equipmentType: 'TRAILER_20FT', cargoType: 'GENERAL_GOODS', truckCount: 1, paymentTier: 'INSTANT',
    importPickupTerminal: 'JEBEL_ALI_T1', importUnloadingLocation: 'AL_QUOZ', importEmptyReturnLocation: 'JAFZA_DEPOT',
    // deliveryAddress deliberately omitted, matching a shipper who skips the optional field
  });
  assert.equal(created.status, 201, created.raw);
  assert.ok(created.body.job.delivery_address, 'delivery_address must never be null/empty, even when the optional field is skipped');
});

test('posting an EXPORT job with no deliveryAddress succeeds the same way', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'EXPORT', containerSize: '20FT', containerType: 'DRY', containerCount: 1,
    pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    equipmentType: 'TRAILER_20FT', cargoType: 'GENERAL_GOODS', truckCount: 1, paymentTier: 'INSTANT',
    exportEmptyPickupLocation: 'JAFZA_DEPOT', exportLoadingLocation: 'AL_QUOZ', exportDepositTerminal: 'JEBEL_ALI_T1',
  });
  assert.equal(created.status, 201, created.raw);
  assert.ok(created.body.job.delivery_address, 'delivery_address must never be null/empty, even when the optional field is skipped');
});

test('a job with neither deliveryArea nor deliveryAddress still fails with a controlled 400, not a crash', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', containerCount: 1,
    pickupTerminal: 'JEBEL_ALI_T1',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    equipmentType: 'TRAILER_20FT', cargoType: 'GENERAL_GOODS', truckCount: 1, paymentTier: 'INSTANT',
  });
  assert.equal(created.status, 400, created.raw);
});

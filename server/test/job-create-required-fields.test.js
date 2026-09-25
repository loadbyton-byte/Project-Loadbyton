// Same bug class as job-create-delivery-address.test.js, found in a
// follow-up sweep of the same function: jobs.ready_at/deadline and (for
// IMPORT/EXPORT) jobs.container_size/container_type are all NOT NULL, but
// nothing validated their presence before the INSERT — middleware/
// validate.js's jobCreateSchema marks all of them `.optional()`, and the
// web form's own client-side guards (Dashboard.jsx) don't apply to a
// direct API call or the CSV bulk-import path (POST /api/jobs/import,
// which loops the exact same createJobFromBody() per row). Each used to
// hit a raw, unhandled NOT NULL constraint violation instead of a
// controlled 400.
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

test('posting a job with no readyAt fails with a controlled 400, not a crash', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'no readyAt test', maxBudgetAed: 700,
  });
  assert.equal(created.status, 400, created.raw);
  assert.match(created.body.message || created.body.error, /readyAt is required/);
});

test('posting a job with no deadline fails with a controlled 400, not a crash', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'no deadline test', readyAt: new Date(Date.now() + 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 400, created.raw);
  assert.match(created.body.message || created.body.error, /deadline is required/);
});

test('posting an IMPORT job with no containerSize/containerType fails with a controlled 400, not a crash', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'no container test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 400, created.raw);
  assert.match(created.body.message || created.body.error, /containerSize and containerType are required/);
});

test('LOCAL jobs still post fine with no containerSize/containerType (falls back to N/A, unaffected)', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'LOCAL', loadingLocation: 'Al Quoz Ind 3', deliveryLocation: 'DIP Plot 45',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    equipmentType: 'FLATBED', maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  assert.equal(created.body.job.container_size, 'N/A');
});

test('the bulk CSV import path (POST /api/jobs/import) rejects a row missing readyAt per-row, without crashing the whole batch', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const result = await shipper.post('/api/jobs/import', {
    jobs: [
      {
        containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
        deliveryAddress: 'bulk import valid row', readyAt: new Date(Date.now() + 86400000).toISOString(),
        deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
      },
      {
        containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
        deliveryAddress: 'bulk import missing readyAt', maxBudgetAed: 700,
        // readyAt/deadline deliberately omitted
      },
    ],
  });
  assert.equal(result.status, 201, result.raw);
  assert.equal(result.body.created, 1, 'exactly one of the two rows must succeed');
  assert.equal(result.body.failed, 1);
  const failedRow = result.body.results.find((r) => !r.ok);
  assert.match(failedRow.error, /readyAt is required/, 'the failed row must report a controlled validation error, not a raw DB crash message');
});

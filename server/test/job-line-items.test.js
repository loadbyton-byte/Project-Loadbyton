// Multi-container-type support (Change 2, Prompt 2): a job can carry
// multiple different container size/type line items instead of just one.
// Backward compat: existing single-container jobs (no lineItems in the
// request) keep working exactly as before — covered implicitly by every
// other test file's plain job-creation calls still passing.
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

test('a job posted with lineItems stores line 1 on jobs and the rest in job_line_items', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT',
    pickupTerminal: 'JEBEL_ALI_T2',
    deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'Test Warehouse 9',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    lineItems: [
      { containerSize: '40HC', containerType: 'DRY', count: 2 },
      { containerSize: '20FT', containerType: 'DRY', count: 1 },
    ],
  });
  assert.equal(created.status, 201, created.raw);
  const job = created.body.job;
  assert.equal(job.container_size, '40HC', 'line item 1 becomes the job\'s own container_size');
  assert.equal(job.container_type, 'DRY');
  assert.equal(job.container_count, 2);

  const detail = await shipper.get(`/api/jobs/${job.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.job.extra_line_items.length, 1);
  assert.equal(detail.body.job.extra_line_items[0].container_size, '20FT');
  assert.equal(detail.body.job.extra_line_items[0].count, 1);
});

test('a job posted without lineItems has zero extra_line_items (unchanged behavior)', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2',
    deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'Test Warehouse 10',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);

  const detail = await shipper.get(`/api/jobs/${created.body.job.id}`);
  assert.equal(detail.body.job.extra_line_items.length, 0);
  assert.equal(detail.body.job.container_size, '40FT');
});

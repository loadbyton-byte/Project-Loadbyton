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

test('LOCAL job: box truck, loading -> delivery, target price, cargo description', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const res = await shipper.post('/api/jobs', {
    shipmentType: 'LOCAL',
    equipmentType: 'BOX_TRUCK',
    loadingLocation: 'Al Quoz Industrial 3, Warehouse 12',
    deliveryLocation: 'Dubai South Logistics District, Block C',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
    targetPriceAed: 450,
    cargoWeightTons: 5,
    notes: '8 pallets of retail FMCG, tail-lift required at delivery.',
  });
  assert.equal(res.status, 201, res.raw);
  const job = res.body.job;
  assert.equal(job.shipment_type, 'LOCAL');
  assert.equal(job.status, 'OPEN');
  assert.equal(job.loading_location, 'Al Quoz Industrial 3, Warehouse 12');
  assert.equal(job.delivery_location, 'Dubai South Logistics District, Block C');
  assert.equal(job.pickup_terminal, job.loading_location);
  assert.equal(job.delivery_area, job.delivery_location);

  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const list = await carrier.get('/api/jobs?status=OPEN&shipmentType=LOCAL');
  assert.equal(list.status, 200);
  assert.ok(list.body.jobs.some((j) => j.id === job.id), 'LOCAL job visible to carriers');

  const missing = await shipper.post('/api/jobs', { shipmentType: 'LOCAL', equipmentType: 'BOX_TRUCK', loadingLocation: 'X', readyAt: new Date().toISOString(), deadline: new Date().toISOString() });
  assert.equal(missing.status, 400, 'deliveryLocation required');
});

test('CUSTOM equipment still requires a written requirement', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const noNotes = await shipper.post('/api/jobs', {
    shipmentType: 'LOCAL',
    equipmentType: 'CUSTOM',
    loadingLocation: 'A',
    deliveryLocation: 'B',
    readyAt: new Date(Date.now() + 3600000).toISOString(),
    deadline: new Date(Date.now() + 7200000).toISOString(),
  });
  assert.equal(noNotes.status, 400);
});

test('Post later: scheduled job stays DRAFT then publishes via internal sweep route', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const future = await shipper.post('/api/jobs', {
    shipmentType: 'LOCAL',
    equipmentType: 'PICKUP_5T',
    loadingLocation: 'Musaffah M-4',
    deliveryLocation: 'Khalifa Port Free Zone',
    readyAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    deadline: new Date(Date.now() + 9 * 86400000).toISOString(),
    notes: 'Two machine parts.',
    scheduledPostAt: new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
  });
  assert.equal(future.status, 201, future.raw);
  assert.equal(future.body.job.status, 'DRAFT');
  assert.ok(future.body.job.scheduled_post_at, 'scheduled_post_at stored');

  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const openList = await carrier.get('/api/jobs?status=OPEN');
  assert.ok(!openList.body.jobs.some((j) => j.id === future.body.job.id), 'draft not in open loads');

  // Force-publish by backdating, then hitting the internal sweep.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  db.prepare(`UPDATE jobs SET scheduled_post_at=datetime('now','-1 minute') WHERE id=?`).run(future.body.job.id);
  db.close();

  const noKey = await fetch(`${server.baseUrl}/api/system/publish-scheduled`, { method: 'POST' });
  assert.equal(noKey.status, 403);

  const withKey = await fetch(`${server.baseUrl}/api/system/publish-scheduled`, {
    method: 'POST',
    headers: { 'x-internal-key': 'test-internal-key' },
  });
  assert.equal(withKey.status, 200);
  const body = await withKey.json();
  assert.ok(body.published >= 1, 'at least the scheduled job published');

  const after = await carrier.get(`/api/jobs/${future.body.job.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.job.status, 'OPEN');
});

test('packing list PDF attaches to a LOCAL job via documents API', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const created = await shipper.post('/api/jobs', {
    shipmentType: 'LOCAL',
    equipmentType: 'BOX_TRUCK',
    loadingLocation: 'JAFZA South',
    deliveryLocation: 'DIP 2',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
    notes: 'Furniture, shrink-wrapped.',
  });
  const jobId = created.body.job.id;
  const pdfBase64 = Buffer.from('%PDF-1.4 test packing list').toString('base64');
  const up = await shipper.post(`/api/jobs/${jobId}/documents`, {
    title: 'Packing list',
    docType: 'PACKING_LIST',
    mimeType: 'application/pdf',
    fileBase64: pdfBase64,
  });
  assert.equal(up.status, 201, up.raw);
  const detail = await shipper.get(`/api/jobs/${jobId}`);
  const doc = detail.body.documents.find((d) => d.doc_type === 'PACKING_LIST');
  assert.ok(doc, 'packing list stored and readable by owner');
});

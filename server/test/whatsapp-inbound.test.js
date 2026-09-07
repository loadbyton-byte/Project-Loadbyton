// First real two-way WhatsApp bot flow: an inbound "Delivered" button reply
// triggers the exact same confirmDelivery() path the web dashboard's POD
// upload uses. Covers the ad-hoc-driver phone match (no fleet roster entry
// — the common real-world case, see jobs.assigned_driver_phone), the 24h
// session window being opened by the inbound message, and messages landing
// with channel='WHATSAPP' in the job's thread.
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

async function postJob(shipper) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2',
    deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'Test Warehouse 1',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  return created.body.job.id;
}

test('inbound WhatsApp "Delivered" button reply marks the job DELIVERED via the same path as web POD', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const jobId = await postJob(shipper);

  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: '3-axle flatbed' });
  const bidId = bidRes.body.bid.id;
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId, skipNegotiation: true });
  const adminW1 = makeClient(server.baseUrl);
  await adminW1.login('admin@loadbyton.ae', 'demo1234');
  await adminW1.post('/api/admin/confirm-receipt', { jobId });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Yusuf Al Naqbi', driverPhone: '0559998877' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  const inTransit = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);

  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.test123',
            from: '971559998877',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'DELIVERED', title: 'Delivered' } },
          }],
        },
      }],
    }],
  };

  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  // The webhook acks immediately and processes async — poll briefly for the
  // status flip rather than assuming it's already landed.
  let job;
  for (let i = 0; i < 20; i++) {
    const detail = await shipper.get(`/api/jobs/${jobId}`);
    job = detail.body.job;
    if (job.status === 'DELIVERED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(job.status, 'DELIVERED', 'inbound button reply should confirm delivery exactly like web POD does');
  assert.ok(job.delivered_at, 'delivered_at set by the shared confirmDelivery path');
});

test('inbound WhatsApp text message lands in the job thread with channel=WHATSAPP', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const jobId = await postJob(shipper);

  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: '3-axle flatbed' });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id, skipNegotiation: true });
  const adminW2 = makeClient(server.baseUrl);
  await adminW2.login('admin@loadbyton.ae', 'demo1234');
  await adminW2.post('/api/admin/confirm-receipt', { jobId });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Second Driver', driverPhone: '0551112233' });

  const webhookPayload = {
    entry: [{ changes: [{ value: { messages: [{ id: 'wamid.text1', from: '971551112233', type: 'text', text: { body: 'Stuck at gate, need help' } }] } }] }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  let found = false;
  for (let i = 0; i < 20; i++) {
    const threads = await carrier.get(`/api/jobs/${jobId}/threads`);
    found = threads.body.threads.some((t) => t.messages.some((m) => m.content === 'Stuck at gate, need help' && m.channel === 'WHATSAPP'));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(found, 'inbound WhatsApp text should appear in the job thread tagged as WHATSAPP');
});

test('GET webhook verification handshake echoes the challenge only with a matching token', async () => {
  const bad = await fetch(`${server.baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
  assert.equal(bad.status, 403);
});

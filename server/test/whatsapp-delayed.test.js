// The WhatsApp "Delayed" button reply used to be log-only — a chat line
// only a human might notice. There's no "delayed" job-status value to
// transition to (inventing one is a bigger schema/state-machine change
// than a button reply warrants), so instead it now records a real
// DELAY_REPORTED shipment event (visible on the job's timeline, same as
// any other tracked event) and notifies the shipper immediately.
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

async function inTransitJobWithDriverPhone(driverPhoneLocal) {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'WhatsApp delayed test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  const adminClient = makeClient(server.baseUrl);
  await adminClient.login('admin@loadbyton.ae', 'demo1234');
  await adminClient.post('/api/admin/confirm-receipt', { jobId });
  const driverPatch = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Delayed Test Driver', driverPhone: driverPhoneLocal });
  assert.equal(driverPatch.status, 200, driverPatch.raw);
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  const inTransit = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);

  return { jobId, shipper, carrier };
}

test('an inbound "Delayed" button reply records a real shipment event and notifies the shipper — job status is untouched', async () => {
  const { jobId, shipper } = await inTransitJobWithDriverPhone('0558881111');

  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.delayed-1',
            from: '971558881111',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'DELAYED', title: 'Delayed' } },
          }],
        },
      }],
    }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  // No job-status value exists for "delayed" — the job must stay exactly
  // where it was (IN_TRANSIT), not flip to something invented.
  await new Promise((r) => setTimeout(r, 300));
  const detail = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(detail.body.job.status, 'IN_TRANSIT', 'a delay report must never invent a job-status transition');

  // The real action: a DELAY_REPORTED shipment event on the job's timeline.
  let sawEvent = false;
  for (let i = 0; i < 20; i++) {
    const withEvents = await shipper.get(`/api/jobs/${jobId}`);
    sawEvent = (withEvents.body.events || []).some((e) => e.event_type === 'DELAY_REPORTED' && /delay/i.test(e.summary));
    if (sawEvent) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(sawEvent, 'a real DELAY_REPORTED shipment event must be recorded, not just a chat line');

  // And the shipper gets notified immediately, not left to notice on their own.
  let sawNotification = false;
  for (let i = 0; i < 20; i++) {
    const notifications = await shipper.get('/api/notifications');
    sawNotification = notifications.body.notifications.some((n) => n.job_id === jobId && /delay/i.test(n.title || n.body || ''));
    if (sawNotification) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(sawNotification, 'the shipper must be notified in-app that the driver reported a delay');
});

test('the original button-reply text still lands in the job thread alongside the shipment event', async () => {
  const { jobId, carrier } = await inTransitJobWithDriverPhone('0558882222');

  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.delayed-2',
            from: '971558882222',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'DELAYED', title: 'Delayed' } },
          }],
        },
      }],
    }],
  };
  await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });

  let found = false;
  for (let i = 0; i < 20; i++) {
    const threads = await carrier.get(`/api/jobs/${jobId}/threads`);
    found = threads.body.threads.some((t) => t.messages.some((m) => m.content === '[Bot reply] Delayed' && m.channel === 'WHATSAPP'));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(found, 'the raw "Delayed" button-reply text must still be recorded in the job thread');
});

// A QA audit found an inbound WhatsApp message landed in the `messages`
// table (and rendered fine if you already had that job's thread open) but
// never notified anyone and never pushed a live socket update — unlike the
// web composer's send path (routes/job-extras.routes.js), which does both
// right after its own INSERT. The cross-job "Messages" page in the sidebar
// only refreshes its conversation list on a notification of type
// 'message', so a WhatsApp reply was invisible there — the conversation
// just sat unchanged — until the page was manually reloaded and the
// specific thread re-opened. This proves both halves of the fix: the
// shipper gets a real in-app notification, and the cross-job thread list
// (GET /api/messages/threads — what pages/Messages.jsx calls) reflects the
// new message as its lastMessage.
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

test('an inbound WhatsApp message notifies the counterparty and shows up in their cross-job Messages inbox', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'WhatsApp inbox-notify test', readyAt: new Date(Date.now() + 86400000).toISOString(),
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
  const driverPatch = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Inbox Test Driver', driverPhone: '0556660099' });
  assert.equal(driverPatch.status, 200, driverPatch.raw);

  const webhookPayload = {
    entry: [{ changes: [{ value: { messages: [{ id: 'wamid.inbox-notify-1', from: '971556660099', type: 'text', text: { body: 'Held up at the gate, 20 min behind' } }] } }] }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  // The shipper (the counterparty on an ad-hoc-driver's thread) must get a
  // real in-app notification — that's what pages/Messages.jsx listens for
  // to know to refresh its conversation list at all.
  let sawNotification = false;
  for (let i = 0; i < 20; i++) {
    const notifications = await shipper.get('/api/notifications');
    sawNotification = notifications.body.notifications.some((n) => n.job_id === jobId && n.title === 'New message');
    if (sawNotification) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(sawNotification, 'the shipper must be notified of the inbound WhatsApp message, not left to notice on their own');

  // The exact endpoint pages/Messages.jsx calls — the conversation's
  // lastMessage must reflect the WhatsApp reply.
  let found = false;
  for (let i = 0; i < 20; i++) {
    const inbox = await shipper.get('/api/messages/threads');
    const row = inbox.body.threads.find((t) => t.jobId === jobId);
    found = !!row && row.lastMessage && row.lastMessage.content === 'Held up at the gate, 20 min behind' && row.lastMessage.channel === 'WHATSAPP';
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(found, 'the cross-job Messages inbox must show the WhatsApp reply as the conversation\'s latest message');
});

// Real bug: "messaging section is not updating or showing messages sent or
// received until refreshed." The per-thread socket room (lib/socket.js's
// `thread:${id}`, joined via `join_thread`) works correctly once a client
// has that exact thread open — but a client's INBOX (the list of
// conversations, e.g. web/src/pages/Messages.jsx, or the disputed-job
// correspondence in JobDispute.jsx, or the pre-award bid_negotiations chat
// in JobDetail.jsx) never had any live-update path at all: nothing told an
// already-connected client "a message landed in one of your threads" unless
// it had already joined that specific thread room.
//
// The fix reuses an existing signal instead of adding a new server-side
// event: notify() (lib/helpers.js) already pushes a `notification:new`
// event to the recipient's own `user:${id}` room (joined automatically at
// connect, no join_thread needed) for every message-like event — and
// job-extras.routes.js/bids.routes.js already call notify() right
// alongside every message/negotiation insert. These tests prove that
// signal actually reaches a socket that never joined any thread room, for
// every messaging surface in the app — the frontend listens for exactly
// this event to refresh its inbox/dispute/negotiation view.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { startServer, makeClient } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

function connectAs(baseUrl, cookie) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      path: '/api/socket.io',
      extraHeaders: { Cookie: cookie },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
}

test('a threaded job message reaches the recipient\'s socket via notification:new even though it never joined the thread room', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Message realtime inbox test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 900, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bidRes.status, 201, bidRes.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);

  // Shipper connects but deliberately never emits join_thread for anything —
  // this is exactly "Messages.jsx open, no conversation selected yet."
  const shipperSocket = await connectAs(server.baseUrl, shipper.getCookie());
  try {
    const events = [];
    shipperSocket.on('notification:new', (n) => events.push(n));

    const sent = await carrier.post(`/api/jobs/${jobId}/messages`, { content: 'Picking up in 20 minutes', withRole: 'SHIPPER' });
    assert.equal(sent.status, 201, sent.raw);

    await new Promise((r) => setTimeout(r, 500));

    const relevant = events.filter((n) => n.job_id === jobId);
    assert.equal(relevant.length, 1, 'the shipper must receive a live notification for a message on a thread it never joined');
    assert.equal(relevant[0].type, 'message');
  } finally {
    shipperSocket.close();
  }
});

test('disputed-job correspondence (thread_id=null, no socket room at all) still reaches the other party via notification:new', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Dispute realtime inbox test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 900, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bidRes.status, 201, bidRes.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);

  const opened = await admin.post('/api/admin/disputes', { jobId, reason: 'Realtime inbox test dispute' });
  assert.equal(opened.status, 201, opened.raw);

  const carrierSocket = await connectAs(server.baseUrl, carrier.getCookie());
  try {
    const events = [];
    carrierSocket.on('notification:new', (n) => events.push(n));

    const sent = await shipper.post(`/api/jobs/${jobId}/messages`, { content: 'Evidence attached above' });
    assert.equal(sent.status, 201, sent.raw);
    assert.equal(sent.body.threadId, null, 'a disputed job message must have no thread_id — the flat-correspondence path');

    await new Promise((r) => setTimeout(r, 500));

    const relevant = events.filter((n) => n.job_id === jobId && n.type === 'message');
    assert.equal(relevant.length, 1, 'the carrier must be notified of the shipper\'s dispute message even with no thread room to push to');
  } finally {
    carrierSocket.close();
  }
});

test('a pre-award bid_negotiations message reaches the other party via notification:new (no thread room exists for this surface at all)', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Bid negotiation realtime inbox test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 900, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bidRes.status, 201, bidRes.raw);

  const shipperSocket = await connectAs(server.baseUrl, shipper.getCookie());
  try {
    const events = [];
    shipperSocket.on('notification:new', (n) => events.push(n));

    const sent = await carrier.post(`/api/bids/${bidRes.body.bid.id}/negotiation`, { message: 'Can do AED 850 if paid instantly' });
    assert.equal(sent.status, 201, sent.raw);

    await new Promise((r) => setTimeout(r, 500));

    const relevant = events.filter((n) => n.job_id === jobId && n.type === 'bid');
    assert.equal(relevant.length, 1, 'the shipper must be notified of a new pre-award negotiation message live');
  } finally {
    shipperSocket.close();
  }
});

// Notification architecture, Phase 1 of the product-elevation plan:
// notify()/notifyAdmins() (lib/helpers.js) had no severity concept at all
// and never pushed anything live — a connected user only ever saw a new
// notification by polling the bell. This adds a `priority` column derived
// from the existing `type` category, and a same-session live push over
// the already-authenticated Socket.IO connection (one room per user,
// joined automatically at connection time — see lib/socket.js).
//
// Verifies, against real HTTP + real socket.io-client connections (not
// mocks): the DB row gets the right priority for its type, the owning
// user's socket receives the live push, and — the security-relevant
// part — a DIFFERENT connected user never receives it.

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

async function createOpenJob(shipper) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Notification priority test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  return created.body.job.id;
}

test('a bid notification is stored with priority=normal and pushed live only to the shipper, not the bidding carrier', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createOpenJob(shipper);

  // Sockets are closed in `finally` — an assertion throwing below must
  // never leave a connected socket.io-client behind. socket.io-client
  // keeps its own reconnect/keepalive timers running, which keeps
  // Node's event loop alive — a leaked connection here previously hung
  // the entire `node --test` process (not just failed one test) the one
  // time an assertion actually failed (verified while proving this test
  // catches the underlying regression), which would have hung CI too.
  const shipperSocket = await connectAs(server.baseUrl, shipper.getCookie());
  const carrierSocket = await connectAs(server.baseUrl, carrier.getCookie());
  try {
    const shipperEvents = [];
    const carrierEvents = [];
    shipperSocket.on('notification:new', (n) => shipperEvents.push(n));
    carrierSocket.on('notification:new', (n) => carrierEvents.push(n));

    const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
      amountAed: 1500, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
    });
    assert.equal(bid.status, 201, bid.raw);

    // Live push is best-effort/async relative to the HTTP response — give it
    // a moment rather than asserting immediately.
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(shipperEvents.length, 1, 'the shipper (notification recipient) must receive exactly one live push');
    assert.equal(shipperEvents[0].type, 'bid');
    assert.equal(shipperEvents[0].priority, 'normal');
    assert.equal(shipperEvents[0].job_id, jobId);

    assert.equal(carrierEvents.length, 0, 'the bidding carrier is not the recipient and must receive nothing — tenant isolation');
  } finally {
    shipperSocket.close();
    carrierSocket.close();
  }

  // Durable row must match what was pushed, independent of push delivery.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const row = db.prepare(`SELECT type, priority, job_id, is_read FROM notifications WHERE title='New bid received' AND job_id=?`).get(jobId);
  assert.ok(row, 'notification row must exist regardless of whether anyone was connected to receive the push');
  assert.equal(row.type, 'bid');
  assert.equal(row.priority, 'normal');
  assert.equal(row.is_read, 0);
  db.close();
});

test('a dispute notification is stored with priority=high', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const jobId = await createOpenJob(shipper);
  const opened = await admin.post('/api/admin/disputes', { jobId, reason: 'Notification priority test dispute' });
  assert.equal(opened.status, 201, opened.raw);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const row = db.prepare(`SELECT type, priority FROM notifications WHERE job_id=? AND type='dispute' ORDER BY id DESC LIMIT 1`).get(jobId);
  assert.ok(row, 'a dispute-type notification must have been recorded');
  assert.equal(row.priority, 'high');
  db.close();
});

test('single-notification mark-read only affects that row, mark-all affects every row', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId1 = await createOpenJob(shipper);
  const jobId2 = await createOpenJob(shipper);
  const bid1 = await carrier.post(`/api/jobs/${jobId1}/bids`, { amountAed: 1500, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid1.status, 201, bid1.raw);
  const bid2 = await carrier.post(`/api/jobs/${jobId2}/bids`, { amountAed: 1600, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid2.status, 201, bid2.raw);

  const list = await shipper.get('/api/notifications');
  assert.equal(list.status, 200, list.raw);
  const unread = list.body.notifications.filter((n) => n.job_id === jobId1 || n.job_id === jobId2);
  assert.ok(unread.length >= 2);
  const target = unread.find((n) => n.job_id === jobId1);

  const markOne = await shipper.post(`/api/notifications/${target.id}/read`, {});
  assert.equal(markOne.status, 200, markOne.raw);

  const afterOne = await shipper.get('/api/notifications');
  const targetAfter = afterOne.body.notifications.find((n) => n.id === target.id);
  const otherAfter = afterOne.body.notifications.find((n) => n.job_id === jobId2);
  assert.equal(targetAfter.is_read, 1, 'the marked notification must be read');
  assert.equal(otherAfter.is_read, 0, 'an unrelated notification must remain unread');

  const markAll = await shipper.post('/api/notifications/read', {});
  assert.equal(markAll.status, 200, markAll.raw);
  const afterAll = await shipper.get('/api/notifications');
  assert.ok(afterAll.body.notifications.every((n) => n.is_read === 1));
});

test('a user cannot mark another user\'s notification as read', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createOpenJob(shipper);
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, { amountAed: 1500, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid.status, 201, bid.raw);

  const list = await shipper.get('/api/notifications');
  const shipperNotification = list.body.notifications.find((n) => n.job_id === jobId);
  assert.ok(shipperNotification);

  // Carrier attempts to mark the SHIPPER's notification read.
  const crossMark = await carrier.post(`/api/notifications/${shipperNotification.id}/read`, {});
  assert.equal(crossMark.status, 200); // route doesn't 403 — it just matches nothing

  const stillUnread = await shipper.get('/api/notifications');
  const stillThere = stillUnread.body.notifications.find((n) => n.id === shipperNotification.id);
  assert.equal(stillThere.is_read, 0, 'a user must never be able to mark another user\'s notification as read');
});

// Coverage for the pre-award negotiation + itemized ancillary charges +
// confirm-terms gate (server/routes/bids.routes.js,
// server/services/award.service.js). Award previously happened instantly
// with no negotiation step at all — this is new.

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

async function postJobAndBid(shipper, carrier) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1',
    deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — negotiation regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  return { jobId, bidId: bid.body.bid.id };
}

test('award is blocked until terms are confirmed, unless skipNegotiation is explicitly set', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const { jobId, bidId } = await postJobAndBid(shipper, carrier);

  const blocked = await shipper.post(`/api/jobs/${jobId}/award`, { bidId });
  assert.equal(blocked.status, 409, 'award without confirmed terms and without skipNegotiation must be rejected');
  assert.match(blocked.raw, /Terms not yet confirmed/);

  const skipped = await shipper.post(`/api/jobs/${jobId}/award`, { bidId, skipNegotiation: true });
  assert.equal(skipped.status, 200, skipped.raw);
});

test('a third-party carrier cannot access another bid\'s negotiation or ancillary charges', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const outsider = makeClient(server.baseUrl);
  await outsider.login('falcon@containerxpress.ae', 'demo1234');
  const { bidId } = await postJobAndBid(shipper, carrier);

  const negotiationBlocked = await outsider.get(`/api/bids/${bidId}/negotiation`);
  assert.equal(negotiationBlocked.status, 403);
  const chargesBlocked = await outsider.post(`/api/bids/${bidId}/ancillary-charges`, { chargeType: 'SALIK', amountAed: 20 });
  assert.equal(chargesBlocked.status, 403);
});

test('an ancillary charge must be agreed by both sides before confirm-terms succeeds, then award proceeds', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const { jobId, bidId } = await postJobAndBid(shipper, carrier);

  // Negotiation thread works both ways.
  const msg1 = await shipper.post(`/api/bids/${bidId}/negotiation`, { message: 'Any Salik charges expected on this route?' });
  assert.equal(msg1.status, 201, msg1.raw);
  const msg2 = await carrier.post(`/api/bids/${bidId}/negotiation`, { message: 'Yes, roughly AED 25 round trip.' });
  assert.equal(msg2.status, 201, msg2.raw);
  const thread = await shipper.get(`/api/bids/${bidId}/negotiation`);
  assert.equal(thread.body.messages.length, 2);

  // Carrier proposes a Salik charge — proposer's own side is auto-agreed,
  // the other side is not, yet.
  const propose = await carrier.post(`/api/bids/${bidId}/ancillary-charges`, { chargeType: 'SALIK', amountAed: 25 });
  assert.equal(propose.status, 201, propose.raw);
  assert.equal(propose.body.charge.agreed_by_carrier, 1);
  assert.equal(propose.body.charge.agreed_by_shipper, 0);
  const chargeId = propose.body.charge.id;

  const confirmTooSoon = await shipper.post(`/api/bids/${bidId}/confirm-terms`, {});
  assert.equal(confirmTooSoon.status, 400, 'confirm-terms must fail while any charge is not yet agreed by both sides');

  const agree = await shipper.post(`/api/bids/${bidId}/ancillary-charges/${chargeId}/agree`, {});
  assert.equal(agree.status, 200, agree.raw);
  assert.equal(agree.body.charge.agreed_by_shipper, 1);

  const confirm = await shipper.post(`/api/bids/${bidId}/confirm-terms`, {});
  assert.equal(confirm.status, 200, confirm.raw);
  assert.ok(confirm.body.bid.terms_confirmed_at, 'terms_confirmed_at must be set once every charge is agreed');

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId });
  assert.equal(award.status, 200, award.raw);
});

test('confirm-terms succeeds with zero ancillary charges (nothing to discuss on a simple job)', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const { jobId, bidId } = await postJobAndBid(shipper, carrier);

  const confirm = await shipper.post(`/api/bids/${bidId}/confirm-terms`, {});
  assert.equal(confirm.status, 200, confirm.raw);

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId });
  assert.equal(award.status, 200, award.raw);
});

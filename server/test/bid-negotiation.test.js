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

test('a carrier can declare ancillary charges at bid time, and the shipper sees them; a competing bidder never sees another bidder\'s price, charges, or docs while OPEN', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrierA = makeClient(server.baseUrl);
  await carrierA.login('carrier@dubaidrayage.com', 'demo1234');
  const carrierB = makeClient(server.baseUrl);
  await carrierB.login('falcon@containerxpress.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — bid-time charges regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 900,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  // Carrier A declares two anticipated charges as part of the bid itself.
  const bidA = await carrierA.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 700, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: '3-axle flatbed',
    ancillaryCharges: [{ chargeType: 'SALIK', amountAed: 25 }, { chargeType: 'DEMURRAGE', amountAed: 150 }],
  });
  assert.equal(bidA.status, 201, bidA.raw);

  const bidB = await carrierB.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 720, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
    ancillaryCharges: [{ chargeType: 'ETOKEN', amountAed: 40 }],
  });
  assert.equal(bidB.status, 201, bidB.raw);

  // Shipper sees both bids in full, each with its own declared charges,
  // already agreed_by_carrier (the proposer) but not yet by the shipper.
  const asShipper = await shipper.get(`/api/jobs/${jobId}`);
  const shipperBidA = asShipper.body.bids.find((b) => b.id === bidA.body.bid.id);
  assert.equal(shipperBidA.ancillary_charges.length, 2);
  assert.ok(shipperBidA.ancillary_charges.every((c) => c.agreed_by_carrier === 1 && c.agreed_by_shipper === 0));
  const shipperBidB = asShipper.body.bids.find((b) => b.id === bidB.body.bid.id);
  assert.equal(shipperBidB.ancillary_charges.length, 1);
  assert.equal(shipperBidB.ancillary_charges[0].charge_type, 'ETOKEN');

  // Carrier B (a competing bidder) must never see carrier A's price or
  // ancillary charges while the job is still OPEN — "no bidder should
  // watch other bidders' price and everything, docs etc."
  const asCarrierB = await carrierB.get(`/api/jobs/${jobId}`);
  const bidAAsSeenByB = asCarrierB.body.bids.find((b) => b.id === bidA.body.bid.id);
  assert.equal(bidAAsSeenByB.masked, true);
  assert.equal(bidAAsSeenByB.amount_aed, null, 'a competing bidder must not see another bidder\'s price while OPEN');
  assert.deepEqual(bidAAsSeenByB.ancillary_charges, [], 'a competing bidder must not see another bidder\'s ancillary charges while OPEN');
  // Carrier B must still see their OWN bid in full.
  const ownBidAsSeenByB = asCarrierB.body.bids.find((b) => b.id === bidB.body.bid.id);
  assert.equal(ownBidAsSeenByB.amount_aed, 720);
  assert.equal(ownBidAsSeenByB.ancillary_charges.length, 1);
});

test('a losing bidder can see the winning bid\'s price/charges post-award (market info) but never the driver\'s name/phone', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const winner = makeClient(server.baseUrl);
  await winner.login('carrier@dubaidrayage.com', 'demo1234');
  const loser = makeClient(server.baseUrl);
  await loser.login('falcon@containerxpress.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — post-award masking regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 900,
  });
  const jobId = created.body.job.id;
  const winningBid = await winner.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 700, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
    ancillaryCharges: [{ chargeType: 'SALIK', amountAed: 25 }],
  });
  const losingBid = await loser.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 750, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(losingBid.status, 201, losingBid.raw);

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: winningBid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  await winner.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Ahmed Al Mazrouei', driverPhone: '0551112222' });

  const asLoser = await loser.get(`/api/jobs/${jobId}`);
  assert.equal(asLoser.body.job.assigned_driver_name, null, 'driver identity must stay masked from a losing bidder after award');
  assert.equal(asLoser.body.job.assigned_driver_phone, null);
  const winningBidAsSeenByLoser = asLoser.body.bids.find((b) => b.id === winningBid.body.bid.id);
  assert.equal(winningBidAsSeenByLoser.amount_aed, 700, 'price stays visible post-award as market info');
  assert.equal(winningBidAsSeenByLoser.ancillary_charges.length, 1, 'ancillary charges stay visible post-award, same treatment as price');
});

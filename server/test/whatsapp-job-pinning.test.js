// Formally scoping the WhatsApp "which job is this reply about" heuristic
// (previously just "whichever active job for this phone was updated most
// recently", flagged as medium-confidence): a driver can legitimately have
// more than one active job bound to the same phone at once — e.g. a
// delivery-confirmation prompt goes out for job A the moment it hits
// IN_TRANSIT, then the carrier assigns the same driver (same phone) to a
// second job B before the driver replies. B's assignment bumps its
// updated_at to be the newest of the two, so a "most recently updated"
// heuristic would misroute the "Delivered" reply to B — which isn't even
// IN_TRANSIT yet — dropping the actual confirmation for A. Now the reply is
// pinned to whichever job's interactive prompt last invited a reply
// (whatsapp_sessions.last_outbound_job_id, set only by sends that actually
// carry Delivered/Delayed/Issue-style buttons — see lib/whatsapp.js's
// recordOutboundJobContext()), not just recency.
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

async function awardedJob(shipper, carrier, note) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: `Job pinning test — ${note}`, readyAt: new Date(Date.now() + 86400000).toISOString(),
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
  return jobId;
}

test('an inbound reply is pinned to the job whose prompt invited it, not just the most recently updated active job for that phone', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const phone = '0556665555';
  const jobAId = await awardedJob(shipper, carrier, 'job A — goes IN_TRANSIT first');
  const jobBId = await awardedJob(shipper, carrier, 'job B — assigned after, stays AWARDED');

  // Job A: bind the driver and run it to IN_TRANSIT — this is what fires
  // sendDeliveryConfirmationPrompt() and pins last_outbound_job_id to A.
  const driverA = await carrier.patch(`/api/jobs/${jobAId}/driver`, { driverName: 'Pin Test Driver', driverPhone: phone });
  assert.equal(driverA.status, 200, driverA.raw);
  const pickedUp = await carrier.patch(`/api/jobs/${jobAId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  const inTransit = await carrier.patch(`/api/jobs/${jobAId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);

  // Job B: bind the SAME phone afterward — no interactive prompt goes out
  // for a plain driver assignment, so the pin must stay on A. B's
  // updated_at is now strictly newer than A's, which is exactly the
  // condition that used to misroute the reply.
  const driverB = await carrier.patch(`/api/jobs/${jobBId}/driver`, { driverName: 'Pin Test Driver', driverPhone: phone });
  assert.equal(driverB.status, 200, driverB.raw);
  const jobBCheck = await shipper.get(`/api/jobs/${jobBId}`);
  assert.equal(jobBCheck.body.job.status, 'AWARDED', 'sanity: B must still be AWARDED, not IN_TRANSIT, when the reply arrives');

  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.pinning-test',
            from: '971556665555',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'DELIVERED', title: 'Delivered' } },
          }],
        },
      }],
    }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  let jobA;
  for (let i = 0; i < 20; i++) {
    const detail = await shipper.get(`/api/jobs/${jobAId}`);
    jobA = detail.body.job;
    if (jobA.status === 'DELIVERED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(jobA.status, 'DELIVERED', 'the reply must confirm delivery on A — the job whose prompt actually invited it');

  const jobBFinal = await shipper.get(`/api/jobs/${jobBId}`);
  assert.equal(jobBFinal.body.job.status, 'AWARDED', 'B must be completely untouched by a reply that was never about it');
});

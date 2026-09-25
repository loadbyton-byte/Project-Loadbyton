// A QA audit found the inbound WhatsApp "Issue" button reply was log-only —
// a driver tapping it left a chat line for a human to *maybe* notice, but
// never froze escrow or notified an admin the way the web dispute form
// does. Now it files a real dispute through the same services/dispute.
// service.js path the web form uses (dispute_type OTHER, since a button tap
// carries no further detail), which freezes escrow and notifies admins —
// covered here via the real HTTP webhook, exactly as Meta would deliver it.
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
    deliveryAddress: 'WhatsApp dispute test', readyAt: new Date(Date.now() + 86400000).toISOString(),
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
  const driverPatch = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Issue Test Driver', driverPhone: driverPhoneLocal });
  assert.equal(driverPatch.status, 200, driverPatch.raw);
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  const inTransit = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);

  return { jobId, shipper, carrier };
}

async function postIssueButtonReply(driverPhoneE164) {
  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: `wamid.issue-${Date.now()}-${Math.random()}`,
            from: driverPhoneE164,
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'ISSUE', title: 'Issue' } },
          }],
        },
      }],
    }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);
}

test('an inbound "Issue" button reply files a real dispute — job freezes to DISPUTED, not just a chat line', async () => {
  const { jobId, shipper, carrier } = await inTransitJobWithDriverPhone('0556663333');
  await postIssueButtonReply('971556663333');

  let job;
  for (let i = 0; i < 20; i++) {
    const detail = await shipper.get(`/api/jobs/${jobId}`);
    job = detail.body.job;
    if (job.status === 'DISPUTED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(job.status, 'DISPUTED', 'the "Issue" button reply must actually freeze the job, not just log a message');
  assert.equal(job.escrow_status, 'DISPUTED');

  const disputeRes = await carrier.get(`/api/jobs/${jobId}/dispute`);
  assert.equal(disputeRes.status, 200, disputeRes.raw);
  assert.equal(disputeRes.body.dispute.dispute_type, 'OTHER');
  assert.match(disputeRes.body.dispute.reason, /WhatsApp/);
  assert.ok(disputeRes.body.dispute.sla_deadline, 'sla_deadline must be set like any other dispute');

  // The button-reply text itself should still land in the thread too —
  // filing the dispute must not replace that, only add to it.
  let foundMessage = false;
  for (let i = 0; i < 20; i++) {
    const threads = await carrier.get(`/api/jobs/${jobId}/threads`);
    foundMessage = threads.body.threads.some((t) => t.messages.some((m) => m.content === '[Bot reply] Issue' && m.channel === 'WHATSAPP'));
    if (foundMessage) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(foundMessage, 'the raw button-reply text must still be recorded in the job thread');
});

test('a repeat "Issue" tap on an already-disputed job does not create a second dispute or crash the webhook', async () => {
  const { jobId, shipper } = await inTransitJobWithDriverPhone('0557774444');
  await postIssueButtonReply('971557774444');

  let job;
  for (let i = 0; i < 20; i++) {
    const detail = await shipper.get(`/api/jobs/${jobId}`);
    job = detail.body.job;
    if (job.status === 'DISPUTED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(job.status, 'DISPUTED');

  // Second tap — fileDispute rejects a job already in DISPUTED status (not
  // in DISPUTABLE_STATUSES), and the webhook must swallow that error rather
  // than 500 or leave the job in a broken state.
  await postIssueButtonReply('971557774444');
  await new Promise((r) => setTimeout(r, 300));

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const count = db.prepare('SELECT COUNT(*) as n FROM disputes WHERE job_id=?').get(jobId);
  db.close();
  assert.equal(count.n, 1, 'a repeat "Issue" tap must not create a duplicate dispute');
});

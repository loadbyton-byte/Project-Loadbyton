// A QA audit found two real gaps in the inbound WhatsApp webhook: an
// inbound voice/audio message had no case in extractContent() at all and
// was silently dropped (not stored, not logged, nothing), and an inbound
// photo only ever stored the literal string '[Photo attachment]' — the
// real image was never fetched from Meta, so nothing showed up in the
// job's Documents tab. Both are now handled: extractContent() has an
// audio case, and storeInboundMedia() (whatsapp.routes.js) downloads the
// real attachment via lib/whatsapp.js's downloadWhatsAppMedia() and
// attaches it to the job as a real job_documents row.
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

async function postAwardedJobWithDriverPhone(driverPhoneLocal) {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'WhatsApp media test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  const driver = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Media Test Driver', driverPhone: driverPhoneLocal });
  assert.equal(driver.status, 200, driver.raw);

  return { jobId, shipper, carrier };
}

test('an inbound voice/audio message is no longer silently dropped — it lands in the job thread like a photo does', async () => {
  const { jobId, carrier } = await postAwardedJobWithDriverPhone('0556661111');

  const webhookPayload = {
    entry: [{ changes: [{ value: { messages: [{ id: 'wamid.audio1', from: '971556661111', type: 'audio', audio: { id: 'meta-audio-id-1' } }] } }] }],
  };
  const hook = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload),
  });
  assert.equal(hook.status, 200);

  let found = false;
  for (let i = 0; i < 20; i++) {
    const threads = await carrier.get(`/api/jobs/${jobId}/threads`);
    found = threads.body.threads.some((t) => t.messages.some((m) => m.content === '[Voice message]' && m.channel === 'WHATSAPP'));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(found, 'an inbound audio message must be recorded, not silently dropped — this is the real bug the fix closes');
});

test('when Meta media download succeeds, the real photo is stored as a job_documents row (WHATSAPP_MEDIA), not just a placeholder chat line', async () => {
  const { jobId } = await postAwardedJobWithDriverPhone('0557772222');

  // The spawned server child was started with NO WhatsApp credentials
  // (dark by default, matching CI) — these env vars are set only in THIS
  // test process, for the direct in-process call below, and never reach
  // the child (its env was captured at spawn time in harness.js).
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
  process.env.DB_PATH = server.dbPath;

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('graph.facebook.com') && !String(url).includes('lookaside')) {
      return { ok: true, json: async () => ({ url: 'https://lookaside.fbsbx.com/signed/media-abc', mime_type: 'image/jpeg' }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-photo-bytes').buffer, headers: new Map([['content-type', 'image/jpeg']]) };
  };

  try {
    // First require of ../routes/whatsapp.routes in this process — connects
    // to the SAME sqlite file the spawned child server is already using
    // (DB_PATH set above), a second, independent connection to it (WAL
    // mode; already proven safe for concurrent access elsewhere in this
    // suite). Calling the exported handler directly, not over HTTP, is
    // what makes mocking global.fetch for the Meta download actually work
    // — the real webhook's fetch calls happen inside the spawned child's
    // own process, which this test process cannot intercept.
    const whatsappRoutes = require('../routes/whatsapp.routes');
    await whatsappRoutes.handleInboundMessage({
      id: 'wamid.media-direct-1', from: '971557772222', type: 'image', image: { id: 'meta-media-id-xyz' },
    });
  } finally {
    global.fetch = originalFetch;
  }

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const row = db.prepare(`SELECT * FROM job_documents WHERE job_id=? AND doc_type='WHATSAPP_MEDIA'`).get(jobId);
  db.close();

  assert.ok(row, 'a job_documents row must exist for the downloaded photo');
  assert.equal(row.mime_type, 'image/jpeg');
  assert.ok(row.storage_path, 'storage_path must be set — the file was actually saved, not just recorded as an intent');
  assert.ok(row.title.includes('photo'), `title should describe what this is (got: ${row.title})`);
});

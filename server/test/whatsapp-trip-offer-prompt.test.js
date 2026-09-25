// sendTripOfferPrompt() closes a real gap: the trip-offer Accept/Decline
// send used to go straight to sendInteractiveButtons() with no fallback —
// if the pool driver's 24h session was closed (the common case for a
// driver not currently mid-conversation), Meta silently rejected the send
// and the driver never saw the offer. This mirrors
// sendDeliveryConfirmationPrompt()'s existing open/closed-session
// branching: interactive buttons when a session is open, the
// pre-approved 'trip_offer_new' template otherwise.
//
// process.env set at module scope (before requiring lib/whatsapp or db) —
// same isolation pattern as whatsapp-session-key.test.js and
// whatsapp-media-download.test.js: a fresh DB file so isSessionOpen()'s
// lookups don't touch the shared dev DB, and fake credentials so
// isConfigured() is true and the real send path (with global.fetch
// mocked) actually runs instead of short-circuiting to 'not_configured'.
process.env.DB_PATH = require('node:path').join(__dirname, '..', 'data', `test-whatsapp-trip-offer-prompt-${process.pid}.db`);
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.after(() => {
  try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  try { fs.unlinkSync(process.env.DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch {}
});

test('an open session gets the interactive Accept/Decline buttons, not the template', async (t) => {
  const { recordInboundSession, sendTripOfferPrompt } = require('../lib/whatsapp');
  await recordInboundSession('971501112222');

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await sendTripOfferPrompt({ to: '0501112222', jobCode: 'LBT-1', pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH' });
  assert.equal(result.sent, true, JSON.stringify(result));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.type, 'interactive');
  const buttonIds = calls[0].body.interactive.action.buttons.map((b) => b.reply.id);
  assert.deepEqual(buttonIds, ['ACCEPT_TRIP', 'DECLINE_TRIP']);
});

test('a closed session falls back to the trip_offer_new template instead of silently failing', async (t) => {
  const { sendTripOfferPrompt } = require('../lib/whatsapp');

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  t.after(() => { global.fetch = originalFetch; });

  // A phone that has never messaged in — no open session.
  const result = await sendTripOfferPrompt({ to: '0509998888', jobCode: 'LBT-2', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ' });
  assert.equal(result.sent, true, JSON.stringify(result));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.type, 'template');
  assert.equal(calls[0].body.template.name, 'trip_offer_new');
  assert.deepEqual(
    calls[0].body.template.components[0].parameters.map((p) => p.text),
    ['LBT-2', 'JEBEL_ALI_T1', 'AL_QUOZ']
  );
});

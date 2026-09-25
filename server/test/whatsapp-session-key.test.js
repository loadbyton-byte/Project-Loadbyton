// A closer look at the "session window" while formally scoping it (per a
// standing follow-up item) found isSessionOpen()/recordInboundSession()
// keyed whatsapp_sessions by whatever raw phone format the caller happened
// to pass in: recordInboundSession() gets the webhook's bare E.164 digits
// (e.g. "971501234444"), while isSessionOpen() gets a stored driver phone
// in local format (e.g. "0501234444"). Those never matched as exact
// strings, so a session could never be found "open" for a real driver
// phone — the interactive-buttons delivery-confirmation flow silently fell
// through to the template fallback every time, even seconds after the
// driver had just replied. Both now key on the same last9Digits() helper
// every other phone comparison in this codebase already uses.
//
// Isolated from the shared dev DB the way lib/whatsapp.js's own header
// comment describes (DB_PATH set before the first require('../db')) — this
// is a unit test, not a harness/HTTP test, since neither function needs a
// running server.
process.env.DB_PATH = require('node:path').join(__dirname, '..', 'data', `test-whatsapp-session-key-${process.pid}.db`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.after(() => {
  try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  try { fs.unlinkSync(process.env.DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch {}
});

test('a session opened by a webhook-format inbound phone is found open when checked with a locally-formatted stored phone', async () => {
  const { isSessionOpen, recordInboundSession } = require('../lib/whatsapp');

  // Simulates the real mismatch: Meta's webhook always delivers bare
  // E.164 digits with the country code, no plus, no leading zero.
  await recordInboundSession('971501234444');
  assert.equal(await isSessionOpen('971501234444'), true, 'sanity: same format must already work');

  // The actual bug — a driver phone as PATCH /api/jobs/:id/driver or the
  // drivers table would realistically store it (local 0-prefixed).
  assert.equal(await isSessionOpen('0501234444'), true, 'a session opened by the E.164 form must be found by the local-format form too');
  assert.equal(await isSessionOpen('+971 50 123 4444'), true, 'and by a spaced/plus-prefixed form');
});

test('an unrelated phone number never reads as an open session', async () => {
  const { isSessionOpen, recordInboundSession } = require('../lib/whatsapp');
  await recordInboundSession('971501235555');
  assert.equal(await isSessionOpen('0509999999'), false);
});

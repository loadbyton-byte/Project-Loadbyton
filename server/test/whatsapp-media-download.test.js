// Unit coverage for lib/whatsapp.js's downloadWhatsAppMedia() — the new
// two-step Meta Graph API media fetch (resolve media_id -> signed URL,
// then download from that URL). Runs with global.fetch mocked, same
// pattern as test/telr-split-payment.test.js: proves the request-building
// and response-handling logic, not that Meta's actual API accepts this
// exact shape (a live sandbox call is out of scope for this test).

process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';

const test = require('node:test');
const assert = require('node:assert/strict');
const whatsapp = require('../lib/whatsapp');

test('downloadWhatsAppMedia resolves the media_id to a signed URL, then downloads from it with the same bearer token', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, authHeader: opts && opts.headers && opts.headers.Authorization });
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ url: 'https://lookaside.fbsbx.com/signed/media123', mime_type: 'image/jpeg' }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-jpeg-bytes').buffer, headers: new Map([['content-type', 'image/jpeg']]) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await whatsapp.downloadWhatsAppMedia('media123');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(Buffer.isBuffer(result.buffer), true);
  assert.equal(result.buffer.toString(), 'fake-jpeg-bytes');

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /graph\.facebook\.com.*\/media123$/);
  assert.equal(calls[0].authHeader, 'Bearer test-access-token');
  assert.equal(calls[1].url, 'https://lookaside.fbsbx.com/signed/media123');
  assert.equal(calls[1].authHeader, 'Bearer test-access-token');
});

test('downloadWhatsAppMedia reports provider_error when the media-metadata lookup fails, without attempting a download', async (t) => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { calls += 1; return { ok: false, status: 404 }; };
  t.after(() => { global.fetch = originalFetch; });

  const result = await whatsapp.downloadWhatsAppMedia('missing-media');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_error');
  assert.equal(result.status, 404);
  assert.equal(calls, 1, 'must not attempt the second (binary download) request when the first fails');
});

test('downloadWhatsAppMedia reports download_failed when the signed URL itself 4xxs', async (t) => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return { ok: true, json: async () => ({ url: 'https://lookaside.fbsbx.com/signed/expired' }) };
    return { ok: false, status: 410 };
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await whatsapp.downloadWhatsAppMedia('expired-media');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'download_failed');
  assert.equal(result.status, 410);
});

test('downloadWhatsAppMedia never touches the network without a media_id, or when not configured', async (t) => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not be called'); };
  t.after(() => { global.fetch = originalFetch; });

  const noId = await whatsapp.downloadWhatsAppMedia(null);
  assert.equal(noId.ok, false);
  assert.equal(noId.reason, 'no_media_id');
  assert.equal(called, false);

  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  const dark = await whatsapp.downloadWhatsAppMedia('some-media');
  process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
  assert.equal(dark.ok, false);
  assert.equal(dark.reason, 'not_configured');
  assert.equal(called, false);
});

// Unit-level, no server boot needed: the Cloudflare-aware IP resolution
// (rate limiting behind the live deployment's Cloudflare + Render double
// proxy) and the HSTS gating logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const { byIp } = require('../lib/rateLimit');
const { startServer } = require('./harness');

test('byIp resolves from req.ip only — client-supplied proxy headers are ignored (M1)', () => {
  // A direct-to-origin attacker can set ANY header — cf-connecting-ip must
  // not be trusted (it was: a fake header per request gave an unlimited
  // key-space and zero rate limiting). req.ip comes from X-Forwarded-For
  // through the trusted-hop count, which Render sets at its edge.
  const withSpoofedCf = { headers: { 'cf-connecting-ip': '203.0.113.9' }, ip: '10.0.0.1' };
  assert.equal(byIp(withSpoofedCf), '10.0.0.1', 'the spoofed cf-connecting-ip header must be ignored');

  const withoutCf = { headers: {}, ip: '10.0.0.1' };
  assert.equal(byIp(withoutCf), '10.0.0.1', 'resolves to req.ip');
});

test('HSTS is gated on req.secure — a plain-HTTP response never sends it', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), null, 'HSTS over plain HTTP would be a no-op at best and a misconfiguration signal at worst');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'sanity check: other security headers still present');
  } finally {
    await server.stop();
  }
});

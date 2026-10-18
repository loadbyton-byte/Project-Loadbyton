// HMAC request/event signing shared with Loadbyton-OS (same scheme as its
// merchant webhooks, docs/API.md): header `LBT-Signature: t=<unix>,v1=<hex>`
// where v1 = HMAC-SHA256(secret, `${t}.${payload}`). Verification rejects a
// timestamp outside the tolerance window and compares in constant time.

'use strict';

const crypto = require('node:crypto');

const DEFAULT_TOLERANCE_SECONDS = 300;

function sign(secret, payload, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function parseHeader(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function verify(secret, payload, header, { now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = {}) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  const { t, v1 } = parseHeader(header);
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[0-9a-f]+$/.test(v1)) return { ok: false, reason: 'malformed' };
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > toleranceSeconds) return { ok: false, reason: 'stale' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  const given = Buffer.from(v1, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

module.exports = { sign, verify, parseHeader, DEFAULT_TOLERANCE_SECONDS };

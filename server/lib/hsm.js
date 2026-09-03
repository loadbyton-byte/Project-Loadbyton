// HSM-simulated multi-sig ledger — SHA-256 hash chain + 2-of-3 sigs
// In prod: replace verify() with PKCS#11 call to AWS CloudHSM / Thales.
// Here: HSM_SECRET env holds 3 hex keys, signatures are HMAC-SHA256.
const crypto = require('node:crypto');
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function ledgerHash(prevHash, jobId, action, amount, timestamp) {
  return sha256(`${prevHash||'GENESIS'}|${jobId}|${action}|${amount}|${timestamp}`);
}
function sign(payload, key) { return crypto.createHmac('sha256', key).update(payload).digest('hex'); }
function verifyMultiSig(payload, sigs, keys) {
  if (!keys || keys.length === 0) return true; // dev mode: no HSM configured at all → auto-pass
  // 1 key present is a misconfigured/mid-rotation state, not "unconfigured"
  // — fail closed rather than silently skipping the multi-sig check.
  if (keys.length < 2) return false;
  let valid = 0;
  for (const k of keys) { const s = sign(payload, k); if (sigs.includes(s)) valid++; }
  return valid >= 2; // 2-of-3
}
function getHsmKeys() {
  const raw = process.env.HSM_SECRET || '';
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}
module.exports = { sha256, ledgerHash, sign, verifyMultiSig, getHsmKeys };

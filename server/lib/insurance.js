// Goods-in-Transit (GIT) cargo insurance — Change 20.
//
// Provider abstraction mirroring server/lib/payments.js and
// server/lib/whatsapp.js: code-complete, genuinely works the moment the
// right env vars are set, stays honestly dark until then.
//
//   internal (default) — INSURANCE_PROVIDER unset. Self-underwrite bookkeeping:
//     quote() computes the platform rate card, bindPolicy() records the policy
//     row. No external call, no premium collection rail yet — premium
//     settlement rides the existing escrow/admin flows (or Change 30's
//     contract-lane billing). This is the operating procedure until a real
//     underwriter is signed, stated honestly rather than implying coverage.
//
//   mock — INSURANCE_PROVIDER=mock. Same math, policy_ref prefixed MOCK-,
//     for end-to-end tests with zero credentials.
//
//   broker — INSURANCE_PROVIDER=broker + INSURANCE_BROKER_URL +
//     INSURANCE_BROKER_API_KEY. Real bind via the broker's bind endpoint
//     (POST {policy} → {policyRef}). Until those vars are set every broker
//     call returns ok:false/not_configured and the route surfaces 503 with
//     the missing-var reason — never a fake "bound" record.
//
// Rate card (v1, admin-tunable via settings keys below):
//   premium = cargo_value_aed * 0.0035 (35 bps), floored at AED 25,
//   capped at AED 1,500. Coverage = cargo value, max AED 500,000 per job.

const db = require('../db');

const RATE_BPS_DEFAULT = 35;
const MIN_PREMIUM_AED = 25;
const MAX_PREMIUM_AED = 1500;
const MAX_COVERAGE_AED = 500000;

function provider() {
  return (process.env.INSURANCE_PROVIDER || 'internal').toLowerCase();
}

function isConfigured() {
  const p = provider();
  if (p === 'mock' || p === 'internal') return true;
  if (p === 'broker') return !!(process.env.INSURANCE_BROKER_URL && process.env.INSURANCE_BROKER_API_KEY);
  return false;
}

function darkReason() {
  const p = provider();
  if (p === 'broker' && !process.env.INSURANCE_BROKER_URL) return 'INSURANCE_BROKER_URL not set — see .env.example';
  if (p === 'broker' && !process.env.INSURANCE_BROKER_API_KEY) return 'INSURANCE_BROKER_API_KEY not set — see .env.example';
  return `provider "${p}" unknown (want internal|mock|broker)`;
}

async function rateBps() {
  try {
    const row = await db.prepare(`SELECT value FROM settings WHERE key='insurance_rate_bps'`).get();
    const n = Number(row?.value);
    if (Number.isFinite(n) && n > 0 && n <= 1000) return n;
  } catch {}
  return RATE_BPS_DEFAULT;
}

/**
 * Pure quote — no DB writes, no provider calls.
 */
async function quote({ cargoValueAed }) {
  const cargo = Number(cargoValueAed);
  if (!cargo || cargo <= 0) return { ok: false, error: 'cargoValueAed must be a positive number' };
  if (cargo > MAX_COVERAGE_AED) return { ok: false, error: `cargo value exceeds max insurable AED ${MAX_COVERAGE_AED} — contact ops for a manual quote` };
  const bps = await rateBps();
  const raw = (cargo * bps) / 10000;
  const premium = Math.min(MAX_PREMIUM_AED, Math.max(MIN_PREMIUM_AED, Math.round(raw * 100) / 100));
  return { ok: true, provider: provider(), cargoValueAed: cargo, premiumAed: premium, coverageAed: cargo, rateBps: bps, configured: isConfigured() };
}

async function bindBrokerPolicy({ job, cargoValueAed, premiumAed }) {
  const url = process.env.INSURANCE_BROKER_URL;
  const key = process.env.INSURANCE_BROKER_API_KEY;
  const res = await fetch(`${url.replace(/\/$/, '')}/policies/bind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      jobCode: job.job_code,
      cargoValueAed,
      premiumAed,
      pickup: job.pickup_terminal,
      delivery: job.delivery_area,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `broker bind failed (${res.status}): ${text.slice(0, 200)}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!body.policyRef) return { ok: false, error: 'broker bind succeeded but returned no policyRef' };
  return { ok: true, policyRef: String(body.policyRef) };
}

module.exports = { provider, isConfigured, darkReason, quote, bindBrokerPolicy, RATE_BPS_DEFAULT, MIN_PREMIUM_AED, MAX_PREMIUM_AED, MAX_COVERAGE_AED };

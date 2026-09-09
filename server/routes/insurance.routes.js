// GIT cargo insurance routes (Change 20) — quote is public math, bind is
// shipper-only before pickup. Broker provider stays dark (503) until
// INSURANCE_BROKER_URL + INSURANCE_BROKER_API_KEY are set.
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth, requireApproved, requireSeatRole } = require('../middleware/auth');
const insurance = require('../lib/insurance');
const { chargeFee } = require('../lib/ledger');

const router = require('express').Router();

router.post('/api/insurance/quote', auth(), async (req, res) => {
  const q = await insurance.quote({ cargoValueAed: (req.body || {}).cargoValueAed });
  if (!q.ok) return sendError(res, 400, q.error);
  res.json({ quote: q });
});

router.post('/api/jobs/:id/insurance/bind', auth(['SHIPPER']), requireApproved(), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.shipper_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(job.status)) {
    return sendError(res, 403, 'Insurance can only be bound before pickup');
  }
  const existing = await db.prepare(`SELECT * FROM job_insurance WHERE job_id=?`).get(job.id);
  if (existing) return sendError(res, 409, 'This job already has an active policy');

  const cargoValue = Number((req.body || {}).cargoValueAed ?? job.cargo_value_aed);
  const q = await insurance.quote({ cargoValueAed: cargoValue });
  if (!q.ok) return sendError(res, 400, q.error);

  const p = insurance.provider();
  if (p === 'broker' && !insurance.isConfigured()) {
    return sendError(res, 503, `Insurance broker not configured: ${insurance.darkReason()}`);
  }

  let policyRef = `${p.toUpperCase()}-${job.job_code}-${Date.now().toString(36).toUpperCase()}`;
  if (p === 'broker') {
    const bound = await insurance.bindBrokerPolicy({ job, cargoValueAed: q.cargoValueAed, premiumAed: q.premiumAed });
    if (!bound.ok) return sendError(res, 502, bound.error);
    policyRef = bound.policyRef;
  }

  await db.prepare(`UPDATE jobs SET cargo_value_aed=?, insurance_opt_in=1 WHERE id=?`).run(q.cargoValueAed, job.id);
  let policy;
  try {
    const r = await db
      .prepare(
        `INSERT INTO job_insurance (job_id, shipper_id, provider, cargo_value_aed, premium_aed, coverage_aed, rate_bps, policy_ref)
         VALUES (?,?,?,?,?,?,?,?) RETURNING id`
      )
      .run(job.id, req.user.id, p, q.cargoValueAed, q.premiumAed, q.coverageAed, q.rateBps, policyRef);
    policy = await db.prepare(`SELECT * FROM job_insurance WHERE id=?`).get(Number(r.lastInsertRowid));
    // The premium was computed and quoted but never actually charged — a
    // real bug found in review (a "bound" policy with no matching money
    // movement anywhere). Same chargeFee() rail every other platform fee
    // uses; idempotent per policy so a retry never double-charges.
    await chargeFee(db, {
      idempotencyKey: `insurance-${policy.id}`, feeCode: 'GIT_INSURANCE_PREMIUM',
      jobId: job.id, userId: req.user.id, amountAed: q.premiumAed,
      description: `GIT insurance premium (${job.job_code}, policy ${policyRef}) AED ${q.premiumAed}`,
    });
  } catch (e) {
    // Double-submit race vs the pre-check above: job_id is UNIQUE.
    if (e.code === '23505' || (e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(e.message))) {
      return sendError(res, 409, 'This job already has an active policy');
    }
    throw e;
  }
  const { writeAudit } = require('../lib/helpers');
  await writeAudit(req, { userId: req.actorId, action: 'INSURANCE_BIND', details: `${job.job_code}: GIT policy ${policyRef} bound (AED ${q.premiumAed} on AED ${q.cargoValueAed})`, entityType: 'job', entityId: job.id });
  res.status(201).json({ policy });
});

router.get('/api/jobs/:id/insurance', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  const isParty = req.user.role === 'ADMIN' || job.shipper_id === req.user.id || job.carrier_id === req.user.id;
  if (!isParty) return sendError(res, 403, 'Not permitted');
  const policy = await db.prepare(`SELECT * FROM job_insurance WHERE job_id=?`).get(job.id);
  res.json({ policy: policy || null, provider: insurance.provider(), configured: insurance.isConfigured() });
});

router.post('/api/jobs/:id/insurance/cancel', auth(['SHIPPER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.shipper_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (['IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(job.status)) {
    return sendError(res, 403, 'Insurance can no longer be cancelled once the job is in transit or beyond');
  }
  const policy = await db.prepare(`SELECT * FROM job_insurance WHERE job_id=? AND status='ACTIVE'`).get(job.id);
  if (!policy) return sendError(res, 404, 'No active policy on this job');
  await db.prepare(`UPDATE job_insurance SET status='CANCELLED', cancelled_at=datetime('now') WHERE id=?`).run(policy.id);
  await db.prepare(`UPDATE jobs SET insurance_opt_in=0 WHERE id=?`).run(job.id);
  res.json({ policy: await db.prepare(`SELECT * FROM job_insurance WHERE id=?`).get(policy.id) });
});

module.exports = router;

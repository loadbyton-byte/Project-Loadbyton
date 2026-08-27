const db = require('../db');
const { unifiedLanes } = require('../lib/lanes');
const { issueInvoice } = require('../lib/invoice');
const { sendError } = require('../lib/http');
const { encryptField, decryptField } = require('../lib/crypto');
const { writeAudit, toPublicUser, getSettings, notify } = require('../lib/helpers');
const { refundJobAsync, executePayoutAsync } = require('../services/payout.service');
const { approveAccount, verifyCarrier } = require('../services/verification.service');
const { auth } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/admin/live', auth(['ADMIN']), async (req, res) => {
  const openJobs = await db.prepare(`
    SELECT j.id, j.job_code, j.status, j.shipment_type, j.container_size, j.container_type,
           j.pickup_terminal, j.delivery_area, j.delivery_address, j.max_budget_aed,
           j.equipment_type, j.created_at, j.ready_at, j.deadline,
           u.email AS shipper_email, p.company_name AS shipper_company,
           (SELECT COUNT(*) FROM bids WHERE job_id = j.id AND status = 'PENDING') AS bid_count
    FROM jobs j
    JOIN users u ON u.id = j.shipper_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE j.status = 'OPEN'
    ORDER BY j.created_at DESC
  `).all();

  const openJobIds = openJobs.map((j) => j.id);
  const liveBids = openJobIds.length
    ? await db.prepare(`
        SELECT b.id, b.job_id, b.amount_aed, b.eta_at, b.truck_type, b.notes, b.status, b.created_at,
               u.email AS carrier_email, p.company_name AS carrier_company, p.rating_avg, p.completed_jobs
        FROM bids b
        JOIN users u ON u.id = b.carrier_id
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE b.job_id IN (${openJobIds.map(() => '?').join(',')})
        ORDER BY b.created_at DESC
      `).all(...openJobIds)
    : [];
  const bidsByJob = {};
  for (const b of liveBids) {
    (bidsByJob[b.job_id] ||= []).push(b);
  }

  const activeJobs = await db.prepare(`
    SELECT j.id, j.job_code, j.status, j.agreed_price_aed, j.escrow_status,
           j.pickup_terminal, j.delivery_area, j.created_at,
           j.assigned_driver_name, j.assigned_driver_phone,
           s.email AS shipper_email, sp.company_name AS shipper_company,
           c.email AS carrier_email, cp.company_name AS carrier_company
    FROM jobs j
    JOIN users s ON s.id = j.shipper_id
    LEFT JOIN profiles sp ON sp.user_id = s.id
    LEFT JOIN users c ON c.id = j.carrier_id
    LEFT JOIN profiles cp ON cp.user_id = c.id
    WHERE j.status IN ('AWARDED','PICKED_UP','IN_TRANSIT')
    ORDER BY j.updated_at DESC
    LIMIT 50
  `).all();

  const recentActivity = await db.prepare(`
    SELECT a.id, a.action, a.details, a.entity_type, a.entity_id, a.before_state, a.after_state, a.created_at,
           u.email AS actor_email
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC
    LIMIT 50
  `).all();

  res.json({
    openJobs: openJobs.map((j) => ({ ...j, bids: bidsByJob[j.id] || [] })),
    activeJobs,
    recentActivity,
  });
});

router.get('/api/admin/health', auth(['ADMIN']), async (req, res) => {
  const openJobs = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='OPEN'`).get()).c;
  const totalJobs = (await db.prepare('SELECT COUNT(*) c FROM jobs').get()).c;
  const totalBids = (await db.prepare('SELECT COUNT(*) c FROM bids').get()).c;
  const completedJobs = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='COMPLETED'`).get()).c;
  const escrowHeld = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE escrow_status IN ('HELD','FUNDED')`).get()).s;
  const disputesOpen = (await db.prepare(`SELECT COUNT(*) c FROM disputes WHERE status='OPEN'`).get()).c;
  res.json({
    health: {
      openJobs,
      totalBids,
      avgBidsPerJob: totalJobs ? Math.round((totalBids / totalJobs) * 10) / 10 : 0,
      completionRate: totalJobs ? Math.round((completedJobs / totalJobs) * 1000) / 10 : 0,
      escrowHeld,
      disputesOpen,
      lanes: unifiedLanes,
    },
  });
});

router.get('/api/admin/verification', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.*, p.company_name, p.trn_number, p.trade_license_number, p.phone, p.fleet_size, p.owned_chassis, p.insurance_uploaded, p.coverage_zones
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role='CARRIER' AND u.is_verified=0
       ORDER BY u.created_at ASC`
    )
    .all();
  res.json({
    queue: rows.map((r) => ({
      id: r.id,
      email: r.email,
      tier: r.tier,
      created_at: r.created_at,
      profile: {
        company_name: r.company_name,
        trn_number: decryptField(r.trn_number),
        trade_license_number: r.trade_license_number,
        phone: r.phone,
        fleet_size: r.fleet_size,
        owned_chassis: r.owned_chassis,
        insurance_uploaded: !!r.insurance_uploaded,
        coverage_zones: r.coverage_zones,
      },
    })),
  });
});

router.get('/api/admin/approvals', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.*, p.company_name, p.trn_number, p.trade_license_number, p.phone, p.fleet_size, p.owned_chassis, p.insurance_uploaded, p.coverage_zones
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role IN ('SHIPPER','CARRIER') AND u.account_approval_status='PENDING'
       ORDER BY u.created_at ASC`
    )
    .all();
  res.json({
    queue: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      tier: r.tier,
      created_at: r.created_at,
      profile: {
        company_name: r.company_name,
        trn_number: decryptField(r.trn_number),
        trade_license_number: r.trade_license_number,
        phone: r.phone,
        fleet_size: r.fleet_size,
        owned_chassis: r.owned_chassis,
        insurance_uploaded: !!r.insurance_uploaded,
        coverage_zones: r.coverage_zones,
      },
    })),
  });
});

router.post('/api/admin/approve/:id', auth(['ADMIN']), async (req, res) => {
  const { action } = req.body || {};
  try {
    const user = await approveAccount(req, Number(req.params.id), action);
    res.json({ ok: true, user });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
});

router.post('/api/admin/verify/:id', auth(['ADMIN']), async (req, res) => {
  const { action, iban } = req.body || {};
  try {
    const user = verifyCarrier(req, req.params.id, action, iban);
    res.json({ ok: true, user });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
});

const ADMIN_VERIFY_BULK_MAX = 100;

router.post('/api/admin/verify-bulk', auth(['ADMIN']), async (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return sendError(res, 400, 'ids must be a non-empty array');
  if (ids.length > ADMIN_VERIFY_BULK_MAX) return sendError(res, 400, `Cannot bulk-verify more than ${ADMIN_VERIFY_BULK_MAX} at once`);
  if (!['approve', 'reject'].includes(action)) return sendError(res, 400, 'action must be approve or reject');

  const results = await Promise.all(ids.map(async (id) => {
    try {
      await verifyCarrier(req, id, action, undefined);
      return { id, ok: true };
    } catch (e) {
      return { id, ok: false, error: e.message || 'Unknown error' };
    }
  }));
  res.json({ results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

router.get('/api/admin/users', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.*, p.company_name, p.completed_jobs, p.rating_avg
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
       ORDER BY u.created_at DESC`
    )
    .all();
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      is_verified: !!r.is_verified,
      tier: r.tier,
      created_at: r.created_at,
      profile: { company_name: r.company_name, completed_jobs: r.completed_jobs, rating_avg: r.rating_avg },
    })),
  });
});

router.get('/api/admin/referrals', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT referred.id, referred.email, referred.created_at, referred.referred_by,
              referrer.id AS referrer_id, referrer.email AS referrer_email, referrerProfile.company_name AS referrer_company,
              referredProfile.fleet_size AS fleet_size,
              (SELECT COUNT(*) FROM jobs WHERE (jobs.shipper_id = referred.id OR jobs.carrier_id = referred.id) AND jobs.status = 'COMPLETED') AS referred_completed_jobs
       FROM users referred
       JOIN users referrer ON referrer.referral_code = referred.referred_by
       LEFT JOIN profiles referrerProfile ON referrerProfile.user_id = referrer.id
       LEFT JOIN profiles referredProfile ON referredProfile.user_id = referred.id
       WHERE referred.referred_by IS NOT NULL
       ORDER BY referred.created_at DESC`
    )
    .all();
  res.json({
    referrals: rows.map((r) => ({
      referredUserId: r.id,
      referredEmail: r.email,
      referredAt: r.created_at,
      referralCode: r.referred_by,
      referrerId: r.referrer_id,
      referrerEmail: r.referrer_email,
      referrerCompany: r.referrer_company,
      fleetSize: r.fleet_size,
      // Bonus only actually credits once the referred account completes a job —
      // status here reflects that, it isn't a stored/toggleable flag.
      status: r.referred_completed_jobs > 0 ? 'CREDITED' : 'PENDING',
    })),
  });
});

router.post('/api/admin/impersonate/end', auth(), async (req, res) => {
  const adminId = req.session.impersonating_admin_id;
  if (!adminId) return sendError(res, 400, 'Not currently impersonating');
  const admin = await db.prepare('SELECT * FROM users WHERE id=?').get(adminId);
  if (!admin) return sendError(res, 404, 'Original admin account not found');
  await createSession(req, res, admin.id);
  await writeAudit(req, {
    userId: adminId,
    action: 'IMPERSONATE_END',
    details: `Admin ${admin.email} ended impersonation of ${req.user.email} (#${req.user.id})`,
    entityType: 'user',
    entityId: req.user.id,
  });
  res.json({ ok: true, user: await toPublicUser(admin) });
});

router.post('/api/admin/impersonate/:userId', auth(['ADMIN']), async (req, res) => {
  const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.userId);
  if (!target) return sendError(res, 404, 'User not found');
  if (target.role === 'ADMIN') return sendError(res, 400, 'Cannot impersonate another admin');
  await createSession(req, res, target.id, { impersonatingAdminId: req.user.id, maxAgeSeconds: 30 * 60 });
  await writeAudit(req, {
    userId: req.actorId,
    action: 'IMPERSONATE_START',
    details: `Admin ${req.user.email} started impersonating ${target.email} (#${target.id})`,
    entityType: 'user',
    entityId: target.id,
  });
  res.json({ ok: true, user: await toPublicUser(target) });
});

router.post('/api/admin/confirm-receipt', auth(['ADMIN']), async (req, res) => {
  const { jobId } = req.body || {};
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.escrow_status !== 'HELD') return sendError(res, 400, 'Escrow must be HELD to confirm receipt');
  await db.prepare(`UPDATE jobs SET escrow_status='FUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id);
  await writeAudit(req, { userId: req.actorId, action: 'ESCROW_FUND', details: `${job.job_code} funds confirmed received`, entityType: 'job', entityId: job.id, beforeState: 'HELD', afterState: 'FUNDED' });
  res.json({ ok: true });
});

router.get('/api/admin/audit', auth(['ADMIN']), async (req, res) => {
  const entries = await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all();
  res.json({ entries });
});

router.get('/api/admin/disputes', auth(['ADMIN']), async (req, res) => {
  const disputes = await db
    .prepare(`SELECT d.*, j.job_code FROM disputes d JOIN jobs j ON j.id = d.job_id ORDER BY d.created_at DESC`)
    .all();
  res.json({ disputes });
});

router.post('/api/admin/disputes', auth(['ADMIN']), async (req, res) => {
  const { jobId, reason } = req.body || {};
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return sendError(res, 404, 'Job not found');
  if (!reason) return sendError(res, 400, 'reason is required');

  const result = await db.prepare('INSERT INTO disputes (job_id, opened_by, reason, status) VALUES (?,?,?,\'OPEN\')').run(job.id, req.user.id, reason);
  await db.prepare(`UPDATE jobs SET status='DISPUTED', escrow_status='DISPUTED', updated_at=datetime('now') WHERE id=?`).run(job.id);
  await writeAudit(req, { userId: req.actorId, action: 'DISPUTE_OPEN', details: reason, entityType: 'job', entityId: job.id, beforeState: job.status, afterState: 'DISPUTED' });
  await notify(job.shipper_id, 'Dispute opened', `A dispute was opened on ${job.job_code}. Escrow is frozen.`, job.id, 'dispute');
  await notify(job.carrier_id, 'Dispute opened', `A dispute was opened on ${job.job_code}. Escrow is frozen.`, job.id, 'dispute');
  const dispute = await db.prepare('SELECT * FROM disputes WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ dispute });
});

router.post('/api/admin/disputes/:id/resolve', auth(['ADMIN']), async (req, res) => {
  const dispute = await db.prepare('SELECT * FROM disputes WHERE id=?').get(req.params.id);
  if (!dispute) return sendError(res, 404, 'Dispute not found');
  if (dispute.status === 'RESOLVED') return sendError(res, 409, 'Dispute already resolved');
  const { determination, decision } = req.body || {};
  if (!['RELEASE_TO_CARRIER', 'REFUND_SHIPPER', 'SPLIT'].includes(decision)) return sendError(res, 400, 'Invalid decision');
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(dispute.job_id);

  if (decision === 'REFUND_SHIPPER') {
    await db.prepare(`UPDATE payouts SET status='CANCELLED' WHERE job_id=?`).run(job.id);
    // TODO-3: give the money back via the processor when it was taken.
    // No-op in internal mode / when the charge never went through.
    refundJobAsync(job);
  } else {
    await db.prepare(`UPDATE payouts SET status='RELEASED', release_type='DISPUTE_RESOLUTION', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`).run(job.id);
    issueInvoice(db, job.id);
    // TODO-3: with a processor configured this moves the money; in
    // internal mode it is a no-op and the admin SLA flow applies.
    executePayoutAsync(job, await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
  }
  await db.prepare(`UPDATE jobs SET status='COMPLETED', escrow_status='RELEASED', processor_payment_status=CASE WHEN ?='REFUND_SHIPPER' THEN 'REFUNDED' ELSE processor_payment_status END, payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(dispute.decision || decision, job.id);
  await db.prepare(`UPDATE disputes SET status='RESOLVED', determination=?, decision=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`).run(
    determination || null,
    decision,
    req.user.id,
    dispute.id
  );
  await writeAudit(req, { userId: req.actorId, action: 'DISPUTE_RESOLVE', details: `${decision}: ${determination || ''}`, entityType: 'dispute', entityId: dispute.id, beforeState: 'OPEN', afterState: 'RESOLVED' });
  await notify(job.shipper_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
  await notify(job.carrier_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
  res.json({ ok: true });
});

async function buildEvidence(jobId) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return null;
  return {
    job,
    bids: await db.prepare('SELECT * FROM bids WHERE job_id=?').all(jobId),
    documents: await db.prepare('SELECT * FROM job_documents WHERE job_id=?').all(jobId),
    messages: await db.prepare('SELECT * FROM messages WHERE job_id=? ORDER BY created_at').all(jobId),
    ratings: await db.prepare('SELECT * FROM ratings WHERE job_id=?').all(jobId),
    auditTrail: await db.prepare('SELECT * FROM audit_log WHERE entity_type=\'job\' AND entity_id=? ORDER BY id').all(jobId),
  };
}

router.get('/api/admin/evidence/:jobId', auth(['ADMIN']), async (req, res) => {
  const evidence = await buildEvidence(req.params.jobId);
  if (!evidence) return sendError(res, 404, 'Job not found');
  res.json({ evidence });
});

router.get('/api/admin/revenue', auth(['ADMIN']), async (req, res) => {
  const gmvAED = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE agreed_price_aed IS NOT NULL`).get()).s;
  const platformFeesAED = (await db.prepare('SELECT COALESCE(SUM(platform_fee_aed),0) s FROM payouts').get()).s;
  const escrowHeldAED = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE escrow_status IN ('HELD','FUNDED')`).get()).s;
  const avgTakeRate = gmvAED > 0 ? `${((platformFeesAED / gmvAED) * 100).toFixed(1)}%` : '0.0%';
  res.json({ revenue: { gmvAED, platformFeesAED, escrowHeldAED, avgTakeRate } });
});

router.get('/api/admin/payouts-sla', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.id, p.job_id, j.job_code, p.carrier_id, p.net_aed, p.release_type, p.released_at,
              p.sla_deadline, p.transfer_executed_at, p.transfer_reference
       FROM payouts p JOIN jobs j ON j.id = p.job_id
       WHERE p.status = 'RELEASED' AND p.transfer_executed_at IS NULL
       ORDER BY p.sla_deadline ASC`
    )
    .all();
  const now = new Date();
  const pending = rows.map((r) => ({
    ...r,
    overdue: r.sla_deadline ? new Date(r.sla_deadline.replace(' ', 'T') + 'Z') < now : false,
  }));
  res.json({ pending, overdueCount: pending.filter((r) => r.overdue).length });
});

router.post('/api/admin/payouts/:id/mark-transferred', auth(['ADMIN']), async (req, res) => {
  const payout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(req.params.id);
  if (!payout) return sendError(res, 404, 'Payout not found');
  if (payout.status !== 'RELEASED') return sendError(res, 400, 'Payout is not in RELEASED state yet');
  if (payout.transfer_executed_at) return sendError(res, 409, 'Transfer already confirmed for this payout');
  const { reference } = req.body || {};
  await db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), transfer_reference=? WHERE id=?`).run(reference || null, payout.id);
  await writeAudit(req, {
    userId: req.actorId,
    action: 'PAYOUT_TRANSFER_CONFIRMED',
    details: `Payout #${payout.id} (AED ${payout.net_aed}) confirmed transferred${reference ? ` — ref ${reference}` : ''}`,
    entityType: 'payout',
    entityId: payout.id,
    beforeState: 'PENDING_TRANSFER',
    afterState: 'TRANSFERRED',
  });
  const updated = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  res.json({ payout: updated });
});

router.get('/api/admin/settings', auth(['ADMIN']), async (req, res) => {
  res.json({ settings: await getSettings() });
});

router.patch('/api/admin/settings', auth(['ADMIN']), async (req, res) => {
  const { commission_rate_bps, auto_release_hours } = req.body || {};
  if (commission_rate_bps !== undefined) {
    if (commission_rate_bps < 0 || commission_rate_bps > 10000) return sendError(res, 400, 'commission_rate_bps must be 0-10000');
    await db.prepare('UPDATE settings SET value=? WHERE key=\'commission_rate_bps\'').run(String(commission_rate_bps));
  }
  if (auto_release_hours !== undefined) {
    if (auto_release_hours < 1 || auto_release_hours > 168) return sendError(res, 400, 'auto_release_hours must be 1-168');
    await db.prepare('UPDATE settings SET value=? WHERE key=\'auto_release_hours\'').run(String(auto_release_hours));
  }
  await writeAudit(req, { userId: req.actorId, action: 'SETTINGS_UPDATE', details: JSON.stringify(req.body) });
  res.json({ settings: await getSettings() });
});

router.get('/api/admin/reconciliation', auth(['ADMIN']), async (req, res) => {
  const { runReconciliation } = require('../services/reconciliation.service');
  const result = await runReconciliation();
  await writeAudit(req, { userId: req.actorId, action: 'RECONCILIATION_RUN', details: result.summary, entityType: 'system', entityId: null });
  res.json(result);
});

module.exports = router;

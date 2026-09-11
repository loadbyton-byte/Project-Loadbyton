const db = require('../db');
const { unifiedLanes } = require('../lib/lanes');
const { issueInvoice } = require('../lib/invoice');
const { sendError } = require('../lib/http');
const apiResponse = require('../lib/apiResponse');
const { encryptField, decryptField } = require('../lib/crypto');
const { writeAudit, toPublicUser, getSettings, notify, notifyAdmins, parseDbDate, createSession } = require('../lib/helpers');
const { refundJobAsync, executePayoutAsync } = require('../services/payout.service');
const { DEFERRED_PAYMENT_TERMS } = require('../lib/constants');
// Every deferred-payment job (NET_24H/7/15/28), plus the legacy
// CONTRACT_CREDIT value a job posted before this migration might still
// carry — one shared IN-clause list for both credit-admin queries below.
const CREDIT_DRAW_TIERS = [...DEFERRED_PAYMENT_TERMS, 'CONTRACT_CREDIT'];
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
  // Demo/investor-showcase jobs excluded from every platform-wide counter
  // here, same as /api/admin/revenue below — otherwise a handful of demo
  // records visibly nudge these numbers against a small real base.
  const openJobs = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='OPEN' AND is_demo=0`).get()).c;
  const totalJobs = (await db.prepare('SELECT COUNT(*) c FROM jobs WHERE is_demo=0').get()).c;
  const totalBids = (await db.prepare(`SELECT COUNT(*) c FROM bids b JOIN jobs j ON j.id=b.job_id WHERE j.is_demo=0`).get()).c;
  const completedJobs = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='COMPLETED' AND is_demo=0`).get()).c;
  const escrowHeld = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE escrow_status IN ('HELD','FUNDED') AND is_demo=0`).get()).s;
  const disputesOpen = (await db.prepare(`SELECT COUNT(*) c FROM disputes d JOIN jobs j ON j.id=d.job_id WHERE d.status='OPEN' AND j.is_demo=0`).get()).c;
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
      `SELECT u.*, p.company_name, p.trn_number, p.trade_license_number, p.phone, p.fleet_size, p.owned_chassis, p.insurance_uploaded, p.coverage_zones,
              p.rta_permit_number, p.rta_permit_doc_storage_path, p.haulage_insurance_doc_storage_path, p.haulage_insurance_expiry
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
        rta_permit_number: r.rta_permit_number,
        rta_permit_uploaded: !!r.rta_permit_doc_storage_path,
        haulage_insurance_uploaded: !!r.haulage_insurance_doc_storage_path,
        haulage_insurance_expiry: r.haulage_insurance_expiry,
      },
    })),
  });
});

router.get('/api/admin/approvals', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.*, p.company_name, p.trn_number, p.trade_license_number, p.phone, p.fleet_size, p.owned_chassis, p.insurance_uploaded, p.coverage_zones
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role IN ('SHIPPER','CARRIER','FORWARDER','BROKER','OWNER_OPERATOR') AND u.account_approval_status='PENDING'
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
    if (e.status) return apiResponse.error(req, res, 'VALIDATION_FAILED', e.message, { status: e.status });
    throw e;
  }
});

router.post('/api/admin/verify/:id', auth(['ADMIN']), async (req, res) => {
  const { action, iban } = req.body || {};
  try {
    const user = await verifyCarrier(req, req.params.id, action, iban);
    res.json({ ok: true, user });
  } catch (e) {
    if (e.status) return apiResponse.error(req, res, 'VALIDATION_FAILED', e.message, { status: e.status });
    throw e;
  }
});

const ADMIN_VERIFY_BULK_MAX = 100;

router.post('/api/admin/verify-bulk', auth(['ADMIN']), async (req, res) => {
  const { ids, action } = req.body || {};
  // Migrated bulk-verify validation to new envelope
  if (!Array.isArray(ids) || ids.length === 0) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'ids must be a non-empty array');
  if (ids.length > ADMIN_VERIFY_BULK_MAX) return apiResponse.error(req, res, 'VALIDATION_FAILED', `Cannot bulk-verify more than ${ADMIN_VERIFY_BULK_MAX} at once`);
  if (!['approve', 'reject'].includes(action)) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'action must be approve or reject');

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

// --- CONTRACT_CREDIT administration ---------------------------------------
// A shipper self-selecting CONTRACT_CREDIT on the post-job form doesn't
// self-grant credit (see award.service.js's gate) — an admin has to
// actually extend it first. This lists every shipper with their current
// standing plus any outstanding (unsettled) credit jobs, and the two
// actions: approve/update a limit, and mark a job's draw settled.
router.get('/api/admin/credit', auth(['ADMIN']), async (req, res) => {
  const shippers = await db.prepare(
    `SELECT u.id, u.email, p.company_name, p.credit_limit_aed, p.credit_balance_aed, p.credit_terms_days, p.credit_approved_at
     FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.role IN ('SHIPPER','FORWARDER') AND (p.credit_approved_at IS NOT NULL OR p.credit_balance_aed > 0)
     ORDER BY p.credit_approved_at IS NULL, p.company_name`
  ).all();
  const outstandingJobs = await db.prepare(
    `SELECT id, job_code, shipper_id, agreed_price_aed, status, payment_tier, credit_due_at
     FROM jobs WHERE payment_tier IN (${CREDIT_DRAW_TIERS.map(() => '?').join(',')}) AND carrier_id IS NOT NULL AND credit_settled_at IS NULL
     ORDER BY credit_due_at ASC`
  ).all(...CREDIT_DRAW_TIERS);
  res.json({ shippers, outstandingJobs });
});

router.post('/api/admin/credit/:userId/approve', auth(['ADMIN']), async (req, res) => {
  const { limitAed, termsDays } = req.body || {};
  const limit = Number(limitAed);
  if (!Number.isFinite(limit) || limit < 0) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'limitAed must be a non-negative number');
  const terms = termsDays !== undefined ? Number(termsDays) : 30;
  if (!Number.isFinite(terms) || terms < 1) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'termsDays must be a positive number');
  const shipper = await db.prepare(`SELECT id FROM users WHERE id=? AND role IN ('SHIPPER','FORWARDER')`).get(req.params.userId);
  if (!shipper) return sendError(res, 404, 'Shipper not found');
  await db.prepare(`UPDATE profiles SET credit_limit_aed=?, credit_terms_days=?, credit_approved_at=datetime('now') WHERE user_id=?`).run(limit, terms, shipper.id);
  await writeAudit(req, { userId: req.actorId, action: 'CREDIT_APPROVED', details: `Approved AED ${limit} credit limit, net ${terms} days`, entityType: 'user', entityId: shipper.id });
  await notify(shipper.id, 'Credit terms approved', `You've been approved for AED ${limit} contract credit, net ${terms} days.`, null, 'system');
  const updated = await db.prepare('SELECT credit_limit_aed, credit_balance_aed, credit_terms_days, credit_approved_at FROM profiles WHERE user_id=?').get(shipper.id);
  res.json({ ok: true, credit: updated });
});

router.post('/api/admin/credit/jobs/:jobId/settle', auth(['ADMIN']), async (req, res) => {
  const job = await db.prepare(`SELECT * FROM jobs WHERE id=? AND payment_tier IN (${CREDIT_DRAW_TIERS.map(() => '?').join(',')})`).get(req.params.jobId, ...CREDIT_DRAW_TIERS);
  if (!job) return sendError(res, 404, 'Deferred-payment job not found');
  // job.service.js's cancellation-restore path also sets credit_settled_at
  // (not just credit_due_at=NULL) specifically so this check catches an
  // already-cancelled job too — without that, a cancel-then-settle
  // sequence would decrement the shipper's credit balance a second time
  // for a draw that was already restored.
  if (job.credit_settled_at) return sendError(res, 400, job.status === 'CANCELLED' ? 'This job was cancelled — its credit draw was already restored, not settled' : 'Already settled');
  if (!job.carrier_id || !job.agreed_price_aed) return sendError(res, 400, 'Job was never awarded — nothing was drawn against credit');
  // Row-locked + idempotency-guarded, same pattern as the cancellation
  // restoration in job.service.js — two concurrent settle requests for
  // the same job (an admin double-click) must not both decrement the
  // balance. The UPDATE's own WHERE repeats the credit_settled_at IS NULL
  // check the SELECT above already used, so a second attempt matches zero
  // rows and skips the balance write.
  const settled = await db.transaction(async (trx) => {
    const claim = await trx.query(`UPDATE jobs SET credit_settled_at=datetime('now') WHERE id=? AND credit_settled_at IS NULL`, [job.id]);
    if (!claim.rowCount) return false;
    await trx.query(`UPDATE profiles SET credit_balance_aed = MAX(0, credit_balance_aed - ?) WHERE user_id=?`, [job.agreed_price_aed, job.shipper_id]);
    return true;
  });
  if (!settled) return sendError(res, 400, 'Already settled');
  await writeAudit(req, { userId: req.actorId, action: 'CREDIT_SETTLED', details: `${job.job_code}: AED ${job.agreed_price_aed} settled`, entityType: 'job', entityId: job.id });
  res.json({ ok: true });
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

// Admin document visibility — browse any company's registration documents
// (trade licence/insurance, uploaded via server/routes/documents.routes.js)
// and any of its drivers' documents, plus which jobs have attachments.
// Read-only; the actual files are served by the existing owner/admin-gated
// endpoints (profile/documents/:docType/:userId, fleet/drivers/:id/documents/:docType,
// jobs/:id/documents/:docId/file) rather than a parallel file-serving path.
router.get('/api/admin/documents', auth(['ADMIN']), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.role, u.is_verified, p.company_name, p.trade_license_doc_storage_path, p.insurance_doc_storage_path
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role IN ('SHIPPER','CARRIER') ORDER BY p.company_name ASC`
    )
    .all();
  res.json({
    companies: rows.map((r) => ({
      id: r.id,
      role: r.role,
      companyName: r.company_name,
      verified: !!r.is_verified,
      tradeLicenseDocPresent: !!r.trade_license_doc_storage_path,
      insuranceDocPresent: !!r.insurance_doc_storage_path,
    })),
  });
});

router.get('/api/admin/documents/:userId', auth(['ADMIN']), async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user || !['SHIPPER', 'CARRIER'].includes(user.role)) return sendError(res, 404, 'Company not found');
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);

  let drivers = [];
  if (user.role === 'CARRIER') {
    const driverRows = await db
      .prepare('SELECT id, name, phone, license_number, license_doc_storage_path, vehicle_doc_storage_path FROM drivers WHERE carrier_id=? AND is_active=1 ORDER BY name')
      .all(userId);
    drivers = driverRows.map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      licenseNumber: d.license_number,
      licenseDocPresent: !!d.license_doc_storage_path,
      vehicleDocPresent: !!d.vehicle_doc_storage_path,
    }));
  }

  const column = user.role === 'SHIPPER' ? 'shipper_id' : 'carrier_id';
  const jobRows = await db
    .prepare(
      `SELECT j.id, j.job_code, j.status, COUNT(jd.id) as doc_count
       FROM jobs j JOIN job_documents jd ON jd.job_id = j.id
       WHERE j.${column}=? GROUP BY j.id, j.job_code, j.status ORDER BY j.id DESC`
    )
    .all(userId);

  res.json({
    company: {
      id: user.id,
      role: user.role,
      companyName: profile ? profile.company_name : null,
      verified: !!user.is_verified,
      tradeLicenseDocPresent: !!(profile && profile.trade_license_doc_storage_path),
      insuranceDocPresent: !!(profile && profile.insurance_doc_storage_path),
    },
    drivers,
    jobs: jobRows.map((r) => ({ id: r.id, jobCode: r.job_code, status: r.status, docCount: Number(r.doc_count) })),
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
  // Security-audit finding: createSession only INSERTs the new (real
  // admin) session — it never touched the impersonation session it's
  // replacing. Without this, the impersonation token stayed valid server-
  // side (any client that had captured it, e.g. via a compromised
  // browser) for up to its own 30-minute max-age even after "ending"
  // impersonation in the UI.
  await db.prepare('DELETE FROM sessions WHERE session_token=?').run(req.session.session_token);
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
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.escrow_status === 'FUNDED') return apiResponse.error(req, res, 'ESCROW_ALREADY_FUNDED', 'Escrow already confirmed as received');
  if (job.escrow_status !== 'HELD') return apiResponse.error(req, res, 'ESCROW_NOT_HELD', 'Escrow must be HELD to confirm receipt');
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

  const result = await db.prepare('INSERT INTO disputes (job_id, opened_by, reason, status) VALUES (?,?,?,\'OPEN\') RETURNING id').run(job.id, req.user.id, reason);
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
  const { determination, decision, splitShipperPct, splitCarrierPct } = req.body || {};
  if (!['RELEASE_TO_CARRIER', 'REFUND_SHIPPER', 'SPLIT'].includes(decision)) return sendError(res, 400, 'Invalid decision');
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(dispute.job_id);

  // SPLIT was previously accepted as a valid decision but fell through to
  // the exact same full-release-to-carrier code path as
  // RELEASE_TO_CARRIER — an admin choosing "split the difference" got a
  // full release with zero indication anything different happened. This
  // computes and executes a real proportional split.
  let carrierPortionGross = null;
  let carrierPlatformFee = null;
  let carrierNetAed = null;
  let shipperRefundAed = null;
  if (decision === 'SPLIT') {
    const shipperPct = Number(splitShipperPct);
    const carrierPct = Number(splitCarrierPct);
    if (!Number.isFinite(shipperPct) || !Number.isFinite(carrierPct) || Math.abs(shipperPct + carrierPct - 100) > 0.01) {
      return sendError(res, 400, 'splitShipperPct and splitCarrierPct are required for a SPLIT decision and must sum to 100');
    }
    const { commission_rate_bps } = await getSettings();
    carrierPortionGross = Math.round((job.agreed_price_aed || 0) * carrierPct / 100 * 100) / 100;
    carrierPlatformFee = Math.round(carrierPortionGross * (commission_rate_bps / 10000));
    carrierNetAed = carrierPortionGross - carrierPlatformFee;
    shipperRefundAed = Math.round(((job.agreed_price_aed || 0) - carrierPortionGross) * 100) / 100;
  }

  // All three writes (payouts, jobs, disputes) happen atomically — a crash
  // between them used to leave the dispute row still OPEN despite the
  // payout already having been marked CANCELLED/RELEASED, so a retry could
  // re-pass the "already resolved" guard and fire a second real
  // refund/payout. The fire-and-forget processor calls run only after this
  // transaction has actually committed, so a crash before commit means
  // nothing was dispatched at all.
  await db.transaction(async (trx) => {
    if (decision === 'REFUND_SHIPPER') {
      await trx.query(`UPDATE payouts SET status='CANCELLED' WHERE job_id=?`, [job.id]);
    } else if (decision === 'SPLIT') {
      await trx.query(
        `UPDATE payouts SET gross_aed=?, platform_fee_aed=?, net_aed=?, status='RELEASED', release_type='DISPUTE_RESOLUTION', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`,
        [carrierPortionGross, carrierPlatformFee, carrierNetAed, job.id]
      );
    } else {
      await trx.query(`UPDATE payouts SET status='RELEASED', release_type='DISPUTE_RESOLUTION', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`, [job.id]);
    }
    await trx.query(
      `UPDATE jobs SET status='COMPLETED', escrow_status='RELEASED', processor_payment_status=CASE WHEN ?='REFUND_SHIPPER' THEN 'REFUNDED' ELSE processor_payment_status END, payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [dispute.decision || decision, job.id]
    );
    await trx.query(
      `UPDATE disputes SET status='RESOLVED', determination=?, decision=?, resolved_by=?, resolved_at=datetime('now'), split_shipper_pct=?, split_carrier_pct=? WHERE id=?`,
      [determination || null, decision, req.user.id, decision === 'SPLIT' ? Number(splitShipperPct) : null, decision === 'SPLIT' ? Number(splitCarrierPct) : null, dispute.id]
    );
  });

  if (decision === 'REFUND_SHIPPER') {
    // TODO-3: give the money back via the processor when it was taken.
    // No-op in internal mode / when the charge never went through.
    refundJobAsync(job);
  } else if (decision === 'SPLIT') {
    try { await issueInvoice(db, job.id); } catch (e) { console.error(`[invoice] issueInvoice failed for job ${job.id}:`, e); }
    if (shipperRefundAed > 0) refundJobAsync(job, shipperRefundAed);
    executePayoutAsync(job, await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
  } else {
    try { await issueInvoice(db, job.id); } catch (e) { console.error(`[invoice] issueInvoice failed for job ${job.id}:`, e); }
    // TODO-3: with a processor configured this moves the money; in
    // internal mode it is a no-op and the admin SLA flow applies.
    executePayoutAsync(job, await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
  }
  // Carrier reliability: a REFUND_SHIPPER (or the carrier's portion of a
  // SPLIT) resolution implies the carrier didn't deliver as promised.
  if ((decision === 'REFUND_SHIPPER' || decision === 'SPLIT') && job.carrier_id) {
    await db.prepare(`UPDATE profiles SET reliability_score = MAX(0, reliability_score - 1) WHERE user_id=?`).run(job.carrier_id);
  }
  await writeAudit(req, { userId: req.actorId, action: 'DISPUTE_RESOLVE', details: `${decision}: ${determination || ''}${decision === 'SPLIT' ? ` (${splitShipperPct}/${splitCarrierPct})` : ''}`, entityType: 'dispute', entityId: dispute.id, beforeState: 'OPEN', afterState: 'RESOLVED' });
  await notify(job.shipper_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
  await notify(job.carrier_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
  res.json({ ok: true });
});

// SLA breach check — flags any OPEN dispute past its 48h sla_deadline.
// Matches the pattern of the other /api/system/* internal-key-gated
// sweeps (server/routes/system.routes.js) — notify admins, never
// auto-resolve.
router.post('/api/system/dispute-sla-check', async (req, res) => {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_KEY) return sendError(res, 403, 'Invalid internal key');
  const overdue = await db.prepare(`SELECT d.*, j.job_code FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE d.status='OPEN' AND d.sla_deadline IS NOT NULL AND d.sla_deadline < datetime('now')`).all();
  for (const d of overdue) {
    await notifyAdmins('Dispute past its 48h SLA', `${d.job_code}: dispute #${d.id} (${d.dispute_type || 'untyped'}) is still open past its resolution deadline.`, d.job_id, 'dispute');
  }
  res.json({ ok: true, flagged: overdue.length });
});

// Fraud/identity disputes are admin-only review, not a standard resolution
// — re-surfaces the account's original onboarding documents side by side,
// plus a place to record that a police report was filed (Loadbyton isn't
// filing one on anyone's behalf, just recording the reference for the case
// file).
router.get('/api/admin/disputes/:id/evidence', auth(['ADMIN']), async (req, res) => {
  const dispute = await db.prepare('SELECT * FROM disputes WHERE id=?').get(req.params.id);
  if (!dispute) return sendError(res, 404, 'Dispute not found');
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(dispute.job_id);
  const bundle = { dispute, job };
  if (dispute.dispute_type === 'PRICE') {
    bundle.bid = await db.prepare('SELECT * FROM bids WHERE job_id=? AND status=\'AWARDED\'').get(job.id);
    bundle.ancillaryCharges = bundle.bid ? await db.prepare('SELECT * FROM bid_ancillary_charges WHERE bid_id=?').all(bundle.bid.id) : [];
    bundle.negotiation = bundle.bid ? await db.prepare('SELECT * FROM bid_negotiations WHERE bid_id=? ORDER BY created_at').all(bundle.bid.id) : [];
  } else if (dispute.dispute_type === 'DELAY_DEMURRAGE') {
    bundle.locationLogs = await db.prepare('SELECT * FROM location_logs WHERE job_id=? ORDER BY recorded_at').all(job.id);
    bundle.eToken = job.dp_world_e_token || null;
  } else if (dispute.dispute_type === 'DAMAGE_SHORTAGE') {
    bundle.eirDocuments = await db.prepare(`SELECT * FROM job_documents WHERE job_id=? AND doc_type='EIR' ORDER BY created_at`).all(job.id);
    bundle.podDocuments = await db.prepare(`SELECT * FROM job_documents WHERE job_id=? AND doc_type='POD' ORDER BY created_at`).all(job.id);
  } else if (dispute.dispute_type === 'MISSING_DOCS') {
    bundle.documents = await db.prepare('SELECT * FROM job_documents WHERE job_id=? ORDER BY created_at').all(job.id);
  } else if (dispute.dispute_type === 'NO_SHOW') {
    bundle.locationLogs = await db.prepare('SELECT * FROM location_logs WHERE job_id=? ORDER BY recorded_at').all(job.id);
  } else if (dispute.dispute_type === 'PAYMENT_VAT') {
    bundle.auditTrail = await db.prepare('SELECT * FROM audit_log WHERE entity_type=\'job\' AND entity_id=? ORDER BY id').all(job.id);
    bundle.invoice = await db.prepare('SELECT * FROM invoices WHERE job_id=?').get(job.id);
  } else if (dispute.dispute_type === 'FRAUD_IDENTITY') {
    const shipperProfile = await db.prepare('SELECT company_name, trn_number, trade_license_number, trade_license_doc_storage_path, insurance_doc_storage_path FROM profiles WHERE user_id=?').get(job.shipper_id);
    const carrierProfile = job.carrier_id ? await db.prepare('SELECT company_name, trn_number, trade_license_number, trade_license_doc_storage_path, insurance_doc_storage_path FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
    bundle.shipperProfile = shipperProfile;
    bundle.carrierProfile = carrierProfile;
  }
  res.json(bundle);
});

router.post('/api/admin/disputes/:id/police-report', auth(['ADMIN']), async (req, res) => {
  const dispute = await db.prepare('SELECT * FROM disputes WHERE id=?').get(req.params.id);
  if (!dispute) return sendError(res, 404, 'Dispute not found');
  const { reference } = req.body || {};
  if (!reference || !String(reference).trim()) return sendError(res, 400, 'reference is required');
  await db.prepare(`UPDATE disputes SET police_report_filed=1, police_report_reference=? WHERE id=?`).run(String(reference).trim(), dispute.id);
  await writeAudit(req, { userId: req.actorId, action: 'DISPUTE_POLICE_REPORT', details: `Dispute #${dispute.id}: police report ${reference}`, entityType: 'dispute', entityId: dispute.id });
  const updated = await db.prepare('SELECT * FROM disputes WHERE id=?').get(dispute.id);
  res.json({ dispute: updated });
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
  // Demo/investor-showcase transactions excluded so this dashboard always
  // reflects real GMV/fees/escrow only. See server/migrations/003_demo_data_flag.sql.
  const gmvAED = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE agreed_price_aed IS NOT NULL AND is_demo=0`).get()).s;
  const platformFeesAED = (await db.prepare(`SELECT COALESCE(SUM(p.platform_fee_aed),0) s FROM payouts p JOIN jobs j ON j.id=p.job_id WHERE j.is_demo=0`).get()).s;
  const escrowHeldAED = (await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE escrow_status IN ('HELD','FUNDED') AND is_demo=0`).get()).s;
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
  const pending = rows.map((r) => {
    const deadline = parseDbDate(r.sla_deadline);
    return { ...r, overdue: deadline ? deadline < now : false };
  });
  res.json({ pending, overdueCount: pending.filter((r) => r.overdue).length });
});

router.post('/api/admin/payouts/:id/mark-transferred', auth(['ADMIN']), async (req, res) => {
  const payout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(req.params.id);
  if (!payout) return apiResponse.error(req, res, 'BID_NOT_FOUND', 'Payout not found');
  if (payout.status !== 'RELEASED') return apiResponse.error(req, res, 'ESCROW_NOT_HELD', 'Payout is not in RELEASED state yet');
  if (payout.transfer_executed_at) return apiResponse.error(req, res, 'PAYOUT_DUPLICATE', 'Transfer already confirmed for this payout');
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
  const { commission_rate_bps, auto_release_hours, cancellation_fee_bps_after_award } = req.body || {};
  if (commission_rate_bps !== undefined) {
    // Number.isFinite (not just a bounds comparison) rejects non-numeric
    // input outright — "abc" < 0 and "abc" > 10000 are both false for a
    // NaN-coercible string, which used to let it silently through and
    // corrupt every payout computed off this setting afterward.
    if (!Number.isFinite(Number(commission_rate_bps)) || Number(commission_rate_bps) < 0 || Number(commission_rate_bps) > 10000) {
      return sendError(res, 400, 'commission_rate_bps must be a number between 0 and 10000');
    }
    await db.prepare('UPDATE settings SET value=? WHERE key=\'commission_rate_bps\'').run(String(Number(commission_rate_bps)));
  }
  if (auto_release_hours !== undefined) {
    if (!Number.isFinite(Number(auto_release_hours)) || Number(auto_release_hours) < 1 || Number(auto_release_hours) > 168) {
      return sendError(res, 400, 'auto_release_hours must be a number between 1 and 168');
    }
    await db.prepare('UPDATE settings SET value=? WHERE key=\'auto_release_hours\'').run(String(Number(auto_release_hours)));
  }
  if (cancellation_fee_bps_after_award !== undefined) {
    if (!Number.isFinite(Number(cancellation_fee_bps_after_award)) || Number(cancellation_fee_bps_after_award) < 0 || Number(cancellation_fee_bps_after_award) > 10000) {
      return sendError(res, 400, 'cancellation_fee_bps_after_award must be a number between 0 and 10000');
    }
    await db.prepare('UPDATE settings SET value=? WHERE key=\'cancellation_fee_bps_after_award\'').run(String(Number(cancellation_fee_bps_after_award)));
  }
  await writeAudit(req, { userId: req.actorId, action: 'SETTINGS_UPDATE', details: JSON.stringify(req.body) });
  res.json({ settings: await getSettings() });
});

router.get('/api/admin/reconciliation', auth(['ADMIN']), async (req, res) => {
  // Demonstrates new envelope on a safe endpoint (no existing test covers HTTP shape here)
  try {
    const { runReconciliation } = require('../services/reconciliation.service');
    const result = await runReconciliation();
    await writeAudit(req, { userId: req.actorId, action: 'RECONCILIATION_RUN', details: result.summary, entityType: 'system', entityId: null });
    // Use new envelope for success, but keep legacy top-level fields via spread so old clients still see `result` shape
    return apiResponse.success(req, res, result);
  } catch (e) {
    return apiResponse.error(req, res, 'INTERNAL', e.message || 'Reconciliation failed');
  }
});

module.exports = router;

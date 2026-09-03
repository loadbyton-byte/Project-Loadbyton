// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

/**
 * @param {Job} _job
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/** @type {any} */
const crypto = require('node:crypto');
/** @type {any} */
const db = require('../db');
/** @type {any} */
const payments = require('../lib/payments');
/** @type {any} */
const invoiceMod = require('../lib/invoice');
const issueInvoice = /** @type {any} */ (invoiceMod).issueInvoice;
/** @type {any} */
const whatsappMod = require('../lib/whatsapp');
const notifyDriverAsync = /** @type {any} */ (whatsappMod).notifyDriverAsync;
/** @type {any} */
const configMod = require('../lib/config');
const FRONTEND_URL = /** @type {any} */ (configMod).FRONTEND_URL;
/** @type {any} */
const httpMod = require('../lib/http');
const sendError = /** @type {any} */ (httpMod).sendError;
/** @type {any} */
const apiResponse = require('../lib/apiResponse');
/** @type {any} */
const constantsMod = require('../lib/constants');
const DOC_TYPES = /** @type {any} */ (constantsMod).DOC_TYPES;
const STATUS_ORDER = /** @type {any} */ (constantsMod).STATUS_ORDER;
const TRANSITIONS = /** @type {any} */ (constantsMod).TRANSITIONS;
const DISPUTABLE_STATUSES = /** @type {any} */ (constantsMod).DISPUTABLE_STATUSES;
/** @type {any} */
const helpersMod = require('../lib/helpers');
const saveUploadedFile = /** @type {any} */ (helpersMod).saveUploadedFile;
const normalizeUaeMobile = /** @type {any} */ (helpersMod).normalizeUaeMobile;
const getSettings = /** @type {any} */ (helpersMod).getSettings;
const writeAudit = /** @type {any} */ (helpersMod).writeAudit;
const notify = /** @type {any} */ (helpersMod).notify;
const notifyAdmins = /** @type {any} */ (helpersMod).notifyAdmins;
const isPartyOnJob = /** @type {any} */ (helpersMod).isPartyOnJob;
const isParticipantOrBidder = /** @type {any} */ (helpersMod).isParticipantOrBidder;
const canViewJob = /** @type {any} */ (helpersMod).canViewJob;
/** @type {any} */
const authMod = require('../middleware/auth');
const auth = /** @type {any} */ (authMod).auth;
const requireSeatRole = /** @type {any} */ (authMod).requireSeatRole;
const writeLimiter = /** @type {any} */ (authMod).writeLimiter;
/** @type {any} */
const rateLimitMod = require('../lib/rateLimit');
const rateLimiter = /** @type {any} */ (rateLimitMod).rateLimiter;
// @ts-ignore
const bidLimiter = rateLimiter({ windowMs: 60*1000, max: 10, keyFn: (/** @type {any} */ req) => `bid:${req.user.id}`, message: 'Too many bids. Max 10 per minute.' });
/** @type {any} */
const payoutMod = require('../services/payout.service');
const markJobPaymentFailed = /** @type {any} */ (payoutMod).markJobPaymentFailed;
const executePayoutAsync = /** @type {any} */ (payoutMod).executePayoutAsync;
const refundJobAsync = /** @type {any} */ (payoutMod).refundJobAsync;
/** @type {any} */
const idempotencyMod = require('../lib/idempotency');
const idempotency = /** @type {any} */ (idempotencyMod).idempotency;
/** @type {any} */
const jobController = require('../controllers/job.controller');

// @ts-ignore
const router = require('express').Router();

router.post('/api/jobs/:id/bids', auth(['CARRIER']), writeLimiter, bidLimiter, requireSeatRole(['OPS']), idempotency, async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.status !== 'OPEN') return sendError(res, 403, 'Job is not open for bidding.');
  if (!req.user.profile || !req.user.profile.rating_avg || !(/** @type {any} */ (await db.prepare('SELECT is_verified FROM users WHERE id=?').get(req.user.id))).is_verified) {
    return sendError(res, 403, 'Carrier verification required to bid.');
  }
  const b = /** @type {any} */ (req.body) || {};
  const amount = Number(b.amountAed);
  if (!amount || amount <= 0) return sendError(res, 400, 'amountAed must be a positive number');
  const etaAt = b.etaAt ? new Date(b.etaAt) : null;
  // @ts-ignore
  if (!etaAt || isNaN(etaAt.getTime())) return sendError(res, 400, 'etaAt must be a valid date/time (ISO or datetime-local)');
  const etaMs = /** @type {any} */ (etaAt).getTime() - Date.now();
  if (etaMs < -3600000) return sendError(res, 400, 'etaAt cannot be more than an hour in the past');
  if (etaMs > 90 * 86400000) return sendError(res, 400, 'etaAt cannot be more than 90 days out');
  const legacyEtaMinutes = Math.max(0, Math.round(etaMs / 60000));

  const alreadyBidding = /** @type {any} */ (await db.prepare(`SELECT 1 FROM bids WHERE job_id=? AND carrier_id=? AND status='PENDING'`).get(job.id, req.user.id));
  if (alreadyBidding) return sendError(res, 409, 'You already have a pending bid on this job — withdraw it before placing another.');

  let result;
  try {
    result = /** @type {any} */ (await db
      .prepare('INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, eta_at, truck_type, notes) VALUES (?,?,?,?,?,?,?) RETURNING id')
      .run(job.id, req.user.id, amount, legacyEtaMinutes, /** @type {any} */ (etaAt).toISOString(), b.truckType || null, b.notes || null));
  } catch (/** @type {any} */ e) {
    // 23505 is Postgres's unique_violation code; ERR_SQLITE_ERROR + message
    // sniff is node:sqlite's. Only the SQLite check existed before, so this
    // friendly-error path was silently dead on Postgres — any real-world
    // race (double-click, retry) would throw a raw 500 instead.
    const isUniqueViolation = /** @type {any} */ (e).code === '23505' ||
      (/** @type {any} */ (e).code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(/** @type {any} */ (e).message));
    if (isUniqueViolation) {
      return sendError(res, 409, 'You already have a pending bid on this job — withdraw it before placing another.');
    }
    throw e;
  }
  const bidId = Number(/** @type {any} */ (result).lastInsertRowid);
  await writeAudit(req, { userId: req.actorId, action: 'BID_CREATE', details: `Bid AED ${amount} on ${job.job_code}`, entityType: 'bid', entityId: bidId });
  await notify(job.shipper_id, 'New bid received', `${req.user.profile.company_name} bid AED ${amount} on ${job.job_code}.`, job.id, 'bid');
  const bid = /** @type {any} */ (await db.prepare('SELECT * FROM bids WHERE id=?').get(bidId));
  res.status(201).json({ bid });
});

router.post('/api/jobs/:id/payment-checkout', auth(['SHIPPER']), requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  // Migrated to new envelope: payment-checkout errors use apiResponse.error (adds success:false + _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.shipper_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  if (job.status !== 'AWARDED') return apiResponse.error(req, res, 'JOB_NOT_OPEN', 'Only AWARDED jobs can be paid');
  if (job.escrow_status !== 'HELD') return apiResponse.error(req, res, 'ESCROW_NOT_HELD', 'Escrow is not in HELD state');
  if (job.processor_payment_status === 'PAID') return apiResponse.error(req, res, 'JOB_ALREADY_AWARDED', 'This job is already paid');
  if (!payments.isConfigured()) return apiResponse.error(req, res, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured — escrow is internal bookkeeping (see docs/PAYMENTS.md)');

  const payRef = /** @type {any} */ (job.processor_payment_ref) || `lb_${String(job.job_code).toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  const returnBase = `${FRONTEND_URL}/jobs/${job.id}`;
  try {
    const r = /** @type {any} */ (await payments.createCheckoutOrder({
      jobCode: job.job_code,
      amountAed: job.agreed_price_aed,
      description: `Loadbyton escrow for ${job.job_code}`,
      returnUrls: { auth: `${returnBase}?pay=ok`, cancel: `${returnBase}?pay=cancel`, decline: `${returnBase}?pay=declined` },
      paymentRef: payRef,
    }));
    if (!r.ok) {
      markJobPaymentFailed(job.id, `${r.error}${r.detail ? `: ${r.detail}` : ''}`);
      return apiResponse.error(req, res, 'INTERNAL', 'Payment provider unavailable — please try again', { status: 502 });
    }
    await db.prepare(
      `UPDATE jobs SET processor_payment_ref=?, processor_payment_status='REQUIRES_PAYMENT', processor_amount_aed=?, processor_last_error=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(payRef, job.agreed_price_aed, job.id);
    await writeAudit(req, {
      userId: req.actorId,
      action: 'PAYMENT_CHECKOUT',
      details: `${job.job_code}: checkout created (${payments.provider()}, ref ${payRef})`,
      entityType: 'job',
      entityId: job.id,
      beforeState: 'HELD',
      afterState: 'REQUIRES_PAYMENT',
    });
    res.json({ ok: true, paymentUrl: r.url, ref: payRef, provider: payments.provider(), testMode: payments.providerInfo().testMode });
  } catch (/** @type {any} */ e) {
    markJobPaymentFailed(job.id, /** @type {any} */ (e).message);
    return apiResponse.error(req, res, 'INTERNAL', 'Payment provider unavailable — please try again', { status: 502 });
  }
});

// Delegated to controller/service — preserves HTTP shape, business logic lives in job.service
router.patch('/api/jobs/:id/status', auth(), requireSeatRole(['OPS']), jobController.updateJobStatus);

router.patch('/api/jobs/:id/driver', auth(['CARRIER']), requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.carrier_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (!['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status)) {
    return sendError(res, 403, 'Driver can only be reassigned before delivery');
  }
  const { driverId, driverName: rawDriverName, driverPhone: rawDriverPhone } = /** @type {any} */ (req.body) || {};
  let driverName = rawDriverName;
  let normalizedPhone = /** @type {any} */ (normalizeUaeMobile(rawDriverPhone));

  // Preferred path: pick from the carrier's saved roster (server/routes/fleet.routes.js)
  // — name/phone still get written to jobs.assigned_driver_name/_phone too
  // (existing readers of those columns, e.g. WonJobs/OpenLoads cards, keep
  // working unchanged) alongside the new assigned_driver_id link that lets
  // the shipper see the driver's license/vehicle docs.
  let resolvedDriverId = null;
  if (driverId) {
    const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=? AND is_active=1').get(driverId, req.user.id);
    if (!driver) return sendError(res, 404, 'Driver not found in your roster');
    resolvedDriverId = driver.id;
    driverName = driver.name;
    normalizedPhone = driver.phone;
  } else {
    if (!driverName) return sendError(res, 400, 'driverId or driverName is required');
    if (!normalizedPhone) return sendError(res, 400, 'driverPhone is required and must be a valid UAE mobile number');
  }

  await db.prepare(`UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone=?, assigned_driver_id=?, updated_at=datetime('now') WHERE id=?`).run(
    driverName,
    normalizedPhone,
    resolvedDriverId,
    job.id
  );
  await writeAudit(req, {
    userId: req.actorId,
    action: 'DRIVER_REASSIGN',
    details: `${job.job_code}: driver changed from ${job.assigned_driver_name || 'unset'} (${job.assigned_driver_phone || 'unset'}) to ${driverName} (${normalizedPhone})`,
    entityType: 'job',
    entityId: job.id,
    beforeState: job.assigned_driver_phone || 'unset',
    afterState: normalizedPhone,
  });
  await notify(job.shipper_id, 'Driver reassigned', `${job.job_code}: the assigned driver was changed to ${driverName}.`, job.id, 'status');
  // @ts-ignore
  notifyDriverAsync({
    to: normalizedPhone,
    template: 'job_awarded_pickup_details',
    params: [driverName, job.job_code, job.pickup_terminal],
  });
  const updated = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id));
  res.json({ job: updated });
});

router.post('/api/jobs/:id/pod', auth(['CARRIER']), requireSeatRole(['OPS']), idempotency, async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  // Migrated POD errors to new envelope (apiResponse.error preserves _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  if (job.status !== 'IN_TRANSIT') return apiResponse.error(req, res, 'FORBIDDEN', 'Job must be IN_TRANSIT to submit proof of delivery');

  const doc = /** @type {any} */ ((/** @type {any} */ (req.body) || {}).document);
  let storagePath = null;
  let mimeType = null;
  if (doc && doc.fileBase64) {
    try {
      // @ts-ignore
      ({ storagePath, mimeType } = await saveUploadedFile(job.id, doc.mimeType, doc.fileBase64));
    } catch (/** @type {any} */ e) {
      return apiResponse.error(req, res, 'VALIDATION_FAILED', e.message || 'Upload failed', { status: e.status || 400 });
    }
  }
  await db.prepare(`UPDATE jobs SET status='DELIVERED', delivered_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(job.id);
  if (doc && (doc.fileUrl || storagePath)) {
    await db.prepare('INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,?,?,?,?,?)').run(
      job.id,
      req.actorId,
      DOC_TYPES.includes(doc.docType) ? doc.docType : 'POD',
      doc.title || 'Proof of Delivery',
      doc.fileUrl || storagePath || '',
      storagePath,
      mimeType
    );
  }
  await writeAudit(req, {
    userId: req.actorId,
    action: 'STATUS',
    details: `${job.job_code}: POD submitted`,
    entityType: 'job',
    entityId: job.id,
    beforeState: 'IN_TRANSIT',
    afterState: 'DELIVERED',
  });
  const { auto_release_hours } = /** @type {any} */ (await getSettings());
  await notify(job.shipper_id, 'Proof of delivery submitted', `Confirm delivery on ${job.job_code}, or it auto-releases in ${auto_release_hours}h.`, job.id, 'status');
  const updated = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id));
  res.json({ job: updated });
});

router.post('/api/jobs/:id/dispute', auth(['SHIPPER', 'CARRIER']), requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  const isShipperOwner = req.user.role === 'SHIPPER' && job.shipper_id === req.user.id;
  const isCarrierOwner = req.user.role === 'CARRIER' && job.carrier_id === req.user.id;
  if (!isShipperOwner && !isCarrierOwner) return sendError(res, 403, 'Not a participant on this job');
  if (!DISPUTABLE_STATUSES.includes(job.status)) return sendError(res, 403, `Cannot dispute a job in ${job.status} status`);
  const { reason } = /** @type {any} */ (req.body) || {};
  if (!reason || !String(reason).trim()) return sendError(res, 400, 'reason is required');

  const result = /** @type {any} */ (await db.prepare('INSERT INTO disputes (job_id, opened_by, reason, status) VALUES (?,?,?,\'OPEN\') RETURNING id').run(job.id, req.user.id, String(reason).trim()));
  await db.prepare(`UPDATE jobs SET status='DISPUTED', escrow_status='DISPUTED', updated_at=datetime('now') WHERE id=?`).run(job.id);
  await writeAudit(req, {
    userId: req.actorId,
    action: 'DISPUTE_OPEN',
    details: String(reason).trim(),
    entityType: 'job',
    entityId: job.id,
    beforeState: job.status,
    afterState: 'DISPUTED',
  });
  const other = req.user.id === job.shipper_id ? job.carrier_id : job.shipper_id;
  await notify(other, 'Dispute opened', `${job.job_code}: a dispute was opened by the counterparty. Escrow is frozen pending admin review.`, job.id, 'dispute');
  await notifyAdmins('New dispute filed', `${job.job_code}: filed by ${req.actorLabel}. Escrow frozen, awaiting review.`, job.id);
  const dispute = /** @type {any} */ (await db.prepare('SELECT * FROM disputes WHERE id=?').get(Number(result.lastInsertRowid)));
  res.status(201).json({ dispute });
});

router.get('/api/jobs/:id/dispute', auth(), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  const isParty = req.user.id === job.shipper_id || req.user.id === job.carrier_id;
  if (!isParty && req.user.role !== 'ADMIN') return sendError(res, 403, 'Not permitted');

  const dispute = /** @type {any} */ (await db.prepare('SELECT * FROM disputes WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(job.id));
  if (!dispute) return sendError(res, 404, 'No dispute on this job');

  res.json({
    dispute,
    job: { id: job.id, job_code: job.job_code, status: job.status, escrow_status: job.escrow_status },
  });
});

router.get('/api/jobs/:id/track', auth(), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  if (!(await canViewJob(job, req.user))) return sendError(res, 403, 'Not permitted');

  const shipper = /** @type {any} */ (await db.prepare('SELECT company_name FROM profiles WHERE user_id=?').get(job.shipper_id));
  const carrier = job.carrier_id ? /** @type {any} */ (await db.prepare('SELECT company_name FROM profiles WHERE user_id=?').get(job.carrier_id)) : null;
  const { auto_release_hours } = /** @type {any} */ (await getSettings());

  const statusIndex = STATUS_ORDER.indexOf(job.status);
  const canProgress = req.user.role === 'CARRIER' && req.user.id === job.carrier_id && ['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status);

  let hoursSinceDelivered = null;
  let autoReleaseAt = null;
  if (job.delivered_at) {
    const deliveredMs = new Date(String(job.delivered_at).replace(' ', 'T') + 'Z').getTime();
    hoursSinceDelivered = Math.max(0, (Date.now() - deliveredMs) / 3600000);
    autoReleaseAt = new Date(deliveredMs + auto_release_hours * 3600000).toISOString();
  }

  res.json({
    job,
    shipperName: shipper ? shipper.company_name : null,
    carrierName: carrier ? carrier.company_name : null,
    statusIndex,
    canProgress,
    hoursSinceDelivered,
    autoReleaseAt,
    geofence: {
      pickup: job.pickup_terminal,
      delivery: job.delivery_area,
      atPickup: ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(job.status),
      atDelivery: ['DELIVERED', 'COMPLETED'].includes(job.status),
    },
  });
});

module.exports = router;

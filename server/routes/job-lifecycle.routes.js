const crypto = require('node:crypto');
const db = require('../db');
const payments = require('../lib/payments');
const { issueInvoice } = require('../lib/invoice');
const { notifyDriverAsync } = require('../lib/whatsapp');
const { FRONTEND_URL } = require('../lib/config');
const { sendError } = require('../lib/http');
const apiResponse = require('../lib/apiResponse');
const { DOC_TYPES, STATUS_ORDER, TRANSITIONS, DISPUTABLE_STATUSES } = require('../lib/constants');
const { saveUploadedFile, normalizeUaeMobile, getSettings, writeAudit, notify, notifyAdmins, isPartyOnJob, isParticipantOrBidder, canViewJob } = require('../lib/helpers');
const { auth, requireSeatRole, writeLimiter } = require('../middleware/auth');
const { rateLimiter } = require('../lib/rateLimit');
const bidLimiter = rateLimiter({ windowMs: 60*1000, max: 10, keyFn: (req) => `bid:${req.user.id}`, message: 'Too many bids. Max 10 per minute.' });
const { markJobPaymentFailed, executePayoutAsync, refundJobAsync } = require('../services/payout.service');
const { idempotency } = require('../lib/idempotency');
const jobController = require('../controllers/job.controller');

const router = require('express').Router();

router.post('/api/jobs/:id/bids', auth(['CARRIER']), writeLimiter, bidLimiter, requireSeatRole(['OPS']), idempotency, async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.status !== 'OPEN') return sendError(res, 403, 'Job is not open for bidding.');
  if (!req.user.profile || !req.user.profile.rating_avg || !(await db.prepare('SELECT is_verified FROM users WHERE id=?').get(req.user.id)).is_verified) {
    return sendError(res, 403, 'Carrier verification required to bid.');
  }
  const b = req.body || {};
  const amount = Number(b.amountAed);
  if (!amount || amount <= 0) return sendError(res, 400, 'amountAed must be a positive number');
  const etaAt = b.etaAt ? new Date(b.etaAt) : null;
  if (!etaAt || isNaN(etaAt.getTime())) return sendError(res, 400, 'etaAt must be a valid date/time (ISO or datetime-local)');
  const etaMs = etaAt.getTime() - Date.now();
  if (etaMs < -3600000) return sendError(res, 400, 'etaAt cannot be more than an hour in the past');
  if (etaMs > 90 * 86400000) return sendError(res, 400, 'etaAt cannot be more than 90 days out');
  const legacyEtaMinutes = Math.max(0, Math.round(etaMs / 60000));

  const alreadyBidding = await db.prepare(`SELECT 1 FROM bids WHERE job_id=? AND carrier_id=? AND status='PENDING'`).get(job.id, req.user.id);
  if (alreadyBidding) return sendError(res, 409, 'You already have a pending bid on this job — withdraw it before placing another.');

  let result;
  try {
    result = await db
      .prepare('INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, eta_at, truck_type, notes) VALUES (?,?,?,?,?,?,?)')
      .run(job.id, req.user.id, amount, legacyEtaMinutes, etaAt.toISOString(), b.truckType || null, b.notes || null);
  } catch (e) {
    if (e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(e.message)) {
      return sendError(res, 409, 'You already have a pending bid on this job — withdraw it before placing another.');
    }
    throw e;
  }
  const bidId = Number(result.lastInsertRowid);
  await writeAudit(req, { userId: req.actorId, action: 'BID_CREATE', details: `Bid AED ${amount} on ${job.job_code}`, entityType: 'bid', entityId: bidId });
  await notify(job.shipper_id, 'New bid received', `${req.user.profile.company_name} bid AED ${amount} on ${job.job_code}.`, job.id, 'bid');
  const bid = await db.prepare('SELECT * FROM bids WHERE id=?').get(bidId);
  res.status(201).json({ bid });
});

router.post('/api/jobs/:id/payment-checkout', auth(['SHIPPER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  // Migrated to new envelope: payment-checkout errors use apiResponse.error (adds success:false + _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.shipper_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  if (job.status !== 'AWARDED') return apiResponse.error(req, res, 'JOB_NOT_OPEN', 'Only AWARDED jobs can be paid');
  if (job.escrow_status !== 'HELD') return apiResponse.error(req, res, 'ESCROW_NOT_HELD', 'Escrow is not in HELD state');
  if (job.processor_payment_status === 'PAID') return apiResponse.error(req, res, 'JOB_ALREADY_AWARDED', 'This job is already paid');
  if (!payments.isConfigured()) return apiResponse.error(req, res, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured — escrow is internal bookkeeping (see docs/PAYMENTS.md)');

  const payRef = job.processor_payment_ref || `lb_${job.job_code.toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  const returnBase = `${FRONTEND_URL}/jobs/${job.id}`;
  try {
    const r = await payments.createCheckoutOrder({
      jobCode: job.job_code,
      amountAed: job.agreed_price_aed,
      description: `Loadbyton escrow for ${job.job_code}`,
      returnUrls: { auth: `${returnBase}?pay=ok`, cancel: `${returnBase}?pay=cancel`, decline: `${returnBase}?pay=declined` },
      paymentRef: payRef,
    });
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
  } catch (e) {
    markJobPaymentFailed(job.id, e.message);
    return apiResponse.error(req, res, 'INTERNAL', 'Payment provider unavailable — please try again', { status: 502 });
  }
});

// Delegated to controller/service — preserves HTTP shape, business logic lives in job.service
router.patch('/api/jobs/:id/status', auth(), requireSeatRole(['OPS']), jobController.updateJobStatus);

router.patch('/api/jobs/:id/driver', auth(['CARRIER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.carrier_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (!['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status)) {
    return sendError(res, 403, 'Driver can only be reassigned before delivery');
  }
  const { driverName, driverPhone } = req.body || {};
  if (!driverName) return sendError(res, 400, 'driverName is required');
  const normalizedPhone = normalizeUaeMobile(driverPhone);
  if (!normalizedPhone) return sendError(res, 400, 'driverPhone is required and must be a valid UAE mobile number');

  await db.prepare(`UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone=?, updated_at=datetime('now') WHERE id=?`).run(
    driverName,
    normalizedPhone,
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
  notifyDriverAsync({
    to: normalizedPhone,
    template: 'job_awarded_pickup_details',
    params: [driverName, job.job_code, job.pickup_terminal],
  });
  const updated = await db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
  res.json({ job: updated });
});

router.post('/api/jobs/:id/pod', auth(['CARRIER']), requireSeatRole(['OPS']), idempotency, async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  // Migrated POD errors to new envelope (apiResponse.error preserves _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  if (job.status !== 'IN_TRANSIT') return apiResponse.error(req, res, 'FORBIDDEN', 'Job must be IN_TRANSIT to submit proof of delivery');

  const doc = (req.body || {}).document;
  let storagePath = null;
  let mimeType = null;
  if (doc && doc.fileBase64) {
    try {
      ({ storagePath, mimeType } = await saveUploadedFile(job.id, doc.mimeType, doc.fileBase64));
    } catch (e) {
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
  const { auto_release_hours } = await getSettings();
  await notify(job.shipper_id, 'Proof of delivery submitted', `Confirm delivery on ${job.job_code}, or it auto-releases in ${auto_release_hours}h.`, job.id, 'status');
  const updated = await db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
  res.json({ job: updated });
});

router.post('/api/jobs/:id/dispute', auth(['SHIPPER', 'CARRIER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  const isShipperOwner = req.user.role === 'SHIPPER' && job.shipper_id === req.user.id;
  const isCarrierOwner = req.user.role === 'CARRIER' && job.carrier_id === req.user.id;
  if (!isShipperOwner && !isCarrierOwner) return sendError(res, 403, 'Not a participant on this job');
  if (!DISPUTABLE_STATUSES.includes(job.status)) return sendError(res, 403, `Cannot dispute a job in ${job.status} status`);
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return sendError(res, 400, 'reason is required');

  const result = await db.prepare('INSERT INTO disputes (job_id, opened_by, reason, status) VALUES (?,?,?,\'OPEN\')').run(job.id, req.user.id, reason.trim());
  await db.prepare(`UPDATE jobs SET status='DISPUTED', escrow_status='DISPUTED', updated_at=datetime('now') WHERE id=?`).run(job.id);
  await writeAudit(req, {
    userId: req.actorId,
    action: 'DISPUTE_OPEN',
    details: reason.trim(),
    entityType: 'job',
    entityId: job.id,
    beforeState: job.status,
    afterState: 'DISPUTED',
  });
  const other = req.user.id === job.shipper_id ? job.carrier_id : job.shipper_id;
  await notify(other, 'Dispute opened', `${job.job_code}: a dispute was opened by the counterparty. Escrow is frozen pending admin review.`, job.id, 'dispute');
  await notifyAdmins('New dispute filed', `${job.job_code}: filed by ${req.actorLabel}. Escrow frozen, awaiting review.`, job.id);
  const dispute = await db.prepare('SELECT * FROM disputes WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ dispute });
});

router.get('/api/jobs/:id/dispute', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  const isParty = req.user.id === job.shipper_id || req.user.id === job.carrier_id;
  if (!isParty && req.user.role !== 'ADMIN') return sendError(res, 403, 'Not permitted');

  const dispute = await db.prepare('SELECT * FROM disputes WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(job.id);
  if (!dispute) return sendError(res, 404, 'No dispute on this job');

  res.json({
    dispute,
    job: { id: job.id, job_code: job.job_code, status: job.status, escrow_status: job.escrow_status },
  });
});

router.get('/api/jobs/:id/track', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (!(await canViewJob(job, req.user))) return sendError(res, 403, 'Not permitted');

  const shipper = await db.prepare('SELECT company_name FROM profiles WHERE user_id=?').get(job.shipper_id);
  const carrier = job.carrier_id ? await db.prepare('SELECT company_name FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
  const { auto_release_hours } = await getSettings();

  const statusIndex = STATUS_ORDER.indexOf(job.status);
  const canProgress = req.user.role === 'CARRIER' && req.user.id === job.carrier_id && ['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status);

  let hoursSinceDelivered = null;
  let autoReleaseAt = null;
  if (job.delivered_at) {
    const deliveredMs = new Date(job.delivered_at.replace(' ', 'T') + 'Z').getTime();
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

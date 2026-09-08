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
const deliveryService = require('../services/delivery.service');
/** @type {any} */
const { bindDriverToJob } = require('../services/driver-assignment.service');
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
const STATUS_ORDER = /** @type {any} */ (constantsMod).STATUS_ORDER;
const TRANSITIONS = /** @type {any} */ (constantsMod).TRANSITIONS;
const DISPUTABLE_STATUSES = /** @type {any} */ (constantsMod).DISPUTABLE_STATUSES;
const ANCILLARY_CHARGE_TYPES = /** @type {any} */ (constantsMod).ANCILLARY_CHARGE_TYPES;
/** @type {any} */
const helpersMod = require('../lib/helpers');
const normalizeUaeMobile = /** @type {any} */ (helpersMod).normalizeUaeMobile;
const getSettings = /** @type {any} */ (helpersMod).getSettings;
const writeAudit = /** @type {any} */ (helpersMod).writeAudit;
const notify = /** @type {any} */ (helpersMod).notify;
const notifyAdmins = /** @type {any} */ (helpersMod).notifyAdmins;
const isPartyOnJob = /** @type {any} */ (helpersMod).isPartyOnJob;
const isParticipantOrBidder = /** @type {any} */ (helpersMod).isParticipantOrBidder;
const canViewJob = /** @type {any} */ (helpersMod).canViewJob;
const parseDbDate = /** @type {any} */ (helpersMod).parseDbDate;
/** @type {any} */
const authMod = require('../middleware/auth');
const auth = /** @type {any} */ (authMod).auth;
const requireSeatRole = /** @type {any} */ (authMod).requireSeatRole;
const requireApproved = /** @type {any} */ (authMod).requireApproved;
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

router.post('/api/jobs/:id/bids', auth(['CARRIER']), writeLimiter, bidLimiter, requireApproved(), requireSeatRole(['OPS']), idempotency, async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  // BROKER passes the CARRIER guard via roleSatisfies (they also post jobs),
  // but brokers must win work only through direct-assign (disclosed spread,
  // roster, one-hop rule) — never by bidding against real carriers with no
  // fleet behind the bid, and never self-dealing on their own postings.
  if (req.user.role === 'BROKER') return sendError(res, 403, 'Broker accounts cannot bid — assign work via direct-assign instead.');
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

  // Anticipated ancillary charges (Salik, e-token, demurrage, inspection
  // waiting) declared up front, as part of the bid itself, not discovered
  // only after the shipper picks a bid to negotiate with. Proposed by the
  // carrier at bid time -> agreed_by_carrier is already true; the shipper
  // reviews and agrees (or proposes their own) during the pre-award
  // discussion (POST /api/bids/:id/ancillary-charges/:chargeId/agree).
  const bidCharges = Array.isArray(b.ancillaryCharges) ? b.ancillaryCharges : [];
  for (const c of bidCharges) {
    if (!c || !ANCILLARY_CHARGE_TYPES.includes(c.chargeType)) continue;
    const chargeAmount = Number(c.amountAed);
    if (!chargeAmount || chargeAmount <= 0) continue;
    await db.prepare(
      `INSERT INTO bid_ancillary_charges (bid_id, charge_type, amount_aed, notes, proposed_by, agreed_by_shipper, agreed_by_carrier)
       VALUES (?,?,?,?,?,0,1)`
    ).run(bidId, c.chargeType, chargeAmount, c.notes || null, req.actorId);
  }

  await writeAudit(req, { userId: req.actorId, action: 'BID_CREATE', details: `Bid AED ${amount} on ${job.job_code}${bidCharges.length ? ` (+${bidCharges.length} ancillary charge(s))` : ''}`, entityType: 'bid', entityId: bidId });
  await notify(job.shipper_id, 'New bid received', `${req.user.profile.company_name} bid AED ${amount} on ${job.job_code}.`, job.id, 'bid');
  const bid = /** @type {any} */ (await db.prepare('SELECT * FROM bids WHERE id=?').get(bidId));
  // Warn, don't block — a shipper may still want to see/consider this bid,
  // but must be told the carrier has declared zero (or negative) available
  // capacity right now.
  const carrierProfile = await db.prepare('SELECT available_units FROM profiles WHERE user_id=?').get(req.user.id);
  const lowCapacityWarning = carrierProfile && carrierProfile.available_units <= 0;
  res.status(201).json({ bid, warning: lowCapacityWarning });
});

router.post('/api/jobs/:id/payment-checkout', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  // Migrated to new envelope: payment-checkout errors use apiResponse.error (adds success:false + _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.shipper_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  // PAY_ON_DELIVERY jobs reach escrow_status='HELD' at the DELIVERED
  // transition instead of at AWARDED (see the /pod handler above) — this
  // endpoint stays reachable for them at that later status too, since
  // that's the whole point of the tier. Every other tier keeps today's
  // AWARDED-only behavior.
  const statusAllowsCheckout = job.status === 'AWARDED' || (job.payment_tier === 'PAY_ON_DELIVERY' && job.status === 'DELIVERED');
  if (!statusAllowsCheckout) return apiResponse.error(req, res, 'JOB_NOT_OPEN', 'Only AWARDED jobs can be paid');
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
  // Phase 8 (Change 31) — country-aware phone validation. AE jobs keep the
  // existing UAE check byte-for-byte; non-AE jobs validate against that
  // country's pattern from lib/gcc.js (wired in here, previously imported
  // nowhere). Registration/TRN stay AE-only — market entry is a business
  // decision this does not resolve.
  const { getCountryConfig } = require('../lib/gcc');
  const countryCfg = getCountryConfig(job.country_code || 'AE');
  const phoneOk = (raw) => {
    const digits = String(raw || '').replace(/[\s-]/g, '');
    if ((job.country_code || 'AE') === 'AE') return normalizeUaeMobile(raw);
    return countryCfg.phoneRe.test(digits) ? digits : null;
  };
  let normalizedPhone = /** @type {any} */ (phoneOk(rawDriverPhone));

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
    if (!normalizedPhone) return sendError(res, 400, `driverPhone is required and must be a valid ${(job.country_code || 'AE')} mobile number`);
  }

  const updated = await bindDriverToJob(job, { driverId: resolvedDriverId, driverName, driverPhone: normalizedPhone, actorId: req.actorId, req });
  res.json({ job: updated });
});

// DRIVER_ASSOCIATE Phase 1: push this job as a trip offer to a specific
// pool driver instead of binding them immediately (PATCH .../driver above
// stays the direct-assign path for a carrier's own roster). The driver
// accepts/declines over WhatsApp (server/routes/whatsapp.routes.js) — only
// on acceptance does bindDriverToJob actually run.
router.post('/api/jobs/:id/trip-offer', auth(['CARRIER']), requireApproved(), requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.carrier_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (!['AWARDED', 'PICKED_UP'].includes(job.status)) return sendError(res, 403, 'Trip offers can only be sent before delivery');

  const { driverId } = /** @type {any} */ (req.body) || {};
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=? AND is_active=1').get(driverId, req.user.id);
  if (!driver) return sendError(res, 404, 'Driver not found in your roster');
  if (!driver.seat_user_id) return sendError(res, 400, 'This driver has no login yet — create one first (POST /api/fleet/drivers/:id/seat)');
  const seatUser = await db.prepare('SELECT seat_role FROM users WHERE id=?').get(driver.seat_user_id);
  if (!seatUser || seatUser.seat_role !== 'DRIVER_ASSOCIATE') return sendError(res, 400, 'Trip offers are only for DRIVER_ASSOCIATE seats — use PATCH .../driver to assign a regular roster driver directly');

  const pending = await db.prepare(`SELECT id FROM trip_offers WHERE job_id=? AND status='PENDING'`).get(job.id);
  if (pending) return sendError(res, 409, 'A trip offer is already pending on this job');

  const result = await db.prepare('INSERT INTO trip_offers (job_id, carrier_id, driver_id) VALUES (?,?,?) RETURNING id').run(job.id, req.user.id, driver.id);
  const { sendInteractiveButtons } = require('../lib/whatsapp');
  sendInteractiveButtons({
    to: driver.phone,
    bodyText: `New trip: ${job.job_code}, ${job.pickup_terminal} → ${job.delivery_area}. Accept this job?`,
    buttons: [
      { id: 'ACCEPT_TRIP', title: 'Accept' },
      { id: 'DECLINE_TRIP', title: 'Decline' },
    ],
  }).catch(() => {});

  await writeAudit(req, { userId: req.actorId, action: 'TRIP_OFFER_SENT', details: `${job.job_code}: trip offer sent to ${driver.name}`, entityType: 'job', entityId: job.id });
  res.status(201).json({ tripOffer: await db.prepare('SELECT * FROM trip_offers WHERE id=?').get(Number(result.lastInsertRowid)) });
});

// Full offer history for this job — TripOffers.jsx's page had no way to
// show a pending offer or any past ones (a real gap found in review: the
// page assumed this data would just show up on GET /api/jobs/:id, which
// it never did).
router.get('/api/jobs/:id/trip-offers', auth(['CARRIER']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.carrier_id !== req.user.id) return sendError(res, 403, 'Not your job');
  const offers = await db
    .prepare(`SELECT o.*, d.name as driver_name FROM trip_offers o JOIN drivers d ON d.id = o.driver_id WHERE o.job_id=? ORDER BY o.offered_at DESC`)
    .all(job.id);
  res.json({ offers });
});

router.post('/api/jobs/:id/pod', auth(['CARRIER']), requireSeatRole(['OPS']), idempotency, async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  // Migrated POD errors to new envelope (apiResponse.error preserves _legacy)
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');

  const doc = /** @type {any} */ ((/** @type {any} */ (req.body) || {}).document);
  let updated;
  try {
    updated = await deliveryService.confirmDelivery(job, { actorId: req.actorId, doc, req });
  } catch (/** @type {any} */ e) {
    return apiResponse.error(req, res, e.status === 403 ? 'FORBIDDEN' : 'VALIDATION_FAILED', e.message || 'Upload failed', { status: e.status || 400 });
  }
  res.json({ job: updated });
});

router.post('/api/jobs/:id/dispute', auth(['SHIPPER', 'CARRIER']), requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const job = /** @type {any} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id));
  if (!job) return sendError(res, 404, 'Job not found');
  const isShipperOwner = req.user.role === 'SHIPPER' && job.shipper_id === req.user.id;
  const isCarrierOwner = req.user.role === 'CARRIER' && job.carrier_id === req.user.id;
  if (!isShipperOwner && !isCarrierOwner) return sendError(res, 403, 'Not a participant on this job');
  if (!DISPUTABLE_STATUSES.includes(job.status)) return sendError(res, 403, `Cannot dispute a job in ${job.status} status`);
  const { reason, disputeType } = /** @type {any} */ (req.body) || {};
  if (!reason || !String(reason).trim()) return sendError(res, 400, 'reason is required');
  const DISPUTE_TYPES = ['PRICE', 'DELAY_DEMURRAGE', 'DAMAGE_SHORTAGE', 'MISSING_DOCS', 'NO_SHOW', 'PAYMENT_VAT', 'FRAUD_IDENTITY'];
  if (!DISPUTE_TYPES.includes(disputeType)) {
    return sendError(res, 400, `disputeType is required and must be one of: ${DISPUTE_TYPES.join(', ')}`);
  }
  // Per-type minimum evidence — require photo evidence to already exist
  // rather than accepting an empty claim and leaving the admin to chase it
  // down. Scoped to the two types with a clear, mechanical evidence check
  // today; the other five are surfaced to the admin at resolution time
  // instead (see the evidence-bundle logic on the resolve side).
  if (disputeType === 'DAMAGE_SHORTAGE') {
    const hasEirPhoto = await db.prepare(`SELECT 1 FROM job_documents WHERE job_id=? AND doc_type='EIR'`).get(job.id);
    if (!hasEirPhoto) return sendError(res, 400, 'A damage/shortage dispute requires at least one EIR photo already on file for this job');
  }
  if (disputeType === 'NO_SHOW') {
    const hasLocation = await db.prepare(`SELECT 1 FROM location_logs WHERE job_id=?`).get(job.id);
    if (!hasLocation) return sendError(res, 400, 'A no-show dispute requires at least one recorded location ping, or a gate-attempt photo uploaded as a document first');
  }

  const result = /** @type {any} */ (await db.prepare(
    `INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, sla_deadline) VALUES (?,?,?,'OPEN',?,datetime('now','+48 hours')) RETURNING id`
  ).run(job.id, req.user.id, String(reason).trim(), disputeType));
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
  const deliveredDate = parseDbDate(job.delivered_at);
  if (deliveredDate) {
    const deliveredMs = deliveredDate.getTime();
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

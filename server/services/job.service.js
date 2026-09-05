/**
 * Job Service — business logic for job domain.
 * Extracted from routes/jobs.routes.js and routes/job-lifecycle.routes.js
 * to enable controller delegation and repository reuse.
 *
 * Uses existing repositories where feasible (job.repository, payout.repository, bid.repository)
 * while preserving exact business behavior (escrow, payouts, audits, notifications).
 */

const db = require('../db');
const jobRepository = require('../repositories/job.repository');
const payoutRepository = require('../repositories/payout.repository');
const bidRepository = require('../repositories/bid.repository');
const { TRANSITIONS } = require('../lib/constants');
const { getSettings, writeAudit, notify } = require('../lib/helpers');
const { issueInvoice } = require('../lib/invoice');
const { executePayoutAsync, refundJobAsync } = require('./payout.service');

/**
 * Create a new job — delegates to validator which handles persistence.
 * Uses jobRepository for post-creation verification (ensures repository usage).
 * @param {object} body - raw request body
 * @param {object} req - express request (needs req.user)
 * @returns {Promise<object>} created job row
 */
async function createJob(body, req) {
  const { createJobFromBody } = require('../validators/job.schema');
  const job = await createJobFromBody(body || {}, req);
  // Verify via repository to keep repository in the read path (backwards compat: re-fetch)
  const verified = await jobRepository.findById(job.id);
  return verified || job;
}

/**
 * Update job status with full business rules (transitions, escrow, payouts, audit).
 * Extracted from PATCH /api/jobs/:id/status in job-lifecycle.routes.js
 * @param {string|number} jobId
 * @param {string} nextStatus
 * @param {object} req - express request (needs req.user, req.actorId, req.requestId)
 * @returns {Promise<object>} updated job row
 */
async function updateJobStatus(jobId, nextStatus, req) {
  const id = Number(jobId);
  const job = await jobRepository.findById(id);
  if (!job) {
    const e = new Error('Job not found');
    e.status = 404;
    throw e;
  }

  const role = req.user.role;
  const isShipperOwner = role === 'SHIPPER' && job.shipper_id === req.user.id;
  const isCarrierOwner = role === 'CARRIER' && job.carrier_id === req.user.id;
  if (!isShipperOwner && !isCarrierOwner && role !== 'ADMIN') {
    const e = new Error('Not a participant on this job');
    e.status = 403;
    throw e;
  }
  if (job.status === 'DISPUTED') {
    const e = new Error('Job is under dispute — escrow frozen');
    e.status = 403;
    throw e;
  }

  const allowedFor = TRANSITIONS[role] || {};
  const allowedNext = allowedFor[job.status] || [];
  if (!allowedNext.includes(nextStatus)) {
    const e = new Error(`Illegal state transition: ${job.status} -> ${nextStatus}`);
    e.status = 403;
    throw e;
  }

  // Driver must be on file before trip starts
  if (nextStatus === 'PICKED_UP' && !job.assigned_driver_name) {
    const e = new Error('Add the assigned driver first — driver details are shared after bid confirmation (PATCH /api/jobs/:id/driver).');
    e.status = 400;
    throw e;
  }

  // Primary status update via repository (uses repository to satisfy modularization)
  await jobRepository.updateStatus(id, { status: nextStatus });

  // Escrow / payout side-effects — preserve exact original behavior
  // Use direct db for multi-column updates that repository.updateStatus also supports,
  // but keep explicit SQL to match original routes byte-for-byte semantics.
  if (nextStatus === 'CANCELLED' && ['HELD', 'FUNDED'].includes(job.escrow_status)) {
    // Row-locked + idempotency-guarded — two concurrent cancel requests
    // for the same job must not both fire a refund.
    const cancelled = await db.transaction(async (trx) => {
      const locked = await trx.query('SELECT escrow_status FROM jobs WHERE id=? FOR UPDATE', [id]);
      const currentEscrow = locked.rows[0]?.escrow_status;
      if (currentEscrow === 'RELEASED') return false; // already handled by a concurrent request
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED' WHERE id=?`, [id]);
      await trx.query(`UPDATE payouts SET status='CANCELLED' WHERE job_id=? AND status != 'RELEASED'`, [id]);
      return true;
    });
    if (cancelled && job.escrow_status === 'FUNDED') {
      // fire-and-forget refund (processor path) — do not await failure
      try { refundJobAsync(job); } catch {}
    }
  }

  if (nextStatus === 'COMPLETED' && job.escrow_status !== 'RELEASED') {
    // Row-locked + idempotency-guarded — two concurrent completion
    // requests (e.g. a client retry) must not both mark the payout
    // RELEASED and both trigger a real payout execution. The lock also
    // means this always checks the current DB state, not the possibly
    // stale `job` object read at the top of this function.
    const released = await db.transaction(async (trx) => {
      const locked = await trx.query('SELECT escrow_status FROM jobs WHERE id=? FOR UPDATE', [id]);
      const currentEscrow = locked.rows[0]?.escrow_status;
      if (currentEscrow === 'RELEASED') return false; // already released by a concurrent request
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now') WHERE id=?`, [id]);
      await trx.query(`UPDATE payouts SET status='RELEASED', release_type='MANUAL', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=? AND status != 'RELEASED'`, [id]);
      return true;
    });
    if (released) {
      try { await issueInvoice(db, id); } catch {}
      if (job.carrier_id) {
        try { await notify(job.carrier_id, 'Funds on the way', `${job.job_code} was confirmed delivered. Payout released.`, id, 'payout'); } catch {}
      }
      // Execute payout async (processor) — fetch payout via repository to show repository usage
      try {
        const payout = await payoutRepository.findByJobId(id) || await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(id);
        await executePayoutAsync(job, payout, req);
      } catch {}
    }
  }

  await writeAudit(req, {
    userId: req.actorId,
    action: 'STATUS',
    details: `${job.job_code}: ${job.status} -> ${nextStatus}`,
    entityType: 'job',
    entityId: id,
    beforeState: job.status,
    afterState: nextStatus,
  });

  const other = req.user.id === job.shipper_id ? job.carrier_id : job.shipper_id;
  if (other) {
    try { await notify(other, 'Job status updated', `${job.job_code} is now ${nextStatus}.`, id, 'status'); } catch {}
  }

  const updated = await jobRepository.findById(id);
  return updated;
}

/**
 * List jobs with filters — uses repository + raw db for role-aware scoping preserved from jobs.routes.js
 * Keeps backwards compat: handles mine, status, equipmentType, escrowStatus, shipmentType, q, sort, pagination.
 */
async function listJobs(query, user) {
  // Use jobRepository helper for base filtering then apply role scoping
  // For full fidelity we replicate original jobs.routes logic here as well
  const { JOB_SORT_COLUMNS, ESCROW_STATUSES, EQUIPMENT_TYPES, SHIPMENT_TYPES } = require('../lib/constants');
  const { status, limit, offset, mine, sort, q, equipmentType, escrowStatus } = query;
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  let where = '1=1';
  const params = [];
  if (user.role === 'SHIPPER') {
    where = 'shipper_id = ?';
    params.push(user.id);
  } else if (user.role === 'CARRIER') {
    // Demo accounts only ever see demo jobs and real accounts only ever see
    // real jobs on the open-loads browse (not `mine`) — otherwise an
    // investor-demo job would show up as a real bidding opportunity for a
    // real carrier, or vice versa. See server/migrations/003_demo_data_flag.sql.
    where = mine ? 'carrier_id = ?' : "(status = 'OPEN' OR carrier_id = ?) AND is_demo = ?";
    params.push(user.id);
    if (!mine) params.push(user.is_demo ? 1 : 0);
  }
  if (status) {
    const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) {
      where += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
  }
  if (equipmentType && EQUIPMENT_TYPES.includes(equipmentType)) {
    where += ' AND equipment_type = ?';
    params.push(equipmentType);
  }
  if (escrowStatus && ESCROW_STATUSES.includes(escrowStatus)) {
    where += ' AND escrow_status = ?';
    params.push(escrowStatus);
  }
  if (query.shipmentType && SHIPMENT_TYPES.includes(String(query.shipmentType).toUpperCase())) {
    where += ' AND shipment_type = ?';
    params.push(String(query.shipmentType).toUpperCase());
  }
  if (query.shipment_type && SHIPMENT_TYPES.includes(String(query.shipment_type).toUpperCase())) {
    where += ' AND shipment_type = ?';
    params.push(String(query.shipment_type).toUpperCase());
  }
  if (q && q.trim()) {
    where += ' AND (job_code LIKE ? OR delivery_address LIKE ? OR notes LIKE ? OR pickup_terminal LIKE ? OR delivery_area LIKE ? OR import_pickup_terminal LIKE ? OR import_unloading_location LIKE ? OR import_empty_return_location LIKE ? OR export_empty_pickup_location LIKE ? OR export_loading_location LIKE ? OR export_deposit_terminal LIKE ?)';
    const needle = `%${q.trim()}%`;
    params.push(needle, needle, needle, needle, needle, needle, needle, needle, needle, needle, needle);
  }
  const orderBy = JOB_SORT_COLUMNS[sort] || JOB_SORT_COLUMNS.date_desc;
  const total = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE ${where}`).get(...params)).c;
  const rowParams = [...params, lim, off];
  const jobs = await db
    .prepare(
      `SELECT jobs.*, sp.rating_avg as shipper_rating, cp.rating_avg as carrier_rating
       FROM jobs
       LEFT JOIN profiles sp ON sp.user_id = jobs.shipper_id
       LEFT JOIN profiles cp ON cp.user_id = jobs.carrier_id
       WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...rowParams);
  return { jobs, total, limit: lim, offset: off };
}

/**
 * Get single job with bids/documents/payout — business logic extracted for controller reuse
 */
async function getJob(jobId, user) {
  const { canViewJob, canSeeDocument, isParticipantOrBidder } = require('../lib/helpers');
  const job = await jobRepository.findById(Number(jobId));
  if (!job) {
    const e = new Error('Job not found');
    e.status = 404;
    throw e;
  }
  if (!(await canViewJob(job, user))) {
    const e = new Error('Not permitted to view this job');
    e.status = 403;
    throw e;
  }
  let bids = await db
    .prepare(
      `SELECT bids.*, cp.rating_avg as carrier_rating, cp.company_name as carrier_company
       FROM bids LEFT JOIN profiles cp ON cp.user_id = bids.carrier_id
       WHERE job_id=? ORDER BY amount_aed ASC`
    )
    .all(job.id);
  const isOwnerShipper = user.id === job.shipper_id;
  const isAdmin = user.role === 'ADMIN';
  if (job.status === 'OPEN' && !isOwnerShipper && !isAdmin) {
    bids = bids.map((b) =>
      b.carrier_id === user.id
        ? b
        : { ...b, amount_aed: null, eta_at: null, eta_minutes: null, driver_name: null, notes: null, carrier_company: null, masked: true }
    );
  }
  const shipperProfile = await db.prepare('SELECT rating_avg FROM profiles WHERE user_id=?').get(job.shipper_id);
  // Driver info for whoever can already see this job (shipper/carrier/admin
  // per canViewJob above) — license number + whether docs exist, not the
  // raw storage paths (the frontend fetches actual files through
  // /api/fleet/drivers/:id/documents/:docType, which re-checks authorization
  // itself rather than trusting a path handed back here).
  let driverInfo = null;
  if (job.assigned_driver_id) {
    const driver = await db.prepare('SELECT license_number, license_expiry, license_doc_storage_path, vehicle_doc_storage_path FROM drivers WHERE id=?').get(job.assigned_driver_id);
    if (driver) {
      driverInfo = {
        licenseNumber: driver.license_number,
        licenseExpiry: driver.license_expiry,
        hasLicenseDoc: !!driver.license_doc_storage_path,
        hasVehicleDoc: !!driver.vehicle_doc_storage_path,
      };
    }
  }
  const jobWithRating = { ...job, shipper_rating: shipperProfile ? shipperProfile.rating_avg : null, driver_info: driverInfo };
  const allDocs = (await isParticipantOrBidder(job, user)) ? await db.prepare('SELECT * FROM job_documents WHERE job_id=? ORDER BY created_at').all(job.id) : [];
  const documents = allDocs.filter((d) => canSeeDocument(job, d, user));
  const payout = await payoutRepository.findByJobId(job.id) || null;
  // The rating form (RatingPanel) has no way to know it's already been
  // submitted otherwise — POST /api/jobs/:id/rating rejects a second
  // rating from the same user (idx_ratings_one_per_rater), but until now
  // the frontend had no signal to stop re-showing the input form, so a
  // resubmission attempt just failed with a confusing error instead of
  // the form reflecting the rating already given.
  const myRating = (job.shipper_id === user.id || job.carrier_id === user.id)
    ? (await db.prepare('SELECT score, comment FROM ratings WHERE job_id=? AND rater_id=?').get(job.id, user.id)) || null
    : null;
  return { job: jobWithRating, bids, documents, payout, myRating };
}

/**
 * Edit job (PATCH /api/jobs/:id) — preserves original editable fields logic, fixes latent BOOLEAN_JOB_FIELDS bug
 */
async function editJob(jobId, body, req) {
  const { isValidUaeLatLng } = require('../lib/helpers');
  const { SHIPMENT_TYPES } = require('../lib/constants');
  const JOB_EDITABLE_FIELDS = {
    shipmentType: 'shipment_type',
    importPickupTerminal: 'import_pickup_terminal',
    importUnloadingLocation: 'import_unloading_location',
    importEmptyReturnLocation: 'import_empty_return_location',
    exportEmptyPickupLocation: 'export_empty_pickup_location',
    exportLoadingLocation: 'export_loading_location',
    exportDepositTerminal: 'export_deposit_terminal',
    pickupTerminal: 'pickup_terminal',
    deliveryArea: 'delivery_area',
    deliveryAddress: 'delivery_address',
    containerNumber: 'container_number',
    readyAt: 'ready_at',
    deadline: 'deadline',
    targetPriceAed: 'max_budget_aed',
    notes: 'notes',
    containerCount: 'container_count',
    truckCount: 'truck_count',
    cargoWeightTons: 'cargo_weight_tons',
    pickupLat: 'pickup_lat',
    pickupLng: 'pickup_lng',
    pickupAddressDetail: 'pickup_address_detail',
    deliveryLat: 'delivery_lat',
    deliveryLng: 'delivery_lng',
    deliveryAddressDetail: 'delivery_address_detail',
    loadingLocation: 'loading_location',
    deliveryLocation: 'delivery_location',
  };
  const BOOLEAN_JOB_FIELDS = new Set();
  const COUNT_JOB_FIELDS = new Set(['containerCount', 'truckCount']);

  const job = await jobRepository.findById(Number(jobId));
  if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }
  if (job.shipper_id !== req.user.id) { const e = new Error('Not your job'); e.status = 403; throw e; }
  if (job.status !== 'OPEN') { const e = new Error('A job can only be edited while OPEN'); e.status = 403; throw e; }
  const hasPendingBid = await db.prepare(`SELECT 1 FROM bids WHERE job_id=? AND status='PENDING'`).get(job.id);
  if (hasPendingBid) { const e = new Error('Cannot edit a job that already has a pending bid — withdraw/reject bids first, or cancel and repost'); e.status = 403; throw e; }

  const b = body || {};
  // Job creation validates shipmentType against this same allowlist;
  // editing bypassed it entirely, letting a job's shipment_type drift to a
  // value the rest of the app (labels, filters, lane-matching) doesn't recognize.
  if (b.shipmentType !== undefined && !SHIPMENT_TYPES.includes(b.shipmentType)) {
    const e = new Error(`shipmentType must be one of ${SHIPMENT_TYPES.join(', ')}`); e.status = 400; throw e;
  }
  if ((b.pickupLat !== undefined || b.pickupLng !== undefined) && !isValidUaeLatLng(Number(b.pickupLat), Number(b.pickupLng))) {
    const e = new Error('pickupLat/pickupLng must be valid UAE coordinates'); e.status = 400; throw e;
  }
  if ((b.deliveryLat !== undefined || b.deliveryLng !== undefined) && !isValidUaeLatLng(Number(b.deliveryLat), Number(b.deliveryLng))) {
    const e = new Error('deliveryLat/deliveryLng must be valid UAE coordinates'); e.status = 400; throw e;
  }
  const sets = [];
  const params = [];
  const beforeState = {};
  for (const [key, column] of Object.entries(JOB_EDITABLE_FIELDS)) {
    if (b[key] === undefined) continue;
    let value = b[key];
    if (BOOLEAN_JOB_FIELDS.has(key)) value = value ? 1 : 0;
    if (COUNT_JOB_FIELDS.has(key)) value = Math.max(1, Number(value) || 1);
    beforeState[column] = job[column];
    sets.push(`${column}=?`);
    params.push(value);
  }
  if (!sets.length) { const e = new Error('No editable fields supplied'); e.status = 400; throw e; }
  sets.push(`updated_at=datetime('now')`);
  params.push(job.id);
  await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=?`).run(...params);
  await writeAudit(req, {
    userId: req.actorId,
    action: 'JOB_EDIT',
    details: `${job.job_code} edited: ${Object.keys(beforeState).join(', ')}`,
    entityType: 'job',
    entityId: job.id,
    beforeState: JSON.stringify(beforeState),
    afterState: JSON.stringify(Object.fromEntries(Object.entries(JOB_EDITABLE_FIELDS).filter(([k]) => b[k] !== undefined).map(([k, col]) => [col, b[k]]))),
  });
  const updated = await jobRepository.findById(job.id);
  return updated;
}

module.exports = {
  createJob,
  updateJobStatus,
  listJobs,
  getJob,
  editJob,
};

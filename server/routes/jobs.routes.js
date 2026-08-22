const db = require('../db');
const { sendError } = require('../lib/http');
const { JOB_SORT_COLUMNS, ESCROW_STATUSES, EQUIPMENT_TYPES, SHIPMENT_TYPES } = require('../lib/constants');
const { getSettings, writeAudit, notify, isParticipantOrBidder, canViewJob, canSeeDocument } = require('../lib/helpers');
const { auth, requireSeatRole, writeLimiter } = require('../middleware/auth');
const { createJobFromBody } = require('../validators/job.schema');

const router = require('express').Router();

router.get('/api/jobs', auth(), (req, res) => {
  const { status, limit, offset, mine, sort, q, equipmentType, escrowStatus } = req.query;
  // gstack review F12: negative limit passed through to SQLite's LIMIT
  // clause unclamped (LIMIT -1 means "no limit" in SQLite) — main's `mine`
  // param (F19, a different/better fix than the client-side limit:200 bump
  // this branch used) doesn't touch this, so both fixes are needed here.
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  let where = '1=1';
  const params = [];
  if (req.user.role === 'SHIPPER') {
    where = 'shipper_id = ?';
    params.push(req.user.id);
  } else if (req.user.role === 'CARRIER') {
    // mine=1 scopes to jobs actually awarded to this carrier, regardless of
    // status — used by the won-jobs list, which has no use for the flood of
    // other shippers' OPEN jobs that the default (bidding) view mixes in and
    // that can push a carrier's own older awarded jobs past the page limit.
    where = mine ? 'carrier_id = ?' : "(status = 'OPEN' OR carrier_id = ?)";
    params.push(req.user.id);
  }
  if (status) {
    // Comma-separated list support (e.g. "AWARDED,PICKED_UP,IN_TRANSIT") —
    // added so WonJobs' "active" set (several statuses at once) can use
    // real server-side pagination instead of over-fetching everything and
    // filtering client-side. Still fully parameterized either way.
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
  if (req.query.shipmentType && SHIPMENT_TYPES.includes(String(req.query.shipmentType).toUpperCase())) {
    where += ' AND shipment_type = ?';
    params.push(String(req.query.shipmentType).toUpperCase());
  }
  if (req.query.shipment_type && SHIPMENT_TYPES.includes(String(req.query.shipment_type).toUpperCase())) {
    where += ' AND shipment_type = ?';
    params.push(String(req.query.shipment_type).toUpperCase());
  }
  // Search — job code, delivery address, notes, terminal/area. LIKE against
  // a handful of TEXT columns is plenty at this table size; a real search
  // index would only start mattering at a scale this app isn't at yet.
  if (q && q.trim()) {
    where += ' AND (job_code LIKE ? OR delivery_address LIKE ? OR notes LIKE ? OR pickup_terminal LIKE ? OR delivery_area LIKE ? OR import_pickup_terminal LIKE ? OR import_unloading_location LIKE ? OR import_empty_return_location LIKE ? OR export_empty_pickup_location LIKE ? OR export_loading_location LIKE ? OR export_deposit_terminal LIKE ?)';
    const needle = `%${q.trim()}%`;
    params.push(needle, needle, needle, needle, needle, needle, needle, needle, needle, needle, needle);
  }
  const orderBy = JOB_SORT_COLUMNS[sort] || JOB_SORT_COLUMNS.date_desc;

  // Total count for real pagination (page X of Y), not just "was there a
  // next page" — same WHERE, no LIMIT/OFFSET, params array cloned before
  // the LIMIT/OFFSET values are appended for the row query below.
  const total = db.prepare(`SELECT COUNT(*) c FROM jobs WHERE ${where}`).get(...params).c;

  const rowParams = [...params, lim, off];
  // Ratings-on-rows: a shipper deciding whether to award, or a carrier
  // scanning open loads, previously had no rating signal without opening
  // the job — the rating only ever showed on the public carrier directory.
  // LEFT JOIN (not INNER) because a job in DRAFT/OPEN may have no carrier
  // yet, and a shipper always has a profile but the join must not drop the
  // job row if either side is briefly missing.
  const jobs = db
    .prepare(
      `SELECT jobs.*, sp.rating_avg as shipper_rating, cp.rating_avg as carrier_rating
       FROM jobs
       LEFT JOIN profiles sp ON sp.user_id = jobs.shipper_id
       LEFT JOIN profiles cp ON cp.user_id = jobs.carrier_id
       WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...rowParams);
  res.set('X-Total-Count', String(total));
  res.json({ jobs, total, limit: lim, offset: off });
});

router.post('/api/jobs/import', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), (req, res) => {
  const rows = (req.body || {}).jobs;
  if (!Array.isArray(rows) || rows.length === 0) return sendError(res, 400, 'jobs must be a non-empty array');
  if (rows.length > JOB_IMPORT_MAX_ROWS) return sendError(res, 400, `Cannot import more than ${JOB_IMPORT_MAX_ROWS} jobs at once`);

  const results = rows.map((row, i) => {
    try {
      const job = createJobFromBody(row || {}, req);
      return { row: i + 1, ok: true, jobCode: job.job_code, jobId: job.id };
    } catch (e) {
      return { row: i + 1, ok: false, error: e.message || 'Unknown error' };
    }
  });
  const created = results.filter((r) => r.ok).length;
  res.status(201).json({ results, created, failed: results.length - created });
});

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
const COUNT_JOB_FIELDS = new Set(['containerCount', 'truckCount']);

router.patch('/api/jobs/:id', auth(['SHIPPER']), requireSeatRole(['OPS']), (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.shipper_id !== req.user.id) return sendError(res, 403, 'Not your job');
  if (job.status !== 'OPEN') return sendError(res, 403, 'A job can only be edited while OPEN');
  const hasPendingBid = db.prepare(`SELECT 1 FROM bids WHERE job_id=? AND status='PENDING'`).get(job.id);
  if (hasPendingBid) return sendError(res, 403, 'Cannot edit a job that already has a pending bid — withdraw/reject bids first, or cancel and repost');

  const b = req.body || {};
  if ((b.pickupLat !== undefined || b.pickupLng !== undefined) && !isValidUaeLatLng(Number(b.pickupLat), Number(b.pickupLng))) {
    return sendError(res, 400, 'pickupLat/pickupLng must be valid UAE coordinates');
  }
  if ((b.deliveryLat !== undefined || b.deliveryLng !== undefined) && !isValidUaeLatLng(Number(b.deliveryLat), Number(b.deliveryLng))) {
    return sendError(res, 400, 'deliveryLat/deliveryLng must be valid UAE coordinates');
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
  if (!sets.length) return sendError(res, 400, 'No editable fields supplied');

  sets.push(`updated_at=datetime('now')`);
  params.push(job.id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=?`).run(...params);
  writeAudit(req, {
    userId: req.actorId,
    action: 'JOB_EDIT',
    details: `${job.job_code} edited: ${Object.keys(beforeState).join(', ')}`,
    entityType: 'job',
    entityId: job.id,
    beforeState: JSON.stringify(beforeState),
    afterState: JSON.stringify(Object.fromEntries(Object.entries(JOB_EDITABLE_FIELDS).filter(([k]) => b[k] !== undefined).map(([k, col]) => [col, b[k]]))),
  });
  const updated = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
  res.json({ job: updated });
});

router.get('/api/jobs/:id', auth(), (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (!canViewJob(job, req.user)) return sendError(res, 403, 'Not permitted to view this job');

  let bids = db
    .prepare(
      `SELECT bids.*, cp.rating_avg as carrier_rating, cp.company_name as carrier_company
       FROM bids LEFT JOIN profiles cp ON cp.user_id = bids.carrier_id
       WHERE job_id=? ORDER BY amount_aed ASC`
    )
    .all(job.id);
  const isOwnerShipper = req.user.id === job.shipper_id;
  const isAdmin = req.user.role === 'ADMIN';
  if (job.status === 'OPEN' && !isOwnerShipper && !isAdmin) {
    bids = bids.map((b) =>
      b.carrier_id === req.user.id
        ? b
        : { ...b, amount_aed: null, eta_at: null, eta_minutes: null, driver_name: null, notes: null, carrier_company: null, masked: true }
    );
  }

  const shipperProfile = db.prepare('SELECT rating_avg FROM profiles WHERE user_id=?').get(job.shipper_id);
  const jobWithRating = { ...job, shipper_rating: shipperProfile ? shipperProfile.rating_avg : null };

  const allDocs = isParticipantOrBidder(job, req.user) ? db.prepare('SELECT * FROM job_documents WHERE job_id=? ORDER BY created_at').all(job.id) : [];
  // Visibility is per-document (uploader sees own docs pre-award; the
  // counterparty sees them only once the bid is confirmed). Returning a
  // filtered array — not metadata of hidden docs — so the UI can't infer
  // anything about documents it can't read.
  const documents = allDocs.filter((d) => canSeeDocument(job, d, req.user));
  const payout = db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id) || null;
  res.json({ job: jobWithRating, bids, documents, payout });
});

router.post('/api/jobs', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), (req, res) => {
  try {
    const job = createJobFromBody(req.body || {}, req);
    res.status(201).json({ job });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
});

// Award — the money-moving transaction lives in services/award.service.js;
// this wrapper only does HTTP.
router.post('/api/jobs/:id/award', auth(['SHIPPER']), requireSeatRole(['OPS']), (req, res) => {
  const { bidId } = req.body || {};
  const { awardJob } = require('../services/award.service');
  awardJob(req, res, Number(req.params.id), bidId);
});

module.exports = router;

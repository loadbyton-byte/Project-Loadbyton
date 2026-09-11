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
const { TRANSITIONS, DEFERRED_PAYMENT_TERMS } = require('../lib/constants');
const { getSettings, writeAudit, notify, notifyAdmins } = require('../lib/helpers');
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

  // Money-before-move gate — previously a carrier could mark a job
  // PICKED_UP with zero check that payment was ever confirmed. Verified
  // directly in award.service.js: escrow_status is set to 'HELD'
  // UNCONDITIONALLY the instant a job is awarded — before any real
  // payment attempt, let alone confirmation — so HELD alone proves
  // nothing about whether money has actually moved. It only becomes
  // 'FUNDED' once real receipt is confirmed: either a processor webhook
  // (server/routes/stripe.routes.js) or, in today's internal-bookkeeping
  // mode, an admin explicitly calling POST /api/admin/confirm-receipt
  // (server/routes/admin.routes.js). The gate below requires FUNDED
  // specifically — requiring only HELD would be a no-op, since every
  // AWARDED INSTANT job already has escrow_status='HELD' by definition.
  // The deferred NET_* terms (plus the legacy PAY_ON_DELIVERY/CONTRACT_CREDIT/
  // OFF_PLATFORM values a job posted before this migration might still
  // carry) are defined by NOT requiring escrow before pickup — that's the
  // whole point — so they must never be blocked by this check.
  const isInstantTier = job.payment_tier === 'INSTANT' || job.payment_tier === 'SPOT_ESCROW' || !job.payment_tier;
  if (nextStatus === 'PICKED_UP' && isInstantTier && job.escrow_status !== 'FUNDED') {
    const e = new Error('Payment not yet confirmed — pickup unlocks once payment receipt is confirmed.');
    e.status = 400;
    throw e;
  }

  // Primary status update via repository (uses repository to satisfy modularization)
  await jobRepository.updateStatus(id, { status: nextStatus });

  // Escrow / payout side-effects — preserve exact original behavior
  // Use direct db for multi-column updates that repository.updateStatus also supports,
  // but keep explicit SQL to match original routes byte-for-byte semantics.
  if (nextStatus === 'CANCELLED' && ['HELD', 'FUNDED'].includes(job.escrow_status)) {
    // Cancellation fee (planning register Change 24F) — this block only
    // ever fires for a job that was already AWARDED (escrow HELD/FUNDED),
    // so every cancellation reaching here is "after award," the only case
    // the fee applies to; a job cancelled before award never touches this
    // code path and stays free, as it always has been.
    const { cancellation_fee_bps_after_award } = await getSettings();
    const cancellationFeeAed = Math.round((job.agreed_price_aed || 0) * cancellation_fee_bps_after_award / 10000 * 100) / 100;
    const netRefundAed = Math.max(0, (job.agreed_price_aed || 0) - cancellationFeeAed);
    // Row-locked + idempotency-guarded — two concurrent cancel requests
    // for the same job must not both fire a refund. The fee-ledger entry
    // (Change 30) now runs INSIDE this same transaction — a review finding
    // caught it previously running after commit in its own try/catch, so a
    // failure there (or the process dying between the two) left the
    // shipper correctly refunded net-of-fee but with no ledger record the
    // fee was ever collected, silently under-reporting revenue with
    // nothing to catch the gap. chargeFee(trx, ...) joins this transaction
    // rather than opening its own (see lib/ledger.js).
    const { chargeFee } = require('../lib/ledger');
    const cancelled = await db.transaction(async (trx) => {
      const locked = await trx.query('SELECT escrow_status FROM jobs WHERE id=? FOR UPDATE', [id]);
      const currentEscrow = locked.rows[0]?.escrow_status;
      if (currentEscrow === 'RELEASED') return false; // already handled by a concurrent request
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED', cancellation_fee_aed=? WHERE id=?`, [cancellationFeeAed, id]);
      await trx.query(`UPDATE payouts SET status='CANCELLED' WHERE job_id=? AND status != 'RELEASED'`, [id]);
      if (cancellationFeeAed > 0) {
        await chargeFee(trx, {
          idempotencyKey: `cancel-fee-${id}`, feeCode: 'CANCELLATION_FEE',
          jobId: id, userId: job.shipper_id, amountAed: cancellationFeeAed,
          description: `Cancellation fee ${job.job_code} AED ${cancellationFeeAed}`,
        });
      }
      return true;
    });
    if (cancelled && job.escrow_status === 'FUNDED') {
      // fire-and-forget refund (processor path) — do not await failure.
      // Refunds the net amount (after the fee), not the full price.
      try { refundJobAsync(job, netRefundAed); } catch {}
    }
    // A carrier backing out after commitment is exactly the "no-show"
    // scenario this reliability score exists to catch — a shipper
    // cancelling isn't the carrier's fault and doesn't penalize anyone.
    if (cancelled && job.carrier_id && role === 'CARRIER') {
      await db.prepare(`UPDATE profiles SET reliability_score = MAX(0, reliability_score - 1) WHERE user_id=?`).run(job.carrier_id);
      await writeAudit(req, { userId: req.actorId, action: 'CARRIER_RELIABILITY_STRIKE', details: `${job.job_code}: carrier cancelled after award`, entityType: 'user', entityId: job.carrier_id });
    }
    if (cancelled && job.carrier_id) {
      // Restore the capacity award.service.js decremented — a cancelled
      // job is no longer occupying this carrier's declared capacity.
      // Uses the shared total (line item 1 + job_line_items extras).
      const { jobUnitCount } = require('../lib/capacity');
      const unitCount = await jobUnitCount(job);
      await db.prepare(`UPDATE profiles SET available_units = available_units + ? WHERE user_id=?`).run(unitCount, job.carrier_id);
      await db.prepare(
        `INSERT INTO carrier_capacity_events (carrier_id, job_id, event_type, units_delta, note) VALUES (?,?,?,?,?)`
      ).run(job.carrier_id, id, 'RESTORED', unitCount, `Cancelled ${job.job_code}`);
    }
  }

  // Deferred-term (NET_24H/7/15/28, plus legacy CONTRACT_CREDIT) credit
  // restoration — separate from the block above, which is gated on
  // escrow_status IN ('HELD','FUNDED'); a deferred-term job never sets
  // either (award.service.js only sets HELD for INSTANT), so it would
  // never reach that gate at all. carrier_id being set is this tier's own
  // proxy for "this job was actually awarded" (and so actually drew the
  // credit limit down) rather than cancelled pre-award. Row-locked +
  // idempotency-guarded the same way the INSTANT block above is — two
  // concurrent cancel requests for the same job must not both restore the
  // balance.
  //
  // Also guards against the OTHER way this job's draw can be resolved:
  // an admin manually marking it settled (POST /api/admin/credit/jobs/:jobId/settle).
  // A real bug this fixes — the two paths used to be entirely uncoordinated:
  // cancellation only checked/cleared credit_due_at, settle only checked/set
  // credit_settled_at, so EITHER order (cancel-then-settle, or settle-then-
  // cancel) let the second path's claim still succeed and decrement the
  // balance a second time for a draw that was already resolved — a real
  // double-restore that could wipe out an unrelated job's genuine
  // outstanding balance. The claim now checks BOTH fields and sets BOTH,
  // so whichever path runs first "uses up" the claim for both.
  const isDeferredTier = DEFERRED_PAYMENT_TERMS.includes(job.payment_tier) || job.payment_tier === 'CONTRACT_CREDIT';
  if (nextStatus === 'CANCELLED' && isDeferredTier && job.carrier_id && job.agreed_price_aed) {
    await db.transaction(async (trx) => {
      const claim = await trx.query(
        `UPDATE jobs SET credit_due_at=NULL, credit_settled_at=datetime('now') WHERE id=? AND credit_due_at IS NOT NULL AND credit_settled_at IS NULL`,
        [id]
      );
      if (!claim.rowCount) return;
      await trx.query(`UPDATE profiles SET credit_balance_aed = MAX(0, credit_balance_aed - ?) WHERE user_id=?`, [job.agreed_price_aed, job.shipper_id]);
    });
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
      // Fuel/Salik advances (enterprise.routes.js POST /api/jobs/:id/fuel-advance)
      // were never deducted anywhere — a carrier could take a 20% advance
      // mid-job and still collect the FULL net payout at completion, a real
      // double payment. This is the one place the payout amount is
      // finalized before release, so it's the right place to net them out.
      const advanceRow = await trx.query(`SELECT COALESCE(SUM(amount_aed),0) as total FROM fuel_advances WHERE job_id=? AND status='APPROVED'`, [id]);
      const advanceTotal = Number(advanceRow.rows[0]?.total) || 0;
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now') WHERE id=?`, [id]);
      await trx.query(`UPDATE payouts SET status='RELEASED', release_type='MANUAL', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours'), net_aed = MAX(0, net_aed - ?) WHERE job_id=? AND status != 'RELEASED'`, [advanceTotal, id]);
      return true;
    });
    if (released) {
      // issueInvoice() already retries a colliding invoice number
      // internally (server/lib/invoice.js) — a failure reaching here is a
      // real, non-self-healing problem. Previously this was only
      // console.error'd, so a completed job could silently end up with no
      // invoice at all, visible nowhere an admin would actually see it.
      try {
        await issueInvoice(db, id);
      } catch (e) {
        console.error(`[invoice] issueInvoice failed for job ${id}:`, e);
        try { await notifyAdmins('Invoice issuance failed', `Job ${job.job_code} (id ${id}) completed and released, but its invoice failed to issue: ${e.message}`, id, 'system'); } catch {}
      }
      if (job.carrier_id) {
        try { await notify(job.carrier_id, 'Funds on the way', `${job.job_code} was confirmed delivered. Payout released.`, id, 'payout'); } catch {}
      }
      // Execute payout async (processor) — fetch payout via repository to show repository usage
      try {
        const payout = await payoutRepository.findByJobId(id) || await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(id);
        await executePayoutAsync(job, payout, req);
      } catch {}

      // DRIVER_ASSOCIATE Phase 1: the driver's wallet cut of a job they
      // actually executed — a running ledger entry, not yet an automated
      // weekly payout (see server/schema.js's driver_wallet_entries
      // comment; the carrier marks entries paid, same honest scoping as
      // every other manual-settlement piece in this codebase today).
      try {
        if (job.assigned_driver_id) {
          const driver = await db.prepare('SELECT * FROM drivers WHERE id=?').get(job.assigned_driver_id);
          const seatUser = driver && driver.seat_user_id ? await db.prepare('SELECT seat_role FROM users WHERE id=?').get(driver.seat_user_id) : null;
          if (seatUser && seatUser.seat_role === 'DRIVER_ASSOCIATE' && job.agreed_price_aed) {
            const { driver_associate_default_split_bps } = await getSettings();
            const splitBps = Number(driver_associate_default_split_bps) || 8000;
            const driverShare = Math.round(job.agreed_price_aed * (splitBps / 10000) * 100) / 100;
            await db.prepare(
              'INSERT INTO driver_wallet_entries (driver_id, job_id, carrier_id, gross_amount_aed, split_bps, driver_share_aed) VALUES (?,?,?,?,?,?)'
            ).run(driver.id, job.id, job.carrier_id, job.agreed_price_aed, splitBps, driverShare);
          }
        }
      } catch (e) { console.error(`[wallet] driver_wallet_entries insert failed for job ${id}:`, e); }
    }
  }

  if (nextStatus === 'IN_TRANSIT' && job.assigned_driver_phone) {
    // First real two-way WhatsApp bot flow: delivery confirmation via
    // interactive buttons once the driver is en route. Fire-and-forget,
    // same as every other WhatsApp send site — never blocks the response.
    try {
      const { sendDeliveryConfirmationPrompt } = require('../lib/whatsapp');
      sendDeliveryConfirmationPrompt({ to: job.assigned_driver_phone, jobCode: job.job_code });
    } catch {}
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
  // CRITICAL: default is fail-closed (0=1, matches nothing), not fail-open.
  // This used to be '1=1' — every role this if/else chain didn't explicitly
  // name (FORWARDER, and anything added later) fell through to it and got
  // EVERY job in the database back from `mine=true`, including every other
  // shipper's prices, routes, and deadlines. FORWARDER genuinely has no
  // job-ownership column yet (forwarder_clients is a contact roster with no
  // job FK) — "no jobs" is the truthful answer for that role today, not a
  // bug to work around with a broad query.
  let where = '0=1';
  const params = [];
  if (user.role === 'SHIPPER') {
    where = 'shipper_id = ?';
    params.push(user.id);
  } else if (user.role === 'CARRIER' || user.role === 'OWNER_OPERATOR') {
    // OWNER_OPERATOR satisfies CARRIER checks everywhere else (see
    // middleware/auth.js's roleSatisfies) — a single-truck operator is
    // still a carrier for job-visibility purposes.
    // Demo accounts only ever see demo jobs and real accounts only ever see
    // real jobs on the open-loads browse (not `mine`) — otherwise an
    // investor-demo job would show up as a real bidding opportunity for a
    // real carrier, or vice versa. See server/migrations/003_demo_data_flag.sql.
    where = mine ? 'carrier_id = ?' : "(status = 'OPEN' OR carrier_id = ?) AND is_demo = ?";
    params.push(user.id);
    if (!mine) params.push(user.is_demo ? 1 : 0);
  } else if (user.role === 'BROKER') {
    where = 'broker_id = ?';
    params.push(user.id);
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
      `SELECT bids.*, cp.rating_avg as carrier_rating, cp.company_name as carrier_company, cp.available_units as carrier_available_units, cp.reliability_score as carrier_reliability_score
       FROM bids LEFT JOIN profiles cp ON cp.user_id = bids.carrier_id
       WHERE job_id=? ORDER BY amount_aed ASC`
    )
    .all(job.id);

  // Ancillary charges (Salik/e-token/demurrage/inspection-waiting) are now
  // declared at bid time and reviewed by the shipper alongside each bid's
  // price — attach them here so the shipper sees a bidder's full expected
  // cost in one place, rather than needing a separate call per bid.
  if (bids.length) {
    const allCharges = await db
      .prepare(`SELECT * FROM bid_ancillary_charges WHERE bid_id IN (${bids.map(() => '?').join(',')}) ORDER BY created_at ASC`)
      .all(...bids.map((b) => b.id));
    const chargesByBid = new Map();
    for (const c of allCharges) {
      if (!chargesByBid.has(c.bid_id)) chargesByBid.set(c.bid_id, []);
      chargesByBid.get(c.bid_id).push(c);
    }
    bids = bids.map((b) => ({ ...b, ancillary_charges: chargesByBid.get(b.id) || [] }));
  }

  const isOwnerShipper = user.id === job.shipper_id;
  const isAdmin = user.role === 'ADMIN';
  if (!isOwnerShipper && !isAdmin) {
    // Driver identity/contact must never leak to a carrier who isn't the
    // bid's own owner, regardless of job status (see the fix shipped
    // separately for this — bringing the same logic in here since this
    // branch predates it and this function is being touched anyway).
    // Price, ancillary charges, capacity/reliability, and driver identity
    // are ALL masked from every other bidder while the job is still OPEN —
    // "no bidder should watch other bidders' price and everything, docs etc."
    // Once the job leaves OPEN, price/company stay visible as useful market
    // information (non-sensitive once bidding has closed), but driver
    // identity/contact stays masked forever for anyone but the shipper,
    // the actually-awarded carrier, or admin — previously a losing bidder
    // could see the winning bid's driver_name/driver_phone in full once a
    // job left OPEN, since isParticipantOrBidder() grants view access to
    // any carrier who ever placed a bid, win or lose.
    const isOpenPhase = job.status === 'OPEN';
    bids = bids.map((b) => {
      if (b.carrier_id === user.id) return b;
      const driverMasked = { ...b, driver_name: null, driver_phone: null, notes: null };
      return isOpenPhase
        ? { ...driverMasked, amount_aed: null, eta_at: null, eta_minutes: null, carrier_company: null, ancillary_charges: [], carrier_available_units: null, carrier_reliability_score: null, masked: true }
        : driverMasked;
    });
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
  // The real, currently-live version of the driver-identity leak: job.*
  // (a plain `SELECT *`, via jobRepository.findById) includes
  // assigned_driver_name/assigned_driver_phone directly, and canViewJob()
  // grants access to any carrier who ever placed a bid on this job, win or
  // lose (isParticipantOrBidder has no status/outcome check on the bid).
  // Only the shipper, the actually-awarded carrier, and admin should ever
  // see who the winning carrier's driver is — a losing bidder gets these
  // fields stripped, same as the bids[]-level masking above.
  const isAwardedCarrier = user.id === job.carrier_id;
  const driverIdentityVisible = isOwnerShipper || isAdmin || isAwardedCarrier;
  // Extra container-type line items beyond the job's own container_size/
  // type/count columns (which already represent line item 1) — empty for
  // every job posted before multi-line-item support existed.
  const extraLineItems = await db.prepare('SELECT id, container_size, container_type, count FROM job_line_items WHERE job_id=? ORDER BY id').all(job.id);
  // Multi-stop itinerary (Phase 8) — intermediate legs in seq order; the
  // job's own pickup/delivery stay the canonical first/last legs.
  const stops = await db.prepare(`SELECT * FROM job_stops WHERE job_id=? ORDER BY seq ASC`).all(job.id);
  const jobWithRating = {
    ...job,
    ...(driverIdentityVisible ? null : { assigned_driver_name: null, assigned_driver_phone: null }),
    shipper_rating: shipperProfile ? shipperProfile.rating_avg : null,
    driver_info: driverIdentityVisible ? driverInfo : null,
    extra_line_items: extraLineItems,
    stops,
  };
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

// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

/** @type {any} */
const db = require('../db');
/** @type {any} */
const { getSettings, writeAudit, notify } = require('../lib/helpers');

/**
 * @param {Job} _job - strict type reference (Money, Job, Payout must be imported)
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/**
 * @param {any} req
 * @param {any} res
 * @param {number} jobId
 * @param {number} bidId
 * @returns {Promise<void>}
 */
async function awardJob(req, res, jobId, bidId) {
  // Pre-checks outside transaction for fast 404/403 (still re-validated inside)
  const preJob = /** @type {Job | undefined} */ (await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId));
  if (!preJob) { res.status(404).json({ error: 'Job not found' }); return; }
  if (preJob.shipper_id !== req.user.id) { res.status(403).json({ error: 'Not your job' }); return; }
  const preBid = await db.prepare('SELECT * FROM bids WHERE id=? AND job_id=?').get(bidId, jobId);
  if (!preBid) { res.status(404).json({ error: 'Bid not found' }); return; }

  // Confirm-terms gate — a real pre-award negotiation/ancillary-charges
  // workflow now exists (bid_negotiations, bid_ancillary_charges,
  // POST /api/bids/:id/confirm-terms, all in server/routes/bids.routes.js).
  // A shipper can still skip it outright for a simple job with nothing to
  // discuss (skipNegotiation must be an explicit, visible choice on the
  // frontend, not a silent default) — this is purely an added precondition
  // before the existing transaction below; nothing inside that transaction
  // changes.
  const skipNegotiation = !!(req.body && req.body.skipNegotiation);
  if (!preBid.terms_confirmed_at && !skipNegotiation) {
    res.status(409).json({ error: 'Terms not yet confirmed for this bid — discuss and confirm terms first, or explicitly skip negotiation.' });
    return;
  }

  // Low-capacity gate — the carrier's declared available_units was
  // already shown to the shipper as a "0 unit(s) available" warning
  // (job-lifecycle.routes.js's lowCapacityWarning, surfaced on each bid
  // as carrier_available_units in job.service.js's getJob), but nothing
  // stopped the award itself from going through regardless. Same explicit-
  // acknowledgment pattern as skipNegotiation above, not a hard block —
  // an over-committed carrier can still genuinely have room for one more
  // job; the shipper just has to say so on purpose.
  const acknowledgeLowCapacity = !!(req.body && req.body.acknowledgeLowCapacity);
  const carrierProfile = await db.prepare('SELECT available_units FROM profiles WHERE user_id=?').get(preBid.carrier_id);
  if (carrierProfile && carrierProfile.available_units <= 0 && !acknowledgeLowCapacity) {
    res.status(409).json({ error: 'This carrier has declared 0 available units — acknowledge to award anyway.', lowCapacity: true });
    return;
  }

  // Final price = bid amount + any ancillary charges (Salik etc.) that
  // were actually AGREED BY BOTH SIDES — a charge proposed but never
  // mutually agreed (possible when the shipper used skipNegotiation)
  // doesn't count. Product decision: "if ancillary is added and agreed
  // that will be final, if not vice versa" — this is the one place that
  // decision applies, since every downstream money figure (escrow
  // liability, payout gross/net, invoice, cancellation fee base) is
  // derived from job.agreed_price_aed, which this value gets written
  // into below.
  const agreedCharges = await db.prepare(
    `SELECT COALESCE(SUM(amount_aed), 0) as total FROM bid_ancillary_charges WHERE bid_id=? AND agreed_by_shipper=1 AND agreed_by_carrier=1`
  ).get(bidId);
  const ancillaryTotal = Number(agreedCharges?.total) || 0;
  const { commission_rate_bps } = await getSettings();
  const commissionRate = commission_rate_bps / 10000;
  const agreedPrice = preBid.amount_aed + ancillaryTotal;
  const platformFee = Math.round(agreedPrice * commissionRate);
  const netAed = agreedPrice - platformFee;
  const idempotencyKey = `award-${jobId}-${bidId}`;

  // CONTRACT_CREDIT gate — fast pre-check outside the transaction (the
  // transaction below re-checks under a row lock, since this alone can't
  // stop two concurrent awards from a shipper both reading the same
  // pre-award balance). Never eligible without an admin-approved limit
  // (credit_approved_at) — a shipper picking this tier on the post-job
  // form doesn't self-grant credit, someone has to actually extend it.
  const isContractCredit = preJob.payment_tier === 'CONTRACT_CREDIT';
  if (isContractCredit) {
    const shipperProfile = await db.prepare('SELECT credit_limit_aed, credit_balance_aed, credit_approved_at FROM profiles WHERE user_id=?').get(preJob.shipper_id);
    if (!shipperProfile?.credit_approved_at) {
      res.status(402).json({ error: 'This account has no approved credit terms — contact Loadbyton to set up contract credit before posting jobs on this tier.' });
      return;
    }
    if ((shipperProfile.credit_balance_aed || 0) + agreedPrice > shipperProfile.credit_limit_aed) {
      const available = Math.max(0, shipperProfile.credit_limit_aed - (shipperProfile.credit_balance_aed || 0));
      res.status(402).json({ error: `This award (AED ${agreedPrice}) would exceed the approved credit limit — AED ${available} available.` });
      return;
    }
  }

  try {
    await db.transaction(async (/** @type {any} */ trx) => {
      // Row-level locks — prevents concurrent awards. FOR UPDATE is stripped on SQLite.
      const jobRow = await trx.query('SELECT * FROM jobs WHERE id=? FOR UPDATE', [jobId]);
      const job = /** @type {Job} */ (jobRow.rows[0]);
      if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
      if (job.status !== 'OPEN') {
        const err = /** @type {any} */ (new Error(job.status === 'AWARDED' ? 'Job already awarded' : 'Job is not open'));
        err.status = job.status === 'AWARDED' ? 409 : 403;
        throw err;
      }
      if (job.shipper_id !== req.user.id) {
        const err = /** @type {any} */ (new Error('Not your job')); err.status = 403; throw err;
      }

      const bidRow = await trx.query('SELECT * FROM bids WHERE id=? AND job_id=? FOR UPDATE', [bidId, jobId]);
      const bid = bidRow.rows[0];
      if (!bid) { const err = /** @type {any} */ (new Error('Bid not found')); err.status = 404; throw err; }
      if (bid.status !== 'PENDING') {
        const err = /** @type {any} */ (new Error('Bid is not pending')); err.status = 409; throw err;
      }

      // Idempotency: if payout already exists for this job, this is a replay
      const existingPayout = await trx.query('SELECT id FROM payouts WHERE job_id=?', [jobId]);
      if (existingPayout.rows[0]) {
        const err = /** @type {any} */ (new Error('Job already awarded')); err.status = 409; throw err;
      }

      // payment_tier branching — SPOT_ESCROW (the default, and every job
      // created before this column existed) keeps exactly today's
      // behavior: escrow HELD immediately, checkout required before
      // pickup. PAY_ON_DELIVERY/CONTRACT_CREDIT/OFF_PLATFORM defer
      // escrow entirely — for PAY_ON_DELIVERY, job.service.js's
      // updateJobStatus creates the actual checkout/ledger entry at the
      // DELIVERED transition instead; OFF_PLATFORM never touches per-job
      // escrow at all (payment happens directly between the two parties).
      // CONTRACT_CREDIT draws down the shipper's approved limit below
      // instead of escrowing anything per job.
      const isSpotEscrow = job.payment_tier === 'SPOT_ESCROW' || !job.payment_tier;
      await trx.query(
        isSpotEscrow
          ? `UPDATE jobs SET status='AWARDED', carrier_id=?, agreed_price_aed=?, escrow_status='HELD', processor_payment_status='REQUIRES_PAYMENT', updated_at=datetime('now') WHERE id=?`
          : `UPDATE jobs SET status='AWARDED', carrier_id=?, agreed_price_aed=?, updated_at=datetime('now') WHERE id=?`,
        [bid.carrier_id, agreedPrice, jobId]
      );

      // Re-check and draw down the credit limit under a row lock — the
      // pre-check above read a possibly-stale balance; this is the actual
      // safety boundary against two concurrent CONTRACT_CREDIT awards from
      // the same shipper both squeezing past the limit.
      if (isContractCredit) {
        const shipperRow = await trx.query('SELECT credit_limit_aed, credit_balance_aed, credit_terms_days, credit_approved_at FROM profiles WHERE user_id=? FOR UPDATE', [job.shipper_id]);
        const shipperProfile = shipperRow.rows[0];
        if (!shipperProfile?.credit_approved_at) {
          const err = /** @type {any} */ (new Error('No approved credit terms')); err.status = 402; throw err;
        }
        if ((shipperProfile.credit_balance_aed || 0) + agreedPrice > shipperProfile.credit_limit_aed) {
          const err = /** @type {any} */ (new Error('Award would exceed the approved credit limit')); err.status = 402; throw err;
        }
        await trx.query('UPDATE profiles SET credit_balance_aed = credit_balance_aed + ? WHERE user_id=?', [agreedPrice, job.shipper_id]);
        // Net terms clock starts at award, not delivery — matches how a
        // real invoice payment-terms period is usually framed ("net 30
        // from invoice/order date"), and means the due date is visible to
        // both sides from the moment the job is committed, not sprung on
        // them later at completion.
        const termsDays = Number(shipperProfile.credit_terms_days) || 30;
        const creditDueAt = new Date(Date.now() + termsDays * 24 * 3600 * 1000).toISOString();
        await trx.query('UPDATE jobs SET credit_due_at=? WHERE id=?', [creditDueAt, jobId]);
      }

      await trx.query(`UPDATE bids SET status='AWARDED' WHERE id=?`, [bidId]);
      await trx.query(`UPDATE bids SET status='REJECTED' WHERE job_id=? AND id != ?`, [jobId, bidId]);

      // Equipment capacity — decrement the carrier's live available_units
      // by this job's TOTAL unit count (line item 1 + job_line_items extras
      // via lib/capacity.js), same transaction/lock discipline as
      // everything else here. Not clamped below 0 deliberately: a
      // negative number is a real, visible signal (this carrier is now
      // over-committed), not something to silently hide by floor-ing it.
      const { jobUnitCount } = require('../lib/capacity');
      const unitCount = await jobUnitCount(preJob, { trx });
      await trx.query(`UPDATE profiles SET available_units = available_units - ? WHERE user_id=?`, [unitCount, bid.carrier_id]);
      await trx.query(
        `INSERT INTO carrier_capacity_events (carrier_id, job_id, event_type, units_delta, note) VALUES (?,?,?,?,?)`,
        [bid.carrier_id, jobId, 'AWARDED', -unitCount, `Awarded ${preJob.job_code}`]
      );

      // Payout — unique on job_id prevents duplicates under race
      try {
        await trx.query(
          `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, idempotency_key) VALUES (?,?,?,?,?, 'PENDING', ?)`,
          [jobId, bid.carrier_id, agreedPrice, platformFee, netAed, idempotencyKey]
        );
      } catch (/** @type {any} */ e) {
        if (/no such column|idempotency_key/i.test(/** @type {any} */ (e).message)) {
          await trx.query(
            `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'PENDING')`,
            [jobId, bid.carrier_id, agreedPrice, platformFee, netAed]
          );
        } else throw e;
      }

      // Double-entry ledger: escrow liability created (funds expected).
      // Deliberately NOT try/catch-swallowed — this DB's ledger_accounts/
      // ledger_entries tables are unconditionally created by both
      // schema.js and postgres_init.sql, so a failure here is a real
      // error, not a "table doesn't exist yet" case. Swallowing it left a
      // subtler bug: Postgres marks a transaction ABORTED after any failed
      // statement, and every later statement in it (including the audit
      // log insert below) would then also fail — except when a swallowed
      // error happened to be the LAST statement before commit, in which
      // case db.js's COMMIT on an aborted transaction silently becomes a
      // no-op ROLLBACK with no thrown error, undoing the whole award
      // (status, bid updates, payout row) while the caller believes it
      // succeeded. Letting it throw lets db.transaction's own catch
      // rollback and report a real error instead.
      // For PAY_ON_DELIVERY/CONTRACT_CREDIT/OFF_PLATFORM, no funds are
      // expected yet at award time — recording an escrow-liability entry
      // here would be booking a receivable that doesn't exist until
      // DELIVERED (PAY_ON_DELIVERY) or, for the other two tiers, ever
      // on-platform in this pass. job.service.js's updateJobStatus creates
      // the equivalent ledger entry for PAY_ON_DELIVERY at DELIVERED.
      if (isSpotEscrow) {
        const ledger = require('../lib/ledger');
        await ledger.createTransaction(trx, {
          idempotencyKey,
          jobId,
          description: ancillaryTotal > 0
            ? `Award ${preJob.job_code} AED ${agreedPrice} (bid AED ${preBid.amount_aed} + AED ${ancillaryTotal} agreed extras)`
            : `Award ${preJob.job_code} AED ${agreedPrice}`,
          entries: [
            { account: 'processor_clearing', side: 'DEBIT', amountMinor: ledger.toMinor(agreedPrice) },
            { account: 'escrow_liability', side: 'CREDIT', amountMinor: ledger.toMinor(agreedPrice) },
          ],
        });
      }

      // Audit atomically with the financial writes
      await trx.query(
        `INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state, request_id) VALUES (?,?,?,?,?,?,?,?)`,
        [req.actorId, 'AWARD', `${preJob.job_code}: awarded to bid #${bidId} (AED ${agreedPrice}${ancillaryTotal > 0 ? `, incl. AED ${ancillaryTotal} agreed extras` : ''})`, 'job', jobId, 'OPEN', 'AWARDED', req.requestId || null]
      );

      // Also not swallowed — same reasoning as the ledger insert above,
      // and this one is the LAST statement before commit, exactly the
      // case where a swallowed error would have silently discarded the
      // whole award with no exception anywhere.
      await trx.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status) VALUES (?,?,?,?,?)`,
        ['job', jobId, 'JOB_AWARDED', JSON.stringify({ jobId, bidId, carrierId: bid.carrier_id, amount: agreedPrice }), 'PENDING']
      );
    });
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    if (_e.status === 404 || _e.status === 403 || _e.status === 409 || _e.status === 402) {
      return res.status(_e.status).json({ error: _e.message });
    }
    // UNIQUE violation on payouts.job_id -> concurrent award
    if (_e.message && /UNIQUE.*payouts|duplicate key/i.test(_e.message)) {
      return res.status(409).json({ error: 'Job already awarded' });
    }
    throw _e;
  }

  // Notifications after commit — never inside the financial transaction
  // (outbox worker will also deliver). "Escrow HELD" was previously
  // unconditional here regardless of payment_tier — actively wrong for
  // PAY_ON_DELIVERY/CONTRACT_CREDIT/OFF_PLATFORM, none of which hold any
  // escrow at all (see the isSpotEscrow branch inside the transaction
  // above), and especially misleading for a shipper who just picked
  // CONTRACT_CREDIT specifically because they didn't want funds held.
  const shipperAwardMessage = preJob.payment_tier === 'CONTRACT_CREDIT'
    ? `${preJob.job_code} was awarded to a carrier. AED ${agreedPrice} drawn against your contract credit — due per your net terms.`
    : preJob.payment_tier === 'PAY_ON_DELIVERY'
      ? `${preJob.job_code} was awarded to a carrier. AED ${agreedPrice} will be charged once delivery is confirmed.`
      : preJob.payment_tier === 'OFF_PLATFORM'
        ? `${preJob.job_code} was awarded to a carrier. AED ${agreedPrice} agreed — settle payment directly with the carrier.`
        : `${preJob.job_code} was awarded to a carrier. Escrow HELD: AED ${agreedPrice}.`;
  try {
    await (/** @type {any} */ (notify))(preBid.carrier_id, 'Bid awarded', `Your bid on ${preJob.job_code} was awarded. Agreed price: AED ${agreedPrice}.`, jobId, 'award');
    await (/** @type {any} */ (notify))(preJob.shipper_id, 'Job awarded', shipperAwardMessage, jobId, 'award');
  } catch {}

  const updated = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  res.json({ job: updated });
}

module.exports = { awardJob };

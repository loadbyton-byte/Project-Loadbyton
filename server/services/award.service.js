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

  const { commission_rate_bps } = await getSettings();
  const commissionRate = commission_rate_bps / 10000;
  const agreedPrice = preBid.amount_aed;
  const platformFee = Math.round(agreedPrice * commissionRate);
  const netAed = agreedPrice - platformFee;
  const idempotencyKey = `award-${jobId}-${bidId}`;

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

      await trx.query(
        `UPDATE jobs SET status='AWARDED', carrier_id=?, agreed_price_aed=?, escrow_status='HELD', processor_payment_status='REQUIRES_PAYMENT', updated_at=datetime('now') WHERE id=?`,
        [bid.carrier_id, agreedPrice, jobId]
      );

      await trx.query(`UPDATE bids SET status='AWARDED' WHERE id=?`, [bidId]);
      await trx.query(`UPDATE bids SET status='REJECTED' WHERE job_id=? AND id != ?`, [jobId, bidId]);

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
      const ledger = require('../lib/ledger');
      await ledger.createTransaction(trx, {
        idempotencyKey,
        jobId,
        description: `Award ${preJob.job_code} AED ${agreedPrice}`,
        entries: [
          { account: 'processor_clearing', side: 'DEBIT', amountMinor: ledger.toMinor(agreedPrice) },
          { account: 'escrow_liability', side: 'CREDIT', amountMinor: ledger.toMinor(agreedPrice) },
        ],
      });

      // Audit atomically with the financial writes
      await trx.query(
        `INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state, request_id) VALUES (?,?,?,?,?,?,?,?)`,
        [req.actorId, 'AWARD', `${preJob.job_code}: awarded to bid #${bidId} (AED ${agreedPrice})`, 'job', jobId, 'OPEN', 'AWARDED', req.requestId || null]
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
    if (_e.status === 404 || _e.status === 403 || _e.status === 409) {
      return res.status(_e.status).json({ error: _e.message });
    }
    // UNIQUE violation on payouts.job_id -> concurrent award
    if (_e.message && /UNIQUE.*payouts|duplicate key/i.test(_e.message)) {
      return res.status(409).json({ error: 'Job already awarded' });
    }
    throw _e;
  }

  // Notifications after commit — never inside the financial transaction (outbox worker will also deliver)
  try {
    await (/** @type {any} */ (notify))(preBid.carrier_id, 'Bid awarded', `Your bid on ${preJob.job_code} was awarded. Agreed price: AED ${agreedPrice}.`, jobId, 'award');
    await (/** @type {any} */ (notify))(preJob.shipper_id, 'Job awarded', `${preJob.job_code} was awarded to a carrier. Escrow HELD: AED ${agreedPrice}.`, jobId, 'award');
  } catch {}

  const updated = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  res.json({ job: updated });
}

module.exports = { awardJob };

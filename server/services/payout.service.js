// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

/** @type {any} */
const db = require('../db');
/** @type {any} */
const payments = require('../lib/payments');
/** @type {any} */
const { writeAudit, notify } = require('../lib/helpers');

/**
 * @param {Job} _job
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/**
 * @param {number} jobId
 * @param {string} error
 * @returns {Promise<void>}
 */
async function markJobPaymentFailed(jobId, error) {
  await db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(error, jobId);
  await (/** @type {any} */ (writeAudit))(null, {
    action: 'PAYMENT_FAILED',
    details: `Job #${jobId} payment failed: ${error}`,
    entityType: 'job',
    entityId: jobId,
  });
}

/**
 * @param {Job} job
 * @param {Payout & { transfer_executed_at?: string | null }} payout
 * @param {any} req
 * @returns {Promise<void>}
 */
async function executePayoutAsync(job, payout, req) {
  if (!payout) return;
  if (!payments.isConfigured()) {
    await (/** @type {any} */ (writeAudit))(req, {
      action: 'PAYOUT_DEFERRED',
      details: `${job.job_code}: payout deferred (no payment provider configured)`,
      entityType: 'payout',
      entityId: payout.id,
    });
    return;
  }

  const provider = payments.provider();
  const idempotencyKey = `payout-${payout.id}-${provider}`;
  const destinationHint = payout.carrier_id ? String(payout.carrier_id) : 'unknown';

  // Idempotency: if already has a successful attempt or transfer_executed_at, don't double-transfer
  try {
    const existing = await db.prepare('SELECT * FROM payout_attempts WHERE idempotency_key=?').get(idempotencyKey);
    if (existing && ['SUBMITTED', 'SENT', 'SETTLED'].includes(existing.status)) return;
    if (/** @type {any} */ (payout).transfer_executed_at) return;
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    if (_e.message && !/no such table/i.test(_e.message)) throw _e;
  }

  let attemptNumber = 1;
  try {
    const cnt = await db.prepare('SELECT COUNT(*) as c FROM payout_attempts WHERE payout_id=?').get(payout.id);
    attemptNumber = (/** @type {any} */ (cnt)?.c || 0) + 1;
  } catch {}

  try {
    let carrierAccountId = null;
    try {
      const prof = job.carrier_id ? await db.prepare('SELECT processor_account_id FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
      carrierAccountId = /** @type {any} */ (prof)?.processor_account_id || null;
    } catch {}
    const r = await payments.executePayout({
      amountAed: payout.net_aed,
      jobCode: job.job_code,
      paymentRef: `payout-${payout.id}`,
      reference: `payout-${payout.id}`,
      carrierAccountId,
    });

    const attemptStatus = r.ok ? 'SUBMITTED' : 'FAILED';
    try {
      await db.prepare(
        `INSERT INTO payout_attempts (payout_id, attempt_number, provider, amount_aed, destination, idempotency_key, status, provider_response, error) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(payout.id, attemptNumber, provider, payout.net_aed, carrierAccountId || destinationHint, idempotencyKey, attemptStatus, /** @type {any} */ (r).payoutRef || null, /** @type {any} */ (r).error || null);
    } catch (/** @type {any} */ e) {
      const _e = /** @type {any} */ (e);
      if (_e.message && !/no such table|UNIQUE/i.test(_e.message)) throw _e;
      // UNIQUE on idempotency_key means concurrent attempt raced — the other succeeded, treat as idempotent
      if (_e.message && /UNIQUE/i.test(_e.message)) return;
    }

    if (r.ok) {
      // Successful transfer — keep payout status as RELEASED (set by job-lifecycle before calling), just record transfer
      // Add ledger entries for escrow release (idempotent on idempotencyKey)
      try {
        await db.transaction(async (/** @type {any} */ trx) => {
          // Update transfer fields if not already set (preserve RELEASED status)
          await trx.query(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=? AND transfer_executed_at IS NULL`, [`processor:${/** @type {any} */ (r).payoutRef}`, payout.id]);
          try {
            const ledger = require('../lib/ledger');
            const grossMinor = ledger.toMinor(payout.gross_aed);
            const feeMinor = ledger.toMinor(payout.platform_fee_aed);
            const netMinor = ledger.toMinor(payout.net_aed);
            await ledger.createTransaction(trx, {
              idempotencyKey,
              jobId: job.id,
              payoutId: payout.id,
              description: `Payout ${job.job_code} AED ${payout.net_aed}`,
              entries: [
                { account: 'escrow_liability', side: 'DEBIT', amountMinor: grossMinor },
                { account: 'carrier_payable', side: 'CREDIT', amountMinor: netMinor },
                { account: 'platform_revenue', side: 'CREDIT', amountMinor: feeMinor },
              ],
            });
          } catch (/** @type {any} */ e) {
            console.warn('[payout] ledger insert skipped:', /** @type {any} */ (e).message);
          }
          try {
            await trx.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status) VALUES (?,?,?,?,?)`, ['payout', payout.id, 'PAYOUT_SETTLED', JSON.stringify({ payoutId: payout.id, jobId: job.id, amount: payout.net_aed }), 'PENDING']);
          } catch (/** @type {any} */ e) {
            console.warn('[payout] outbox insert skipped:', /** @type {any} */ (e).message);
          }
        });
      } catch (/** @type {any} */ e) {
        // Fallback: at least mark transfer
        try { await db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=? AND transfer_executed_at IS NULL`).run(`processor:${/** @type {any} */ (r).payoutRef}`, payout.id); } catch {}
      }
      await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_EXECUTED', details: `${job.job_code}: payout AED ${payout.net_aed} executed (ref ${/** @type {any} */ (r).payoutRef})`, entityType: 'payout', entityId: payout.id });
    } else {
      // Failure: keep status RELEASED but record error for SLA retry
      try { await db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(/** @type {any} */ (r).error || 'transfer failed', payout.id); } catch {}
      await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_FAILED', details: `${job.job_code}: payout failed — ${/** @type {any} */ (r).error}`, entityType: 'payout', entityId: payout.id });
    }
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    try { await db.prepare(`UPDATE payouts SET status='FAILED', last_error=? WHERE id=?`).run(_e.message, payout.id); } catch {}
    try {
      await db.prepare(`INSERT INTO payout_attempts (payout_id, attempt_number, provider, amount_aed, destination, idempotency_key, status, error) VALUES (?,?,?,?,?,?,?,?)`).run(payout.id, attemptNumber, provider, payout.net_aed, destinationHint, `${idempotencyKey}-err-${Date.now()}`, 'FAILED', _e.message);
    } catch {}
  }
}

/**
 * @param {Job} job
 * @returns {Promise<void>}
 */
async function refundJobAsync(job) {
  if (!payments.isConfigured()) return;
  try {
    const r = await payments.refundCharge({
      jobCode: job.job_code,
      amountAed: /** @type {any} */ (job).agreed_price_aed,
      tranref: /** @type {any} */ (job).processor_tranref,
      paymentRef: /** @type {any} */ (job).processor_payment_ref,
    });
    if (r.ok) {
      await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id);
      await (/** @type {any} */ (writeAudit))(null, {
        action: 'REFUND_SHIPPER_EXECUTED',
        details: `${job.job_code}: refunded AED ${/** @type {any} */ (job).agreed_price_aed}`,
        entityType: 'job',
        entityId: job.id,
      });
    }
  } catch (/** @type {any} */ e) {}
}

module.exports = { markJobPaymentFailed, executePayoutAsync, refundJobAsync };

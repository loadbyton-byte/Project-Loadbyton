const db = require('../db');
const payments = require('../lib/payments');
const { writeAudit, notify } = require('../lib/helpers');

async function markJobPaymentFailed(jobId, error) {
  await db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(error, jobId);
  await writeAudit(null, {
    action: 'PAYMENT_FAILED',
    details: `Job #${jobId} payment failed: ${error}`,
    entityType: 'job',
    entityId: jobId,
  });
}

async function executePayoutAsync(job, payout, req) {
  if (!payout) return;
  if (!payments.isConfigured()) {
    await writeAudit(req, {
      action: 'PAYOUT_DEFERRED',
      details: `${job.job_code}: payout deferred (no payment provider configured)`,
      entityType: 'payout',
      entityId: payout.id,
    });
    return;
  }

  try {
    // Stripe Connect transfers need the carrier's connected account id.
    // Look it up so payments.executePayout can route the transfer to the
    // right destination. For other providers this field is ignored.
    let carrierAccountId = null;
    try {
      const prof = job.carrier_id ? await db.prepare('SELECT processor_account_id FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
      carrierAccountId = prof?.processor_account_id || null;
    } catch {}
    const r = await payments.executePayout({
      amountAed: payout.net_aed,
      jobCode: job.job_code,
      paymentRef: `payout-${payout.id}`,
      reference: `payout-${payout.id}`,
      carrierAccountId,
    });
    if (r.ok) {
      await db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=?`).run(`processor:${r.payoutRef || null}`, payout.id);
      await writeAudit(req, {
        action: 'PAYOUT_EXECUTED',
        details: `${job.job_code}: payout AED ${payout.net_aed} executed (ref ${r.ref || 'n/a'})`,
        entityType: 'payout',
        entityId: payout.id,
      });
    } else {
      await db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(r.error || 'transfer failed', payout.id);
      await writeAudit(req, {
        action: 'PAYOUT_FAILED',
        details: `${job.job_code}: payout failed — ${r.error}`,
        entityType: 'payout',
        entityId: payout.id,
      });
    }
  } catch (e) {
    await db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(e.message, payout.id);
  }
}

async function refundJobAsync(job) {
  if (!payments.isConfigured()) return;
  try {
    const r = await payments.refundCharge({
      jobCode: job.job_code,
      amountAed: job.agreed_price_aed,
      tranref: job.processor_tranref,
      paymentRef: job.processor_payment_ref,
    });
    if (r.ok) {
      await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id);
      await writeAudit(null, {
        action: 'REFUND_SHIPPER_EXECUTED',
        details: `${job.job_code}: refunded AED ${job.agreed_price_aed}`,
        entityType: 'job',
        entityId: job.id,
      });
    }
  } catch (e) {}
}

module.exports = { markJobPaymentFailed, executePayoutAsync, refundJobAsync };

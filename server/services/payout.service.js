const db = require('../db');
const payments = require('../lib/payments');
const { writeAudit, notify } = require('../lib/helpers');

function markJobPaymentFailed(jobId, error) {
  db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(error, jobId);
  writeAudit(null, {
    action: 'PAYMENT_FAILED',
    details: `Job #${jobId} payment failed: ${error}`,
    entityType: 'job',
    entityId: jobId,
  });
}

function executePayoutAsync(job, payout, req) {
  if (!payout) return;
  if (!payments.isConfigured()) {
    writeAudit(req, {
      action: 'PAYOUT_DEFERRED',
      details: `${job.job_code}: payout deferred (no payment provider configured)`,
      entityType: 'payout',
      entityId: payout.id,
    });
    return;
  }

  payments.executePayout({
    amountAed: payout.net_aed,
    jobCode: job.job_code,
    paymentRef: `payout-${payout.id}`,
    reference: `payout-${payout.id}`,
  }).then((r) => {
    if (r.ok) {
      db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=?`).run(`processor:${r.payoutRef || null}`, payout.id);
      writeAudit(req, {
        action: 'PAYOUT_EXECUTED',
        details: `${job.job_code}: payout AED ${payout.net_aed} executed (ref ${r.ref || 'n/a'})`,
        entityType: 'payout',
        entityId: payout.id,
      });
    } else {
      db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(r.error || 'transfer failed', payout.id);
      writeAudit(req, {
        action: 'PAYOUT_FAILED',
        details: `${job.job_code}: payout failed — ${r.error}`,
        entityType: 'payout',
        entityId: payout.id,
      });
    }
  }).catch((e) => {
    db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(e.message, payout.id);
  });
}

function refundJobAsync(job) {
  if (!payments.isConfigured()) return;
  payments.refundCharge({
    jobCode: job.job_code,
    amountAed: job.agreed_price_aed,
    tranref: job.processor_tranref,
    paymentRef: job.processor_payment_ref,
  }).then((r) => {
    if (r.ok) {
      db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id);
      writeAudit(null, {
        action: 'REFUND_SHIPPER_EXECUTED',
        details: `${job.job_code}: refunded AED ${job.agreed_price_aed}`,
        entityType: 'job',
        entityId: job.id,
      });
    }
  }).catch(() => {});
}

module.exports = { markJobPaymentFailed, executePayoutAsync, refundJobAsync };

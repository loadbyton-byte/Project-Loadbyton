const db = require('../db');
const payments = require('../lib/payments');
const { writeAudit } = require('../lib/helpers');

function markJobPaymentFailed(jobId, error) {
  db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(String(error).slice(0, 500), jobId);
}

// Fire-and-forget payout execution — called AFTER the DB release commits,
// never inside a transaction (network calls don't belong in DB locks).
// Idempotent via payouts.transfer_executed_at: a payout released but not
// yet confirmed (including any processor failure) keeps appearing in
// /api/admin/payouts-sla, exactly like the manual flow it replaces.
function executePayoutAsync(job, payout, req) {
  if (!payments.isConfigured() || !payout || payout.transfer_executed_at) return;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(payout.carrier_id);
  const reference = `LB-${job.job_code}-${payout.id}`;
  payments
    .executePayout({
      paymentRef: job.processor_payment_ref,
      jobCode: job.job_code,
      amountAed: payout.net_aed,
      carrierAccountId: profile ? profile.processor_account_id : null,
      carrierIban: profile ? profile.iban : null,
      reference,
    })
    .then((r) => {
      if (r.ok) {
        db.prepare(`UPDATE payouts SET processor_payout_status='SENT', processor_payout_ref=?, transfer_executed_at=datetime('now'), transfer_reference=? WHERE id=? AND transfer_executed_at IS NULL`).run(
          r.payoutRef,
          `processor:${reference}`,
          payout.id
        );
        writeAudit(req, {
          action: 'PAYOUT_PROCESSOR',
          details: `${job.job_code}: payout #${payout.id} (AED ${payout.net_aed}) sent via ${payments.provider()} (ref ${r.payoutRef})`,
          entityType: 'payout',
          entityId: payout.id,
          beforeState: 'RELEASED',
          afterState: 'SENT',
        });
      } else if (r.error !== 'not_implemented') {
        db.prepare(`UPDATE payouts SET processor_payout_status='FAILED', processor_payout_ref=? WHERE id=?`).run(String(r.error).slice(0, 200), payout.id);
        writeAudit(req, {
          action: 'PAYOUT_PROCESSOR_FAILED',
          details: `${job.job_code}: processor payout failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`,
          entityType: 'payout',
          entityId: payout.id,
          beforeState: 'RELEASED',
          afterState: 'FAILED',
        });
      }
      // r.error === 'not_implemented' (telr payouts pending VERIFY): leave
      // the payout RELEASED + untransferred — the admin SLA flow handles it.
    })
    .catch((e) => {
      db.prepare(`UPDATE payouts SET processor_payout_status='FAILED' WHERE id=?`).run(payout.id);
      writeAudit(req, {
        action: 'PAYOUT_PROCESSOR_FAILED',
        details: `${job.job_code}: processor payout threw: ${e.message}`,
        entityType: 'payout',
        entityId: payout.id,
        beforeState: 'RELEASED',
        afterState: 'FAILED',
      });
    });
}

// Fire-and-forget refund of a PAID charge (dispute REFUND_SHIPPER, or a
// cancellation after funds were taken). Only meaningful when the processor
// is configured AND the charge actually went through (tranref exists) —
// otherwise there is nothing to refund.
function refundJobAsync(job) {
  if (!payments.isConfigured() || job.processor_payment_status !== 'PAID' || !job.processor_tranref) return;
  const amountAed = job.processor_amount_aed ?? job.agreed_price_aed;
  payments
    .refundCharge({ tranref: job.processor_tranref, amountAed, paymentRef: job.processor_payment_ref })
    .then((r) => {
      if (r.ok) {
        db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', processor_last_error=NULL, updated_at=datetime('now') WHERE id=?`).run(job.id);
        writeAudit(null, {
          action: 'REFUND_SHIPPER_EXECUTED',
          details: `${job.job_code}: refund of AED ${amountAed} executed via ${payments.provider()} (${r.refundRef})`,
          entityType: 'job',
          entityId: job.id,
        });
      } else {
        db.prepare(`UPDATE jobs SET processor_last_error=? WHERE id=?`).run(`refund_failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`.slice(0, 500), job.id);
        writeAudit(null, {
          action: 'REFUND_SHIPPER_FAILED',
          details: `${job.job_code}: refund failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`,
          entityType: 'job',
          entityId: job.id,
        });
      }
    })
    .catch((e) => {
      db.prepare(`UPDATE jobs SET processor_last_error=? WHERE id=?`).run(`refund_failed: ${e.message}`.slice(0, 500), job.id);
      writeAudit(null, {
        action: 'REFUND_SHIPPER_FAILED',
        details: `${job.job_code}: refund threw: ${e.message}`,
        entityType: 'job',
        entityId: job.id,
      });
    });
}

module.exports = { markJobPaymentFailed, executePayoutAsync, refundJobAsync };

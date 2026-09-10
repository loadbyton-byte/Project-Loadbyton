// Shared execution cores for the two admin actions that can run either
// directly (single admin) or via the two-person action-approvals flow
// (server/routes/admin-approvals.routes.js), gated by the
// require_two_person_dispute_approval setting. Extracted here — rather than
// left inline in admin.routes.js — specifically so admin-approvals.routes.js
// can call the exact same logic a confirmed approval executes, instead of
// admin.routes.js and admin-approvals.routes.js importing from each other.
const db = require('../db');
const { issueInvoice } = require('./invoice');
const { writeAudit, getSettings, notify } = require('./helpers');
const { refundJobAsync, executePayoutAsync } = require('../services/payout.service');

// dispute + job are the already-loaded rows; decision/determination/split
// percentages are the already-validated request body fields (SPLIT's
// percentage sum-to-100 check happens before this is called, same as
// before extraction). resolvedByUserId is the ADMIN WHO ACTUALLY EXECUTES
// this — the sole admin on the direct path, or the CONFIRMING (second)
// admin on the approval path, never the original requester.
async function resolveDisputeCore(req, { dispute, job, determination, decision, splitShipperPct, splitCarrierPct, resolvedByUserId }) {
  let carrierPortionGross = null;
  let carrierPlatformFee = null;
  let carrierNetAed = null;
  let shipperRefundAed = null;
  if (decision === 'SPLIT') {
    const shipperPct = Number(splitShipperPct);
    const carrierPct = Number(splitCarrierPct);
    const { commission_rate_bps } = await getSettings();
    carrierPortionGross = Math.round((job.agreed_price_aed || 0) * carrierPct / 100 * 100) / 100;
    carrierPlatformFee = Math.round(carrierPortionGross * (commission_rate_bps / 10000));
    carrierNetAed = carrierPortionGross - carrierPlatformFee;
    shipperRefundAed = Math.round(((job.agreed_price_aed || 0) - carrierPortionGross) * 100) / 100;
    void shipperPct; // sum-to-100 already validated by the caller
  }

  // All three writes (payouts, jobs, disputes) happen atomically — a crash
  // between them used to leave the dispute row still OPEN despite the
  // payout already having been marked CANCELLED/RELEASED, so a retry could
  // re-pass the "already resolved" guard and fire a second real
  // refund/payout. The fire-and-forget processor calls run only after this
  // transaction has actually committed, so a crash before commit means
  // nothing was dispatched at all.
  await db.transaction(async (trx) => {
    if (decision === 'REFUND_SHIPPER') {
      await trx.query(`UPDATE payouts SET status='CANCELLED' WHERE job_id=?`, [job.id]);
    } else if (decision === 'SPLIT') {
      await trx.query(
        `UPDATE payouts SET gross_aed=?, platform_fee_aed=?, net_aed=?, status='RELEASED', release_type='DISPUTE_RESOLUTION', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`,
        [carrierPortionGross, carrierPlatformFee, carrierNetAed, job.id]
      );
    } else {
      await trx.query(`UPDATE payouts SET status='RELEASED', release_type='DISPUTE_RESOLUTION', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`, [job.id]);
    }
    await trx.query(
      `UPDATE jobs SET status='COMPLETED', escrow_status='RELEASED', processor_payment_status=CASE WHEN ?='REFUND_SHIPPER' THEN 'REFUNDED' ELSE processor_payment_status END, payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [decision, job.id]
    );
    await trx.query(
      `UPDATE disputes SET status='RESOLVED', determination=?, decision=?, resolved_by=?, resolved_at=datetime('now'), split_shipper_pct=?, split_carrier_pct=? WHERE id=?`,
      [determination || null, decision, resolvedByUserId, decision === 'SPLIT' ? Number(splitShipperPct) : null, decision === 'SPLIT' ? Number(splitCarrierPct) : null, dispute.id]
    );
  });

  if (decision === 'REFUND_SHIPPER') {
    // TODO-3: give the money back via the processor when it was taken.
    // No-op in internal mode / when the charge never went through.
    refundJobAsync(job);
  } else if (decision === 'SPLIT') {
    try { await issueInvoice(db, job.id); } catch (e) { console.error(`[invoice] issueInvoice failed for job ${job.id}:`, e); }
    if (shipperRefundAed > 0) refundJobAsync(job, shipperRefundAed);
    executePayoutAsync(job, await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
  } else {
    try { await issueInvoice(db, job.id); } catch (e) { console.error(`[invoice] issueInvoice failed for job ${job.id}:`, e); }
    // TODO-3: with a processor configured this moves the money; in
    // internal mode it is a no-op and the admin SLA flow applies.
    executePayoutAsync(job, await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
  }
  // Carrier reliability: a REFUND_SHIPPER (or the carrier's portion of a
  // SPLIT) resolution implies the carrier didn't deliver as promised.
  if ((decision === 'REFUND_SHIPPER' || decision === 'SPLIT') && job.carrier_id) {
    await db.prepare(`UPDATE profiles SET reliability_score = MAX(0, reliability_score - 1) WHERE user_id=?`).run(job.carrier_id);
  }
  await writeAudit(req, { userId: resolvedByUserId, action: 'DISPUTE_RESOLVE', details: `${decision}: ${determination || ''}${decision === 'SPLIT' ? ` (${splitShipperPct}/${splitCarrierPct})` : ''}`, entityType: 'dispute', entityId: dispute.id, beforeState: 'OPEN', afterState: 'RESOLVED' });
  await notify(job.shipper_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
  await notify(job.carrier_id, 'Dispute resolved', `${job.job_code}: ${decision.replaceAll('_', ' ')}.`, job.id, 'dispute');
}

async function markTransferredCore(req, { payout, reference, confirmedByUserId }) {
  await db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), transfer_reference=? WHERE id=?`).run(reference || null, payout.id);
  await writeAudit(req, {
    userId: confirmedByUserId,
    action: 'PAYOUT_TRANSFER_CONFIRMED',
    details: `Payout #${payout.id} (AED ${payout.net_aed}) confirmed transferred${reference ? ` — ref ${reference}` : ''}`,
    entityType: 'payout',
    entityId: payout.id,
    beforeState: 'PENDING_TRANSFER',
    afterState: 'TRANSFERRED',
  });
}

module.exports = { resolveDisputeCore, markTransferredCore };

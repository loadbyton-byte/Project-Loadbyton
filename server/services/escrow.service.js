const db = require('../db');
const { getSettings, writeAudit, notify, notifyAdmins } = require('../lib/helpers');
const { issueInvoice } = require('../lib/invoice');
const { executePayoutAsync } = require('./payout.service');

async function runAutoReleaseSweep(req) {
  const { auto_release_hours } = await getSettings();
  const cutoff = new Date(Date.now() - auto_release_hours * 3600 * 1000).toISOString();
  const jobs = await db.prepare(
    `SELECT * FROM jobs WHERE escrow_status IN ('HELD','FUNDED') AND status='DELIVERED' AND delivered_at IS NOT NULL AND delivered_at < ?`
  ).all(cutoff);

  let released = 0;
  for (const job of jobs) {
    // Atomic claim: this UPDATE's WHERE clause repeats the exact
    // escrow_status/status condition the SELECT above used, so if a
    // second server instance's own timer (this sweep runs on
    // setInterval, once per process — see server/routes/system.routes.js)
    // already claimed this same job between the SELECT and here, this
    // UPDATE matches zero rows and .changes is 0. Only the instance that
    // actually flips the row proceeds to the payout update and side
    // effects below — otherwise every instance would run them for the
    // same job.
    // Also flips status to COMPLETED here — this is the shipper's own
    // DELIVERED -> COMPLETED transition (see TRANSITIONS.SHIPPER in
    // lib/constants.js), just system-triggered instead of a manual
    // "confirm delivery" click. Previously this only flipped
    // escrow_status, so an auto-released job (the common case: shippers
    // have no reason to click confirm once payout is guaranteed either
    // way) stayed stuck showing DELIVERED forever with no invoice ever
    // issued and, in a real-processor deployment, no actual transfer
    // executed — see the invoice/payout calls below.
    const claim = await db.prepare(
      `UPDATE jobs SET status='COMPLETED', escrow_status='RELEASED', payout_released_at=datetime('now'), updated_at=datetime('now')
       WHERE id=? AND escrow_status IN ('HELD','FUNDED') AND status='DELIVERED'`
    ).run(job.id);
    if (!claim.changes) continue;
    await db.prepare(`UPDATE payouts SET status='RELEASED', release_type='AUTO', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=? AND status != 'RELEASED'`).run(job.id);
    await writeAudit(req, {
      action: 'ESCROW_AUTO_RELEASE',
      details: `${job.job_code} auto-released after ${auto_release_hours}h`,
      entityType: 'job',
      entityId: job.id,
      beforeState: job.escrow_status,
      afterState: 'RELEASED',
    });
    await notify(job.carrier_id, 'Escrow auto-released', `${job.job_code} escrow was auto-released after ${auto_release_hours}h.`, job.id, 'payout');
    await notify(job.shipper_id, 'Escrow auto-released', `${job.job_code} escrow was auto-released after ${auto_release_hours}h.`, job.id, 'status');

    // Same completion side effects the manual "confirm delivery" path
    // runs (job.service.js updateJobStatus, nextStatus==='COMPLETED') —
    // best-effort, matching its error handling exactly, so a failure here
    // never blocks the sweep from claiming/releasing the rest of the batch.
    try {
      await issueInvoice(db, job.id);
    } catch (e) {
      console.error(`[invoice] issueInvoice failed for auto-released job ${job.id}:`, e);
      try { await notifyAdmins('Invoice issuance failed', `Job ${job.job_code} (id ${job.id}) auto-released, but its invoice failed to issue: ${e.message}`, job.id, 'system'); } catch {}
    }
    try {
      const payout = await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id);
      await executePayoutAsync(job, payout, req);
    } catch {}
    released++;
  }
  return released;
}

module.exports = { runAutoReleaseSweep };

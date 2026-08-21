const db = require('../db');
const { issueInvoice } = require('../lib/invoice');
const { getSettings, writeAudit, notify } = require('../lib/helpers');
const { executePayoutAsync } = require('./payout.service');

function runAutoReleaseSweep(req) {
  const { auto_release_hours } = getSettings();
  const due = db
    .prepare(
      `SELECT * FROM jobs
       WHERE status='DELIVERED' AND auto_release_processed=0 AND delivered_at IS NOT NULL
         AND datetime(delivered_at, '+' || ? || ' hours') <= datetime('now')`
    )
    .all(auto_release_hours);

  let released = 0;
  for (const job of due) {
    if (job.escrow_status === 'DISPUTED') continue; // frozen, skip
    try {
      db.exec('BEGIN');
      db.prepare(
        `UPDATE jobs SET escrow_status='RELEASED', auto_release_processed=1, payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
      ).run(job.id);
      db.prepare(`UPDATE payouts SET status='RELEASED', release_type='AUTO_24H', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`).run(job.id);
      issueInvoice(db, job.id);
      writeAudit(req, {
        action: 'ESCROW_RELEASE',
        details: `Auto-released ${job.job_code} after ${auto_release_hours}h (silent assent).`,
        entityType: 'job',
        entityId: job.id,
        beforeState: 'HELD',
        afterState: 'RELEASED',
      });
      notify(job.shipper_id, 'Payout auto-released', `${job.job_code} funds were released ${auto_release_hours}h after delivery.`, job.id, 'payout');
      notify(job.carrier_id, 'Funds on the way', `Your payout for ${job.job_code} was auto-released.`, job.id, 'payout');
      db.exec('COMMIT');
      // TODO-3: with a processor configured this moves the money; in
      // internal mode it is a no-op and the admin SLA flow applies.
      executePayoutAsync(job, db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
      released++;
    } catch (e) {
      db.exec('ROLLBACK');
      // gstack review F6: this used to swallow the error entirely — a
      // failing issueInvoice() (or anything else in the transaction) meant
      // the job silently never released, with nothing to grep for. Money
      // moving on a schedule needs a visible failure, not a quiet retry.
      // eslint-disable-next-line no-console
      console.error(`[auto-release] job #${job.id} (${job.job_code}) failed, rolled back:`, e.message);
      writeAudit(req, {
        action: 'ESCROW_RELEASE_FAILED',
        details: `Auto-release failed for ${job.job_code}: ${e.message}`,
        entityType: 'job',
        entityId: job.id,
        beforeState: 'HELD',
        afterState: 'HELD',
      });
    }
  }
  return released;
}

module.exports = { runAutoReleaseSweep };

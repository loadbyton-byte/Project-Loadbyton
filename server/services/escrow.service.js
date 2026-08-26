const db = require('../db');
const { getSettings, writeAudit, notify } = require('../lib/helpers');

async function runAutoReleaseSweep(req) {
  const { auto_release_hours } = await getSettings();
  const cutoff = new Date(Date.now() - auto_release_hours * 3600 * 1000).toISOString();
  const jobs = await db.prepare(
    `SELECT * FROM jobs WHERE escrow_status IN ('HELD','FUNDED') AND status='DELIVERED' AND delivered_at IS NOT NULL AND delivered_at < ?`
  ).all(cutoff);

  let released = 0;
  for (const job of jobs) {
    await db.prepare(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(job.id);
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
    released++;
  }
  return released;
}

module.exports = { runAutoReleaseSweep };

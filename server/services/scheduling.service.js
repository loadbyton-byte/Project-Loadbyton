const db = require('../db');
const { writeAudit, notify } = require('../lib/helpers');

async function publishScheduledJobs(req) {
  const now = new Date().toISOString();
  const jobs = await db.prepare(
    `SELECT * FROM jobs WHERE status='DRAFT' AND scheduled_post_at IS NOT NULL AND scheduled_post_at <= ?`
  ).all(now);

  let published = 0;
  for (const job of jobs) {
    await db.prepare(`UPDATE jobs SET status='OPEN', updated_at=datetime('now') WHERE id=?`).run(job.id);
    await writeAudit(req, {
      action: 'JOB_PUBLISH',
      details: `${job.job_code} published from schedule`,
      entityType: 'job',
      entityId: job.id,
      beforeState: 'DRAFT',
      afterState: 'OPEN',
    });
    await notify(job.shipper_id, 'Job published', `${job.job_code} has been published and is now open for bids.`, job.id, 'status');
    published++;
  }
  return published;
}

module.exports = { publishScheduledJobs };

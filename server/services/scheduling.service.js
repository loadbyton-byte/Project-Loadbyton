const db = require('../db');
const { writeAudit } = require('../lib/helpers');

function publishScheduledJobs(req) {
  const due = db
    .prepare(
      `SELECT id, job_code, shipper_id FROM jobs
       WHERE status='DRAFT' AND scheduled_post_at IS NOT NULL AND scheduled_post_at <= datetime('now')`
    )
    .all();
  let published = 0;
  for (const job of due) {
    db.prepare(`UPDATE jobs SET status='OPEN', scheduled_post_at=NULL, updated_at=datetime('now') WHERE id=?`).run(job.id);
    writeAudit(req || null, {
      userId: job.shipper_id,
      action: 'JOB_SCHEDULED_PUBLISH',
      details: `${job.job_code} auto-published at its scheduled time`,
      entityType: 'job',
      entityId: job.id,
      beforeState: 'DRAFT',
      afterState: 'OPEN',
    });
    published++;
  }
  return published;
}

module.exports = { publishScheduledJobs };

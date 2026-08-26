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
    if (job.escrow_status === 'DISPUTED') continue;
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
      executePayoutAsync(job, db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id), req);
      released++;
    } catch (e) {
      db.exec('ROLLBACK');
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

// Microservice entry — only activates when SERVICE=escrow (Docker)
if (process.env.SERVICE==='escrow') {
  const express=require('express');
  const { requestId, securityHeaders, cookieParser }=require('../lib/http');
  const app=express();
  app.disable('x-powered-by'); app.set('trust proxy',1);
  app.use(express.json({limit:'8mb', verify:(req,res,buf)=>{req.rawBody=buf.toString('utf8');}}));
  app.use(cookieParser); app.use(requestId); app.use(securityHeaders);
  app.use(require('../routes/system.routes'));
  app.use(require('../routes/stripe.routes'));
  app.use(require('../routes/ledger.routes'));
  app.use(require('../routes/compliance.routes'));
  app.use(require('../routes/ml.routes'));
  app.use(require('../routes/audit.routes'));
  const port=process.env.PORT||4003;
  app.listen(port,()=>console.log(`Escrow service on :${port}`));
}

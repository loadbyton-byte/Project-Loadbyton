const db = require('../db');
const payments = require('../lib/payments');
const { getSettings, writeAudit, notify } = require('../lib/helpers');
const { sendError } = require('../lib/http');

async function awardJob(req, res, jobId, bidId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.shipper_id !== req.user.id) return sendError(res, 403, 'Not your job');

  try {
    db.exec('BEGIN');
    const freshJob = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    if (freshJob.status !== 'OPEN') {
      db.exec('ROLLBACK');
      return sendError(res, 409, 'Job has already been awarded');
    }
    const bid = db.prepare('SELECT * FROM bids WHERE id=? AND job_id=?').get(bidId, jobId);
    if (!bid || bid.status !== 'PENDING') {
      db.exec('ROLLBACK');
      return sendError(res, 404, 'Bid not found or no longer available');
    }
    const { commission_rate_bps } = getSettings();
    const gross = bid.amount_aed;
    const fee = Math.round((gross * commission_rate_bps) / 10000);
    const net = gross - fee;

    db.prepare(
      `UPDATE jobs SET status='AWARDED', awarded_bid_id=?, carrier_id=?, agreed_price_aed=?, escrow_status='HELD', updated_at=datetime('now') WHERE id=?`
    ).run(bid.id, bid.carrier_id, gross, jobId);
    if (payments.isConfigured()) {
      db.prepare(`UPDATE jobs SET processor_payment_status='REQUIRES_PAYMENT', processor_last_error=NULL, updated_at=datetime('now') WHERE id=?`).run(jobId);
    }
    db.prepare(`UPDATE bids SET status='ACCEPTED', updated_at=datetime('now') WHERE id=?`).run(bid.id);
    db.prepare(`UPDATE bids SET status='REJECTED', updated_at=datetime('now') WHERE job_id=? AND id!=?`).run(jobId, bid.id);
    const payoutResult = db
      .prepare('INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type) VALUES (?,?,?,?,?,\'PENDING\',\'MANUAL\')')
      .run(jobId, bid.carrier_id, gross, fee, net);

    writeAudit(req, {
      userId: req.actorId,
      action: 'AWARD',
      details: `${freshJob.job_code} awarded to carrier #${bid.carrier_id} at AED ${gross}`,
      entityType: 'job',
      entityId: jobId,
      beforeState: 'OPEN',
      afterState: 'AWARDED',
    });
    notify(bid.carrier_id, 'Bid accepted', `Your bid on ${freshJob.job_code} was accepted. Escrow is HELD.`, jobId, 'award');
    const rejected = db.prepare('SELECT carrier_id FROM bids WHERE job_id=? AND id!=?').all(jobId, bid.id);
    for (const r of rejected) notify(r.carrier_id, 'Bid not selected', `Another carrier was awarded ${freshJob.job_code}.`, jobId, 'award');
    void payoutResult;
    db.exec('COMMIT');
    const job2 = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    res.json({ ok: true, job: job2 });
  } catch (e) {
    console.error('[award.service] award failed:', e && e.message ? e.message : e);
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    sendError(res, 500, 'Award failed');
  }
}

module.exports = { awardJob };

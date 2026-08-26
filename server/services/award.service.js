const db = require('../db');
const { getSettings, writeAudit, notify } = require('../lib/helpers');

function awardJob(req, res, jobId, bidId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.shipper_id !== req.user.id) return res.status(403).json({ error: 'Not your job' });
  if (job.status !== 'OPEN') return res.status(job.status === 'AWARDED' ? 409 : 403).json({ error: job.status === 'AWARDED' ? 'Job already awarded' : 'Job is not open' });

  const bid = db.prepare('SELECT * FROM bids WHERE id=? AND job_id=?').get(bidId, jobId);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });

  const { commission_rate_bps } = getSettings();
  const commissionRate = commission_rate_bps / 10000;
  const agreedPrice = bid.amount_aed;
  const platformFee = Math.round(agreedPrice * commissionRate);

  db.prepare(
    `UPDATE jobs SET status='AWARDED', carrier_id=?, agreed_price_aed=?, escrow_status='HELD', processor_payment_status='REQUIRES_PAYMENT', updated_at=datetime('now') WHERE id=?`
  ).run(bid.carrier_id, agreedPrice, jobId);

  db.prepare(
    `UPDATE bids SET status='AWARDED' WHERE id=?`
  ).run(bidId);

  db.prepare(
    `UPDATE bids SET status='REJECTED' WHERE job_id=? AND id != ?`
  ).run(jobId, bidId);

  const grossAed = agreedPrice;
  const netAed = grossAed - platformFee;
  db.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'PENDING')`
  ).run(jobId, bid.carrier_id, grossAed, platformFee, netAed);

  writeAudit(req, {
    userId: req.actorId,
    action: 'AWARD',
    details: `${job.job_code}: awarded to bid #${bidId} (AED ${agreedPrice})`,
    entityType: 'job',
    entityId: jobId,
    beforeState: 'OPEN',
    afterState: 'AWARDED',
  });

  notify(bid.carrier_id, 'Bid awarded', `Your bid on ${job.job_code} was awarded. Agreed price: AED ${agreedPrice}.`, jobId, 'award');
  notify(job.shipper_id, 'Job awarded', `${job.job_code} was awarded to a carrier. Escrow HELD: AED ${agreedPrice}.`, jobId, 'award');

  const updated = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  res.json({ job: updated });
}

module.exports = { awardJob };

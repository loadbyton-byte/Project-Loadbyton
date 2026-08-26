const db = require('../db');
const { getSettings, writeAudit, notify } = require('../lib/helpers');

async function awardJob(req, res, jobId, bidId) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.shipper_id !== req.user.id) return res.status(403).json({ error: 'Not your job' });
  if (job.status !== 'OPEN') return res.status(job.status === 'AWARDED' ? 409 : 403).json({ error: job.status === 'AWARDED' ? 'Job already awarded' : 'Job is not open' });

  const bid = await db.prepare('SELECT * FROM bids WHERE id=? AND job_id=?').get(bidId, jobId);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });

  const { commission_rate_bps } = await getSettings();
  const commissionRate = commission_rate_bps / 10000;
  const agreedPrice = bid.amount_aed;
  const platformFee = Math.round(agreedPrice * commissionRate);

  await db.prepare(
    `UPDATE jobs SET status='AWARDED', carrier_id=?, agreed_price_aed=?, escrow_status='HELD', processor_payment_status='REQUIRES_PAYMENT', updated_at=datetime('now') WHERE id=?`
  ).run(bid.carrier_id, agreedPrice, jobId);

  await db.prepare(
    `UPDATE bids SET status='AWARDED' WHERE id=?`
  ).run(bidId);

  await db.prepare(
    `UPDATE bids SET status='REJECTED' WHERE job_id=? AND id != ?`
  ).run(jobId, bidId);

  const grossAed = agreedPrice;
  const netAed = grossAed - platformFee;
  await db.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'PENDING')`
  ).run(jobId, bid.carrier_id, grossAed, platformFee, netAed);

  await writeAudit(req, {
    userId: req.actorId,
    action: 'AWARD',
    details: `${job.job_code}: awarded to bid #${bidId} (AED ${agreedPrice})`,
    entityType: 'job',
    entityId: jobId,
    beforeState: 'OPEN',
    afterState: 'AWARDED',
  });

  await notify(bid.carrier_id, 'Bid awarded', `Your bid on ${job.job_code} was awarded. Agreed price: AED ${agreedPrice}.`, jobId, 'award');
  await notify(job.shipper_id, 'Job awarded', `${job.job_code} was awarded to a carrier. Escrow HELD: AED ${agreedPrice}.`, jobId, 'award');

  const updated = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  res.json({ job: updated });
}

module.exports = { awardJob };

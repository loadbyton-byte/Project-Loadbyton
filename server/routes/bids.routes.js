const db = require('../db');
const { sendError } = require('../lib/http');
const { BID_SORT_COLUMNS } = require('../lib/constants');
const { writeAudit } = require('../lib/helpers');
const { auth } = require('../middleware/auth');



const router = require('express').Router();

router.get('/api/bids/mine', auth(['CARRIER']), async (req, res) => {
  const { limit, offset, sort, q } = req.query;
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  const orderBy = BID_SORT_COLUMNS[sort] || BID_SORT_COLUMNS.date_desc;
  let where = 'b.carrier_id = ?';
  const params = [req.user.id];
  if (q && q.trim()) {
    where += ' AND (j.job_code LIKE ? OR j.delivery_address LIKE ?)';
    const needle = `%${q.trim()}%`;
    params.push(needle, needle);
  }
  const total = (await db.prepare(`SELECT COUNT(*) c FROM bids b JOIN jobs j ON j.id = b.job_id WHERE ${where}`).get(...params)).c;
  const bids = await db
    .prepare(
      `SELECT b.*, j.job_code, j.pickup_terminal, j.delivery_area, j.delivery_address, j.status as job_status, sp.rating_avg as shipper_rating
       FROM bids b JOIN jobs j ON j.id = b.job_id
       LEFT JOIN profiles sp ON sp.user_id = j.shipper_id
       WHERE ${where}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);
  res.json({ bids, total, limit: lim, offset: off });
});

router.post('/api/bids/:id/withdraw', auth(['CARRIER']), async (req, res) => {
  const bid = await db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  if (!bid) return sendError(res, 404, 'Bid not found');
  if (bid.carrier_id !== req.user.id) return sendError(res, 403, 'Not your bid');
  if (bid.status !== 'PENDING') return sendError(res, 400, 'Only a pending bid can be withdrawn');
  await db.prepare(`UPDATE bids SET status='WITHDRAWN', updated_at=datetime('now') WHERE id=?`).run(bid.id);
  await writeAudit(req, { userId: req.actorId, action: 'BID_WITHDRAW', details: `Withdrew bid #${bid.id}`, entityType: 'bid', entityId: bid.id, beforeState: 'PENDING', afterState: 'WITHDRAWN' });
  const updated = await db.prepare('SELECT * FROM bids WHERE id=?').get(bid.id);
  res.json({ ok: true, bid: updated });
});

module.exports = router;

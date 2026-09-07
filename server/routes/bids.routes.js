// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */
const db = require('../db');
const apiResponse = require('../lib/apiResponse');
const { BID_SORT_COLUMNS, ANCILLARY_CHARGE_TYPES } = require('../lib/constants');
const { writeAudit, notify } = require('../lib/helpers');
const { auth } = require('../middleware/auth');

// Access for the pre-award negotiation/ancillary-charges surface: only the
// job's shipper, or the specific bid's own carrier — nobody else, not even
// another bidder on the same job (this is commercial back-and-forth on one
// bid, not a public thread).
async function loadBidWithJobForNegotiation(req, res, bidId) {
  const bid = await db.prepare('SELECT * FROM bids WHERE id=?').get(bidId);
  if (!bid) { apiResponse.error(req, res, 'BID_NOT_FOUND', 'Bid not found'); return null; }
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(bid.job_id);
  if (!job) { apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found'); return null; }
  const isShipperOwner = req.user.role === 'SHIPPER' && job.shipper_id === req.user.id;
  const isBidOwner = req.user.role === 'CARRIER' && bid.carrier_id === req.user.id;
  if (!isShipperOwner && !isBidOwner) {
    apiResponse.error(req, res, 'FORBIDDEN', 'Only this job\'s shipper or this bid\'s carrier can access this');
    return null;
  }
  return { bid, job };
}



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
  if (!bid) return apiResponse.error(req, res, 'BID_NOT_FOUND', 'Bid not found');
  if (bid.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your bid');
  if (bid.status !== 'PENDING') return apiResponse.error(req, res, 'BID_NOT_PENDING', 'Only a pending bid can be withdrawn', { status: 400 });
  await db.prepare(`UPDATE bids SET status='WITHDRAWN', updated_at=datetime('now') WHERE id=?`).run(bid.id);
  await writeAudit(req, { userId: req.actorId, action: 'BID_WITHDRAW', details: `Withdrew bid #${bid.id}`, entityType: 'bid', entityId: bid.id, beforeState: 'PENDING', afterState: 'WITHDRAWN' });
  const updated = await db.prepare('SELECT * FROM bids WHERE id=?').get(bid.id);
  res.json({ ok: true, bid: updated });
});

// --- Pre-award negotiation (per bid, not per job) -------------------------
// Deliberately separate from messages/message_threads, which are scoped to
// jobs.carrier_id and only exist once a carrier is assigned — see
// server/schema.js's bid_negotiations table comment.

router.get('/api/bids/:id/negotiation', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const messages = await db.prepare('SELECT * FROM bid_negotiations WHERE bid_id=? ORDER BY created_at ASC').all(ctx.bid.id);
  res.json({ messages });
});

router.post('/api/bids/:id/negotiation', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'message is required');
  await db.prepare('INSERT INTO bid_negotiations (bid_id, sender_id, message) VALUES (?,?,?)').run(ctx.bid.id, req.actorId, String(message).trim());
  const other = req.user.role === 'SHIPPER' ? ctx.bid.carrier_id : ctx.job.shipper_id;
  await notify(other, 'New message on a bid', `A new message on ${ctx.job.job_code}'s bid.`, ctx.job.id, 'bid');
  const messages = await db.prepare('SELECT * FROM bid_negotiations WHERE bid_id=? ORDER BY created_at ASC').all(ctx.bid.id);
  res.status(201).json({ messages });
});

// --- Itemized ancillary charges (Salik, e-token, demurrage, inspection) ---
// A charge line only counts as agreed once BOTH sides have independently
// confirmed it — proposing it does not agree to it, even for the party who
// proposed it (they've already implicitly agreed to their own proposal by
// making it, but the other side must still confirm).

router.get('/api/bids/:id/ancillary-charges', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const charges = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE bid_id=? ORDER BY created_at ASC').all(ctx.bid.id);
  res.json({ charges });
});

router.post('/api/bids/:id/ancillary-charges', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const { chargeType, amountAed, notes } = req.body || {};
  if (!ANCILLARY_CHARGE_TYPES.includes(chargeType)) return apiResponse.error(req, res, 'VALIDATION_FAILED', `chargeType must be one of: ${ANCILLARY_CHARGE_TYPES.join(', ')}`);
  const amount = Number(amountAed);
  if (!amount || amount <= 0) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'amountAed must be a positive number');
  const isShipper = req.user.role === 'SHIPPER';
  const result = await db.prepare(
    `INSERT INTO bid_ancillary_charges (bid_id, charge_type, amount_aed, notes, proposed_by, agreed_by_shipper, agreed_by_carrier)
     VALUES (?,?,?,?,?,?,?) RETURNING id`
  ).run(ctx.bid.id, chargeType, amount, notes || null, req.actorId, isShipper ? 1 : 0, isShipper ? 0 : 1);
  const other = isShipper ? ctx.bid.carrier_id : ctx.job.shipper_id;
  await notify(other, 'New charge proposed', `A ${chargeType} charge of AED ${amount} was proposed on ${ctx.job.job_code}'s bid.`, ctx.job.id, 'bid');
  const charge = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ charge });
});

// The other party confirms a proposed charge — the one who proposed it
// already has their own agreed_by_* flag set from the INSERT above, so
// this just needs to flip the other side's flag.
router.post('/api/bids/:id/ancillary-charges/:chargeId/agree', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const charge = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=? AND bid_id=?').get(req.params.chargeId, ctx.bid.id);
  if (!charge) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Charge not found', { status: 404 });
  const isShipper = req.user.role === 'SHIPPER';
  await db.prepare(`UPDATE bid_ancillary_charges SET ${isShipper ? 'agreed_by_shipper' : 'agreed_by_carrier'}=1 WHERE id=?`).run(charge.id);
  const updated = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=?').get(charge.id);
  res.json({ charge: updated });
});

router.delete('/api/bids/:id/ancillary-charges/:chargeId', auth(), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const charge = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=? AND bid_id=?').get(req.params.chargeId, ctx.bid.id);
  if (!charge) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Charge not found', { status: 404 });
  if (ctx.bid.terms_confirmed_at) return apiResponse.error(req, res, 'FORBIDDEN', 'Terms are already confirmed — this charge can no longer be removed');
  await db.prepare('DELETE FROM bid_ancillary_charges WHERE id=?').run(charge.id);
  res.json({ ok: true });
});

// --- Confirm terms — the gate award.service.js's awardJob checks before
// letting a shipper commit to this bid. Shipper-only: the carrier agrees
// to individual charge lines above, but the shipper is the one deciding
// to actually proceed to award.
router.post('/api/bids/:id/confirm-terms', auth(['SHIPPER']), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  if (ctx.job.shipper_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  const charges = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE bid_id=?').all(ctx.bid.id);
  const allAgreed = charges.every((c) => c.agreed_by_shipper && c.agreed_by_carrier);
  if (!allAgreed) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Every proposed ancillary charge must be agreed by both sides before terms can be confirmed');
  await db.prepare(`UPDATE bids SET terms_confirmed_at=datetime('now') WHERE id=?`).run(ctx.bid.id);
  await writeAudit(req, { userId: req.actorId, action: 'BID_TERMS_CONFIRMED', details: `Terms confirmed on bid #${ctx.bid.id}`, entityType: 'bid', entityId: ctx.bid.id });
  await notify(ctx.bid.carrier_id, 'Terms confirmed', `The shipper confirmed terms on your bid for ${ctx.job.job_code}. Awaiting assignment.`, ctx.job.id, 'bid');
  const updated = await db.prepare('SELECT * FROM bids WHERE id=?').get(ctx.bid.id);
  res.json({ bid: updated });
});

module.exports = router;

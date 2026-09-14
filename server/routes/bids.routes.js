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
const { auth, requireSeatRole } = require('../middleware/auth');
const { awardJob } = require('../services/award.service');

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

router.post('/api/bids/:id/withdraw', auth(['CARRIER']), requireSeatRole(['OPS']), async (req, res) => {
  const bid = await db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  if (!bid) return apiResponse.error(req, res, 'BID_NOT_FOUND', 'Bid not found');
  if (bid.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your bid');
  if (bid.status !== 'PENDING') return apiResponse.error(req, res, 'BID_NOT_PENDING', 'Only a pending bid can be withdrawn', { status: 400 });
  await db.prepare(`UPDATE bids SET status='WITHDRAWN', updated_at=datetime('now') WHERE id=?`).run(bid.id);
  await writeAudit(req, { userId: req.actorId, action: 'BID_WITHDRAW', details: `Withdrew bid #${bid.id}`, entityType: 'bid', entityId: bid.id, beforeState: 'PENDING', afterState: 'WITHDRAWN' });
  // Commercial-logic audit finding: a withdrawn bid never told the shipper
  // — the bid just silently vanished from their consideration set, with
  // no way to know it happened short of noticing a stale list on refresh.
  const job = await db.prepare('SELECT id, job_code, shipper_id FROM jobs WHERE id=?').get(bid.job_id);
  if (job) await notify(job.shipper_id, 'A bid was withdrawn', `A carrier withdrew their bid on ${job.job_code}.`, job.id, 'bid');
  const updated = await db.prepare('SELECT * FROM bids WHERE id=?').get(bid.id);
  res.json({ ok: true, bid: updated });
});

// Commercial-logic audit finding — a broker/forwarder direct-assigning a
// job (POST /api/jobs/:id/direct-assign, broker.routes.js) used to create
// this carrier's bid AND award it in the same request, with no action
// from the carrier at all. This is that missing action: only a bid
// actually created that way (carrier_acceptance_required=1) needs it — a
// carrier's own marketplace bid is already their own affirmative action,
// same as it's always been (see award.service.js and the commercial-logic
// audit's verification notes on why that stays a legitimate design, not a
// gap). Declining is the existing withdraw endpoint just above — a
// direct-assign bid is a normal PENDING bid in every other respect.
router.post('/api/bids/:id/accept', auth(['CARRIER']), requireSeatRole(['OPS']), async (req, res) => {
  const bid = await db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  if (!bid) return apiResponse.error(req, res, 'BID_NOT_FOUND', 'Bid not found');
  if (bid.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your bid');
  if (!bid.carrier_acceptance_required) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'This bid does not require a separate acceptance step', { status: 400 });
  if (bid.carrier_accepted_at) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Already accepted', { status: 409 });
  if (bid.status !== 'PENDING') return apiResponse.error(req, res, 'BID_NOT_PENDING', 'This bid is no longer pending', { status: 400 });
  const job = await db.prepare('SELECT shipper_id FROM jobs WHERE id=?').get(bid.job_id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  await db.prepare(`UPDATE bids SET carrier_accepted_at=datetime('now') WHERE id=?`).run(bid.id);
  await writeAudit(req, { userId: req.actorId, action: 'DIRECT_ASSIGN_ACCEPTED', details: `Accepted direct-assign bid #${bid.id}`, entityType: 'bid', entityId: bid.id });
  // Reuses the exact same award transaction a normal marketplace award
  // uses — skipNegotiation:true because a direct-assign bid has no
  // ancillary-charges negotiation UI on either side to confirm terms
  // through (broker.routes.js sets the price directly).
  // awardAsShipperId: the caller here is the CARRIER, not the job's
  // shipper (often a broker/forwarder), so awardJob's normal
  // req.user.id===job.shipper_id ownership check would always fail —
  // see that function's own comment on this explicit escape hatch. This
  // route has already established the real authorization (this carrier
  // owns this specific accepted bid), which is what actually matters here.
  req.body = { ...(req.body || {}), bidId: bid.id, skipNegotiation: true };
  req.awardAsShipperId = job.shipper_id;
  return awardJob(req, res, bid.job_id, bid.id);
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

router.post('/api/bids/:id/negotiation', auth(), requireSeatRole(['OPS']), async (req, res) => {
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

router.post('/api/bids/:id/ancillary-charges', auth(), requireSeatRole(['OPS']), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  // Same lock the DELETE handler below already enforces — without this, a
  // charge could be added AFTER confirm-terms recorded both sides agreeing
  // to the terms as they stood, silently invalidating that confirmation.
  if (ctx.bid.terms_confirmed_at) return apiResponse.error(req, res, 'FORBIDDEN', 'Terms are already confirmed — this bid\'s charges are locked and no new ones can be proposed.');
  // Commercial-logic audit finding: terms_confirmed_at alone missed the
  // skipNegotiation award path (award.service.js lets a shipper award
  // without ever setting it) — a charge proposed on an already-AWARDED (or
  // later) bid was accepted with a "New charge proposed" notification to
  // the other party, implying it could still change what's owed, when
  // award.service.js only ever sums agreed charges ONCE, at award time
  // (see its agreedCharges query) — nothing post-award re-reads this
  // table into any payment/invoice calculation. Proposing one after award
  // is not a smaller mistake than after terms-confirm, it's a bigger one:
  // it looks actionable and isn't.
  if (ctx.bid.status !== 'PENDING') return apiResponse.error(req, res, 'FORBIDDEN', 'This bid is no longer pending — the price is locked and new charges can\'t be proposed on it.');
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
router.post('/api/bids/:id/ancillary-charges/:chargeId/agree', auth(), requireSeatRole(['OPS']), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const charge = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=? AND bid_id=?').get(req.params.chargeId, ctx.bid.id);
  if (!charge) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Charge not found', { status: 404 });
  // Same skipNegotiation gap as the POST/DELETE handlers above — agreeing
  // to a stale, never-agreed charge after the bid is no longer PENDING
  // would flip a flag with no actual financial effect (award.service.js
  // already summed agreed charges once, at award time).
  if (ctx.bid.status !== 'PENDING') return apiResponse.error(req, res, 'FORBIDDEN', 'This bid is no longer pending — charges on it can no longer be changed.');
  const isShipper = req.user.role === 'SHIPPER';
  await db.prepare(`UPDATE bid_ancillary_charges SET ${isShipper ? 'agreed_by_shipper' : 'agreed_by_carrier'}=1 WHERE id=?`).run(charge.id);
  const updated = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=?').get(charge.id);
  res.json({ charge: updated });
});

router.delete('/api/bids/:id/ancillary-charges/:chargeId', auth(), requireSeatRole(['OPS']), async (req, res) => {
  const ctx = await loadBidWithJobForNegotiation(req, res, req.params.id);
  if (!ctx) return;
  const charge = await db.prepare('SELECT * FROM bid_ancillary_charges WHERE id=? AND bid_id=?').get(req.params.chargeId, ctx.bid.id);
  if (!charge) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Charge not found', { status: 404 });
  if (ctx.bid.terms_confirmed_at) return apiResponse.error(req, res, 'FORBIDDEN', 'Terms are already confirmed — this charge can no longer be removed');
  // Same skipNegotiation gap as the POST handler above.
  if (ctx.bid.status !== 'PENDING') return apiResponse.error(req, res, 'FORBIDDEN', 'This bid is no longer pending — charges on it can no longer be changed.');
  // Only the party who proposed a charge may withdraw it — this endpoint
  // previously let either side delete the other's proposal outright (no
  // ownership check at all), which meant a shipper could unilaterally
  // erase a carrier's ancillary charge instead of negotiating it. The
  // counterparty's actual recourse is to withhold agreement (the /agree
  // endpoint) rather than delete outright, or withdraw their own bid.
  if (charge.proposed_by !== req.actorId) return apiResponse.error(req, res, 'FORBIDDEN', 'Only the party who proposed this charge can withdraw it');
  await db.prepare('DELETE FROM bid_ancillary_charges WHERE id=?').run(charge.id);
  res.json({ ok: true });
});

// --- Confirm terms — the gate award.service.js's awardJob checks before
// letting a shipper commit to this bid. Shipper-only: the carrier agrees
// to individual charge lines above, but the shipper is the one deciding
// to actually proceed to award.
router.post('/api/bids/:id/confirm-terms', auth(['SHIPPER']), requireSeatRole(['OPS']), async (req, res) => {
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

// Change 27 (Phase 7b) — Forwarder / Broker account operations.
//
// FORWARDER and BROKER register as first-class roles (see auth.routes.js +
// middleware/auth.js roleSatisfies: forwarder passes SHIPPER guards, broker
// passes both). This file is only the NEW surface those roles need:
// client/carrier rosters and the direct-assign-vs-open-post choice.
// WhatsApp-in-dashboard + bulk CSV import are explicit Phase 2 (not here).
//
// Direct-assign reuses the exact award transaction (award.service.js
// awardJob) by creating a PENDING bid for the target carrier first — one
// escrow/ledger/capacity implementation, not a second copy. The disclosed
// one-hop rule is enforced here: a job already carrying broker_id rejects
// any other broker, and targets must be CARRIER/OWNER_OPERATOR in-roster.
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { awardJob } = require('../services/award.service');

const router = require('express').Router();

function ownJobOr403(job, user) {
  if (!job) return 'missing';
  // Shipper owns their posted jobs; forwarder/broker own jobs they posted
  // (shipper_id is set to their user id at posting via the SHIPPER-satisfying
  // POST /api/jobs guard). Admin bypass is handled by callers.
  if (job.shipper_id !== user.id && user.role !== 'ADMIN') return 'forbidden';
  return null;
}

// --- Forwarder client roster ---
router.get('/api/forwarder/clients', auth(['FORWARDER', 'ADMIN']), async (req, res) => {
  const rows = req.user.role === 'ADMIN'
    ? await db.prepare(`SELECT * FROM forwarder_clients ORDER BY created_at DESC LIMIT 200`).all()
    : await db.prepare(`SELECT * FROM forwarder_clients WHERE forwarder_id=? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ clients: rows });
});

router.post('/api/forwarder/clients', auth(['FORWARDER']), async (req, res) => {
  const { clientName, contactPhone, contactEmail } = req.body || {};
  if (!clientName || !String(clientName).trim()) return sendError(res, 400, 'clientName is required');
  const r = await db
    .prepare(`INSERT INTO forwarder_clients (forwarder_id, client_name, contact_phone, contact_email) VALUES (?,?,?,?) RETURNING id`)
    .run(req.user.id, String(clientName).trim(), contactPhone || null, contactEmail || null);
  res.status(201).json({ client: await db.prepare(`SELECT * FROM forwarder_clients WHERE id=?`).get(Number(r.lastInsertRowid)) });
});

// --- Broker carrier roster ---
router.get('/api/broker/carriers', auth(['BROKER', 'ADMIN']), async (req, res) => {
  const rows = req.user.role === 'ADMIN'
    ? await db.prepare(`SELECT bc.*, u.email AS carrier_email FROM broker_carriers bc JOIN users u ON u.id=bc.carrier_id ORDER BY bc.added_at DESC LIMIT 200`).all()
    : await db.prepare(
        `SELECT bc.*, u.email AS carrier_email, p.company_name FROM broker_carriers bc
         JOIN users u ON u.id=bc.carrier_id LEFT JOIN profiles p ON p.user_id=u.id
         WHERE bc.broker_id=? ORDER BY bc.added_at DESC`
      ).all(req.user.id);
  res.json({ carriers: rows });
});

router.post('/api/broker/carriers', auth(['BROKER']), async (req, res) => {
  const { carrierId } = req.body || {};
  const carrier = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(carrierId));
  if (!carrier) return sendError(res, 404, 'Carrier not found');
  if (!['CARRIER', 'OWNER_OPERATOR'].includes(carrier.role)) {
    return sendError(res, 400, 'Roster targets must be CARRIER or OWNER_OPERATOR accounts — brokers cannot re-broker to another broker/forwarder (one-hop rule)');
  }
  try {
    const r = await db.prepare(`INSERT INTO broker_carriers (broker_id, carrier_id) VALUES (?,?) RETURNING id`).run(req.user.id, carrier.id);
    res.status(201).json({ roster: await db.prepare(`SELECT * FROM broker_carriers WHERE id=?`).get(Number(r.lastInsertRowid)) });
  } catch (e) {
    if (/UNIQUE|unique/i.test(e.message)) return sendError(res, 409, 'Carrier already in your roster');
    throw e;
  }
});

// --- Direct assign (broker + forwarder): open job → specific carrier ---
// Body: { carrierId, amountAed, etaAt?, brokerSpreadBps? (brokers only) }
router.post('/api/jobs/:id/direct-assign', auth(['BROKER', 'FORWARDER']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  const ownership = ownJobOr403(job, req.user);
  if (ownership === 'missing') return sendError(res, 404, 'Job not found');
  if (ownership) return sendError(res, 403, 'Not your job');
  if (job.status !== 'OPEN') return sendError(res, 403, `Only OPEN jobs can be direct-assigned (current: ${job.status})`);
  if (job.broker_id && job.broker_id !== req.user.id) {
    return sendError(res, 403, 'One-hop rule: this job is already brokered and cannot be re-brokered');
  }

  const { carrierId, amountAed, etaAt, brokerSpreadBps } = req.body || {};
  const carrier = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(carrierId));
  if (!carrier) return sendError(res, 404, 'Carrier not found');
  if (!['CARRIER', 'OWNER_OPERATOR'].includes(carrier.role)) {
    return sendError(res, 400, 'Direct-assign targets must be CARRIER or OWNER_OPERATOR (one-hop rule)');
  }
  const amount = Number(amountAed);
  if (!amount || amount <= 0) return sendError(res, 400, 'amountAed must be a positive number');

  if (req.user.role === 'BROKER') {
    const inRoster = await db.prepare(`SELECT 1 FROM broker_carriers WHERE broker_id=? AND carrier_id=?`).get(req.user.id, carrier.id);
    if (!inRoster) return sendError(res, 403, 'Carrier is not in your roster — add them via POST /api/broker/carriers first');
  }

  let spread = 0;
  if (brokerSpreadBps !== undefined) {
    if (req.user.role !== 'BROKER') return sendError(res, 400, 'brokerSpreadBps is brokers-only');
    spread = Number(brokerSpreadBps);
    if (!Number.isFinite(spread) || spread < 0 || spread > 2000) return sendError(res, 400, 'brokerSpreadBps must be 0–2000 bps (0–20%)');
  }

  // Verified-carrier guard mirrors the marketplace: unverified carriers
  // cannot be awarded (see award.service.js pre-checks surface the same).
  if (!carrier.is_verified) return sendError(res, 403, 'Carrier is not verified yet');

  const bidInsert = await db
    .prepare(`INSERT INTO bids (job_id, carrier_id, amount_aed, eta_at, status, truck_type) VALUES (?,?,?,?, 'PENDING', ?) RETURNING id`)
    .run(job.id, carrier.id, amount, etaAt || null, 'flatbed');
  const bidId = Number(bidInsert.lastInsertRowid);

  if (req.user.role === 'BROKER') {
    await db.prepare(`UPDATE jobs SET broker_id=?, broker_spread_bps=? WHERE id=?`).run(req.user.id, spread, job.id);
  } else if (req.body.forwarderClientId) {
    const client = await db.prepare(`SELECT * FROM forwarder_clients WHERE id=? AND forwarder_id=?`).get(Number(req.body.forwarderClientId), req.user.id);
    if (!client) return sendError(res, 400, 'forwarderClientId must be one of your roster clients');
    await db.prepare(`UPDATE jobs SET forwarder_client_id=? WHERE id=?`).run(client.id, job.id);
  }

  req.body = { ...(req.body || {}), bidId, skipNegotiation: true };
  return awardJob(req, res, job.id, bidId);
});

module.exports = router;

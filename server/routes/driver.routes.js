// The one read a DRIVER seat needs on login: which job it's currently
// assigned to. Deliberately its own small payload (not jobService.getJob,
// which returns the full bid history and other data a driver has no
// business seeing) — see middleware/auth.js's DRIVER_SEAT_ALLOWED_ROUTES
// for the rest of what a driver seat can reach.
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

router.get('/api/driver/job', auth(['CARRIER']), async (req, res) => {
  // DRIVER_ASSOCIATE (pool driver, WhatsApp trip offers) needs this exact
  // read too — middleware/auth.js's DRIVER_SEAT_ALLOWED_ROUTES already lets
  // both seat roles reach this route; this check was never updated to
  // match, so every DRIVER_ASSOCIATE seat 403'd here regardless — the one
  // data call DriverHome.jsx makes, so their home page was permanently
  // broken.
  if (req.user.actingSeatRole !== 'DRIVER' && req.user.actingSeatRole !== 'DRIVER_ASSOCIATE') return res.status(403).json({ error: 'Not a driver account' });

  const driver = await db.prepare('SELECT id FROM drivers WHERE seat_user_id=?').get(req.user.actingSeatId);
  if (!driver) return res.json({ job: null });

  const job = await db
    .prepare(
      `SELECT id, job_code, status, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, cargo_type, equipment_type,
              pickup_lat, pickup_lng, delivery_lat, delivery_lng, updated_at
       FROM jobs WHERE assigned_driver_id=? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(driver.id);
  res.json({ job: job || null });
});

// A DRIVER_ASSOCIATE seat's own earnings — the whole point of that seat
// role (a revenue-split wallet, unlike a plain DRIVER) but the only
// existing wallet read (fleet.routes.js's GET /api/fleet/driver-associates
// /wallet) is the CARRIER's fleet-wide view across every driver they run,
// filtered by carrier_id, not driver_id — allowlisting that route for
// driver seats directly would leak every OTHER driver's earnings to this
// one. This is the seat-scoped equivalent, same seat_user_id -> driver_id
// resolution as GET /api/driver/job above, filtered to just this driver's
// own entries.
router.get('/api/driver/wallet', auth(['CARRIER']), async (req, res) => {
  if (req.user.actingSeatRole !== 'DRIVER_ASSOCIATE') return res.status(403).json({ error: 'Not a driver-associate account' });

  const driver = await db.prepare('SELECT id FROM drivers WHERE seat_user_id=?').get(req.user.actingSeatId);
  if (!driver) return res.json({ entries: [] });

  const rows = await db
    .prepare(
      `SELECT dwe.*, j.job_code
       FROM driver_wallet_entries dwe
       JOIN jobs j ON j.id = dwe.job_id
       WHERE dwe.driver_id=? ORDER BY dwe.created_at DESC LIMIT 200`
    )
    .all(driver.id);
  res.json({ entries: rows });
});

// The web-reachable version of the WhatsApp trip-offer accept/decline flow
// (routes/whatsapp.routes.js's handleTripOfferResponse) — before this, a
// driver seat's only channel to respond to a real pending offer was
// inbound WhatsApp, which requires WHATSAPP_ACCESS_TOKEN configured (dark
// by default, see lib/whatsapp.js) and a driver who actually has WhatsApp
// set up. A driver with neither had no way to act on an offer at all.
router.get('/api/driver/trip-offer', auth(['CARRIER']), async (req, res) => {
  if (req.user.actingSeatRole !== 'DRIVER' && req.user.actingSeatRole !== 'DRIVER_ASSOCIATE') return res.status(403).json({ error: 'Not a driver account' });

  const driver = await db.prepare('SELECT id FROM drivers WHERE seat_user_id=?').get(req.user.actingSeatId);
  if (!driver) return res.json({ tripOffer: null });

  const tripOffer = await db.prepare(`SELECT * FROM trip_offers WHERE driver_id=? AND status='PENDING' ORDER BY offered_at DESC LIMIT 1`).get(driver.id);
  if (!tripOffer) return res.json({ tripOffer: null });

  const job = await db
    .prepare(
      `SELECT id, job_code, status, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, cargo_type, equipment_type, agreed_price_aed, currency
       FROM jobs WHERE id=?`
    )
    .get(tripOffer.job_id);
  res.json({ tripOffer: { ...tripOffer, job } });
});

router.post('/api/driver/trip-offer/:id/respond', auth(['CARRIER']), async (req, res) => {
  if (req.user.actingSeatRole !== 'DRIVER' && req.user.actingSeatRole !== 'DRIVER_ASSOCIATE') return res.status(403).json({ error: 'Not a driver account' });
  const accepted = !!(req.body && req.body.accepted);

  const driver = await db.prepare('SELECT * FROM drivers WHERE seat_user_id=?').get(req.user.actingSeatId);
  if (!driver) return res.status(404).json({ error: 'Driver record not found' });

  const tripOffer = await db.prepare(`SELECT * FROM trip_offers WHERE id=? AND driver_id=? AND status='PENDING'`).get(req.params.id, driver.id);
  if (!tripOffer) return res.status(404).json({ error: 'No pending offer with that id for you' });

  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(tripOffer.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { handleTripOfferResponse } = require('./whatsapp.routes');
  await handleTripOfferResponse(tripOffer, job, driver, accepted);

  const updated = await db.prepare('SELECT * FROM trip_offers WHERE id=?').get(tripOffer.id);
  res.json({ tripOffer: updated });
});

module.exports = router;

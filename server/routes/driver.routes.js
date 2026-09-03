// The one read a DRIVER seat needs on login: which job it's currently
// assigned to. Deliberately its own small payload (not jobService.getJob,
// which returns the full bid history and other data a driver has no
// business seeing) — see middleware/auth.js's DRIVER_SEAT_ALLOWED_ROUTES
// for the rest of what a driver seat can reach.
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

router.get('/api/driver/job', auth(['CARRIER']), async (req, res) => {
  if (req.user.actingSeatRole !== 'DRIVER') return res.status(403).json({ error: 'Not a driver account' });

  const driver = await db.prepare('SELECT id FROM drivers WHERE seat_user_id=?').get(req.user.actingSeatId);
  if (!driver) return res.json({ job: null });

  const job = await db
    .prepare(
      `SELECT id, job_code, status, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, cargo_type, equipment_type, updated_at
       FROM jobs WHERE assigned_driver_id=? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(driver.id);
  res.json({ job: job || null });
});

module.exports = router;

// Phase 8 (Change 28 remainder) — multi-stop itinerary + shipper-facing
// lane-rate analytics.
//
// Stops are INTERMEDIATE legs: the job's own pickup_terminal/delivery_area
// stay the canonical first/last legs. Shipper or awarded carrier manages
// stops while OPEN/AWARDED/PICKED_UP/IN_TRANSIT; completed_at is stamped by
// the carrier per stop. getJob() surfaces stops as `stops[]` (see
// services/job.service.js patch in this same change).
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth, requireSeatRole } = require('../middleware/auth');
const { unifiedLanes } = require('../lib/lanes');

const router = require('express').Router();

const STOP_TYPES = ['PICKUP', 'DROP', 'WAYPOINT'];
const EDITABLE = ['OPEN', 'AWARDED', 'PICKED_UP', 'IN_TRANSIT'];

async function canEditJob(job, user) {
  if (!job) return false;
  if (user.role === 'ADMIN') return true;
  if (job.shipper_id === user.id) return true;
  if (job.carrier_id === user.id) return true;
  return false;
}

router.get('/api/jobs/:id/stops', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  const { canViewJob } = require('../lib/helpers');
  if (!(await canViewJob(job, req.user))) return sendError(res, 403, 'Not permitted');
  const stops = await db.prepare(`SELECT * FROM job_stops WHERE job_id=? ORDER BY seq ASC`).all(job.id);
  res.json({ stops });
});

router.post('/api/jobs/:id/stops', auth(['SHIPPER', 'CARRIER', 'FORWARDER', 'BROKER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (!(await canEditJob(job, req.user))) return sendError(res, 403, 'Not permitted');
  if (!EDITABLE.includes(job.status)) return sendError(res, 403, `Stops can only change while ${EDITABLE.join('/')} (current: ${job.status})`);
  const { stopType, location, addressDetail, lat, lng } = req.body || {};
  if (!STOP_TYPES.includes(stopType)) return sendError(res, 400, `stopType must be one of: ${STOP_TYPES.join(', ')}`);
  if (!location || !String(location).trim()) return sendError(res, 400, 'location is required');
  const max = await db.prepare(`SELECT COALESCE(MAX(seq),0) AS m FROM job_stops WHERE job_id=?`).get(job.id);
  const r = await db
    .prepare(`INSERT INTO job_stops (job_id, seq, stop_type, location, address_detail, lat, lng) VALUES (?,?,?,?,?,?,?) RETURNING id`)
    .run(job.id, Number(max.m) + 1, stopType, String(location).trim(), addressDetail || null, lat != null ? Number(lat) : null, lng != null ? Number(lng) : null);
  res.status(201).json({ stop: await db.prepare(`SELECT * FROM job_stops WHERE id=?`).get(Number(r.lastInsertRowid)) });
});

router.post('/api/jobs/:id/stops/:stopId/complete', auth(['CARRIER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (job.carrier_id !== req.user.id && req.user.role !== 'ADMIN') return sendError(res, 403, 'Only the awarded carrier completes stops');
  const stop = await db.prepare(`SELECT * FROM job_stops WHERE id=? AND job_id=?`).get(req.params.stopId, job.id);
  if (!stop) return sendError(res, 404, 'Stop not found');
  if (stop.completed_at) return sendError(res, 409, 'Stop already completed');
  await db.prepare(`UPDATE job_stops SET completed_at=datetime('now') WHERE id=?`).run(stop.id);
  res.json({ stop: await db.prepare(`SELECT * FROM job_stops WHERE id=?`).get(stop.id) });
});

router.delete('/api/jobs/:id/stops/:stopId', auth(['SHIPPER', 'FORWARDER', 'BROKER']), requireSeatRole(['OPS']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return sendError(res, 404, 'Job not found');
  if (!(await canEditJob(job, req.user))) return sendError(res, 403, 'Not permitted');
  if (!EDITABLE.includes(job.status)) return sendError(res, 403, `Stops can only change while ${EDITABLE.join('/')} (current: ${job.status})`);
  const stop = await db.prepare(`SELECT * FROM job_stops WHERE id=? AND job_id=?`).get(req.params.stopId, job.id);
  if (!stop) return sendError(res, 404, 'Stop not found');
  if (stop.completed_at) return sendError(res, 403, 'Completed stops cannot be removed');
  await db.prepare(`DELETE FROM job_stops WHERE id=?`).run(stop.id);
  res.json({ ok: true });
});

// Shipper-facing lane-rate analytics (Change 28): the lane seed data that
// already powered the public index, surfaced as pre-post pricing
// intelligence. Unauthenticated like the index itself — market data, not
// account data.
router.get('/api/lanes/quote', async (req, res) => {
  const { terminal, area } = req.query || {};
  if (!terminal || !area) return sendError(res, 400, 'terminal and area are required');
  const lane = unifiedLanes.find((l) => l.terminal === terminal && l.area === area);
  if (!lane) {
    const avg = Math.round(unifiedLanes.reduce((s, l) => s + l.basePriceAed, 0) / unifiedLanes.length);
    return res.json({ lane: null, fallback: { indicativeAed: avg, note: 'No exact lane reference — platform average. Post with a target price and let carriers bid.' } });
  }
  res.json({
    lane,
    guidance: {
      suggestedTargetAed: lane.basePriceAed,
      onTimePct: lane.onTimePct,
      monthlyLoads: lane.monthlyLoads,
      note: `Carriers bid per trip; ${lane.monthlyLoads}/mo on this lane at ~AED ${lane.basePriceAed} reference.`,
    },
  });
});

module.exports = router;

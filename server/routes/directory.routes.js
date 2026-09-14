// Authenticated cross-role directory browsing. public.routes.js already has
// GET /api/public/carriers for an anonymous visitor (Landing.jsx's preview
// strip, capped at a handful, unconditionally excludes demo accounts) — but
// a logged-in SHIPPER had no page to actually browse verified transporters
// at all, only that marketing teaser or a broker's own private roster
// (broker.routes.js). This is that gap: a real, paginated, searchable
// directory for any authenticated role that needs to look up transporters.
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/transporters', auth(), async (req, res) => {
  const { q, limit, offset } = req.query;
  const lim = Math.max(1, Math.min(Number(limit) || 20, 100));
  const off = Math.max(0, Number(offset) || 0);

  // Same demo/real partition job-lifecycle.routes.js's Open Loads browse
  // already uses — a demo (investor-showcase) account should see demo
  // transporters, a real account should see real ones, never a mix.
  let where = "u.role IN ('CARRIER','OWNER_OPERATOR') AND u.is_verified=1 AND u.is_demo=?";
  const params = [req.user.is_demo ? 1 : 0];
  if (q && String(q).trim()) {
    where += ' AND p.company_name LIKE ?';
    params.push(`%${String(q).trim()}%`);
  }

  const total = (await db.prepare(
    `SELECT COUNT(*) c FROM users u JOIN profiles p ON p.user_id = u.id WHERE ${where}`
  ).get(...params)).c;

  const rows = await db.prepare(
    `SELECT u.id, u.tier, p.company_name, p.rating_avg, p.completed_jobs, p.fleet_size, p.coverage_zones
     FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE ${where}
     ORDER BY p.rating_avg DESC, p.completed_jobs DESC
     LIMIT ? OFFSET ?`
  ).all(...params, lim, off);

  res.json({
    transporters: rows.map((r) => ({
      id: r.id,
      name: r.company_name,
      tier: r.tier,
      rating: r.rating_avg,
      completedJobs: r.completed_jobs,
      fleetSize: r.fleet_size,
      coverageZones: r.coverage_zones,
    })),
    total,
    limit: lim,
    offset: off,
  });
});

module.exports = router;

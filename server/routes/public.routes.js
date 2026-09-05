// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */
const db = require('../db');
const { unifiedLanes } = require('../lib/lanes');
const { getSettings } = require('../lib/helpers');

// main's version, which additionally covers the cache-miss-stampede case):
// no s-maxage meant Cloudflare (sitting in front of Render) treated every
// hit as uncacheable and forwarded it straight through. s-maxage is what
// Cloudflare actually honors at the edge; max-age=0 keeps browsers always
// revalidating so a signed-out visitor never sees minutes-stale numbers;
// stale-while-revalidate covers the gap so a cache miss doesn't block on
// origin while it refreshes.
const PUBLIC_JSON_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';



const router = require('express').Router();

router.get('/api/public/lanes', (req, res) => {
  res.set('Cache-Control', PUBLIC_JSON_CACHE).json({ lanes: unifiedLanes });
});

router.get('/api/public/carriers', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, p.company_name, p.rating_avg, p.completed_jobs, p.fleet_size, p.coverage_zones, u.tier
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role='CARRIER' AND u.is_verified=1 AND u.is_demo=0
       ORDER BY p.rating_avg DESC`
    )
    .all();
  res.set('Cache-Control', PUBLIC_JSON_CACHE).json({
    carriers: rows.map((r) => ({
      id: r.id,
      name: r.company_name,
      rating: r.rating_avg,
      completedJobs: r.completed_jobs,
      fleetSize: r.fleet_size,
      coverageZones: r.coverage_zones,
      tier: r.tier,
      licenceStatus: 'VERIFIED',
    })),
  });
});

router.get('/api/public/market', async (req, res) => {
  const { commission_rate_bps } = await getSettings();
  const openJobs = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE status='OPEN' AND is_demo=0`).get()).c;
  const avgDrayageAED = Math.round(unifiedLanes.reduce((s, l) => s + l.basePriceAed, 0) / unifiedLanes.length);
  const containersPerDay = 300;
  res.set('Cache-Control', PUBLIC_JSON_CACHE).json({
    market: {
      teu2024: 15200000,
      containersPerDay,
      avgDrayageAED,
      takeRate: `${(commission_rate_bps / 100).toFixed(1)}%`,
      annualSpend: Math.round(avgDrayageAED * containersPerDay * 365),
      openJobsNow: openJobs,
    },
  });
});

module.exports = router;

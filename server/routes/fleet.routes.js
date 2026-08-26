const db = require('../db');
const { auth } = require('../middleware/auth');
const router = require('express').Router();
router.get('/api/fleet/overview', auth(['CARRIER']), async (req,res)=>{
  // thin proxy to /api/carrier/fleet for fleet ops UI
  const jobs=await db.prepare('SELECT * FROM jobs WHERE carrier_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ jobs: jobs.map(j=>({ job_code:j.job_code, status:j.status, driver:j.assigned_driver_name, delivered_at:j.delivered_at })) });
});
module.exports = router;

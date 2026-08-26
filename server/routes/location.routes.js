const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

// Driver posts live location every 3 min when IN_TRANSIT (browser Geolocation API)
router.post('/api/jobs/:id/location', auth(['CARRIER']), (req,res)=>{
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.carrier_id!==req.user.id) return sendError(res,403,'Not your job');
  if(job.status!=='IN_TRANSIT') return sendError(res,400,'Job not IN_TRANSIT');
  const { lat, lng, speed, heading } = req.body||{};
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))) return sendError(res,400,'lat/lng required');
  db.prepare(`INSERT INTO location_logs (job_id, carrier_id, lat,lng,speed,heading) VALUES (?,?,?,?,?,?)`).run(job.id, req.user.id, Number(lat), Number(lng), speed!=null?Number(speed):null, heading!=null?Number(heading):null);
  res.json({ ok:true });
});
router.get('/api/jobs/:id/locations', auth(), (req,res)=>{
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  const can = job.shipper_id===req.user.id || job.carrier_id===req.user.id || req.user.role==='ADMIN';
  if(!can) return sendError(res,403,'Not permitted');
  const rows = db.prepare(`SELECT * FROM location_logs WHERE job_id=? ORDER BY recorded_at DESC LIMIT 100`).all(job.id);
  res.json({ locations: rows });
});
module.exports = router;

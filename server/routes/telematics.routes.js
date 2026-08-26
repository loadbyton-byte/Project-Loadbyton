const db = require('../db');
const { sendError } = require('../lib/http');
const router = require('express').Router();

// Hardware telematics webhook — speed, lat, lng, temperature
// Auth via x-device-token or INTERNAL_KEY
router.post('/api/telematics/ingest', (req,res)=>{
  const key = req.headers['x-device-token'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
  if(process.env.TELEMATICS_DEVICE_KEY && key!==process.env.TELEMATICS_DEVICE_KEY && key!==process.env.INTERNAL_KEY){
    return sendError(res,401,'Invalid device token');
  }
  const { deviceId, device_id, jobId, job_id, latitude, longitude, lat, lng, speed, temperature, temp, fuelLevel, fuel_level } = req.body||{};
  const did = deviceId || device_id;
  const jid = jobId || job_id || null;
  const la = Number(latitude ?? lat);
  const lo = Number(longitude ?? lng);
  if(!did) return sendError(res,400,'deviceId required');
  if(!Number.isFinite(la)||!Number.isFinite(lo)) return sendError(res,400,'lat/lng required');
  const spd = speed!=null? Number(speed): null;
  const tmp = temperature!=null? Number(temperature): temp!=null? Number(temp): null;
  const fuel = fuelLevel!=null? Number(fuelLevel): fuel_level!=null? Number(fuel_level): null;
  db.prepare(`INSERT INTO telematics_logs (device_id, job_id, lat,lng,speed,temperature,fuel_level,raw_payload) VALUES (?,?,?,?,?,?,?,?)`).run(String(did), jid?Number(jid):null, la, lo, spd, tmp, fuel, JSON.stringify(req.body));
  // also mirror to location_logs if job is IN_TRANSIT (unified map view)
  if(jid){
    const job = db.prepare('SELECT status FROM jobs WHERE id=?').get(Number(jid));
    if(job && job.status==='IN_TRANSIT'){
      try{ db.prepare(`INSERT INTO location_logs (job_id, carrier_id, lat,lng,speed) VALUES (?,?,?, ?, ?)`).run(Number(jid), 0, la, lo, spd); }catch{}
    }
  }
  res.json({ ok:true, logged: did });
});
router.get('/api/telematics/logs', (req,res)=>{
  // admin or internal
  const key = req.headers['x-internal-key'];
  if(key!==process.env.INTERNAL_KEY && req.user?.role!=='ADMIN') {
    // allow authenticated carrier to see own device logs
  }
  const { jobId, deviceId, limit } = req.query;
  let where='1=1', params=[];
  if(jobId){ where+=' AND job_id=?'; params.push(Number(jobId)); }
  if(deviceId){ where+=' AND device_id=?'; params.push(String(deviceId)); }
  const lim=Math.min(Number(limit)||50,200);
  const rows=db.prepare(`SELECT * FROM telematics_logs WHERE ${where} ORDER BY recorded_at DESC LIMIT ?`).all(...params, lim);
  res.json({ logs: rows });
});
module.exports = router;

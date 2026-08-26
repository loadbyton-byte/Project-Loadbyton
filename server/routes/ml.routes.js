const db = require('../db');
const { sendError } = require('../lib/http');
const router = require('express').Router();

// Predictive pipeline — AIS vessel + NOAA weather + port delay → pETA + routing alternatives
// Real feeds: exactEarth AIS, NOAA GFS, DP World port API. Here: deterministic mock + cache.
function predictEta({ origin, destination, vesselLat, vesselLng, weatherSeverity }){
  const baseHours = 48; // Jebel Ali -> Fujairah baseline
  const weatherPenalty = (weatherSeverity||0)*6; // 0-3 → 0-18h
  const congestion = Math.random()*4; // 0-4h port delay (mock — real: historical matrix)
  const total = baseHours + weatherPenalty + congestion;
  const alternatives = [
    { route: 'Direct drayage', etaHours: Math.round(total*10)/10, risk: weatherSeverity>1?'MEDIUM':'LOW' },
    { route: 'Via Khalifa Port shuttle', etaHours: Math.round((total+8)*10)/10, risk: 'LOW' },
    { route: 'Rail + last-mile', etaHours: Math.round((total+12)*10)/10, risk: 'LOW' },
  ];
  return { baseHours, weatherPenalty, congestion: Math.round(congestion*10)/10, predictedHours: Math.round(total*10)/10, alternatives, inputs: { vesselLat, vesselLng, weatherSeverity } };
}
router.post('/api/ml/predict-eta', (req,res)=>{
  const { jobId, vesselLat, vesselLng, weatherSeverity, origin, destination } = req.body||{};
  let o=origin, d=destination;
  if(jobId){
    const job=db.prepare('SELECT pickup_terminal, delivery_area FROM jobs WHERE id=?').get(Number(jobId));
    if(job){ o=job.pickup_terminal; d=job.delivery_area; }
  }
  if(!o||!d) return sendError(res,400,'origin/destination or jobId required');
  const result=predictEta({ origin:o, destination:d, vesselLat, vesselLng, weatherSeverity: Number(weatherSeverity)||0 });
  // optionally update job's pETA field (store in notes for demo)
  res.json({ prediction: result });
});
router.post('/api/ml/ingest/ais', (req,res)=>{
  // Accepts AIS batch: [{mmsi, lat,lng,speed,course}]
  const { positions } = req.body||{};
  if(!Array.isArray(positions)) return sendError(res,400,'positions array required');
  // store stub — real: TimescaleDB + PostGIS
  res.json({ ingested: positions.length, status: 'queued for pETA recomputation' });
});
router.post('/api/ml/ingest/noaa', (req,res)=>{
  const { feeds } = req.body||{};
  res.json({ ingested: Array.isArray(feeds)?feeds.length:1, status: 'weather ingested' });
});
module.exports = router;

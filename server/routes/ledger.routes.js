// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */
const crypto = require('node:crypto');
const db = require('../db');
const { sendError } = require('../lib/http');
const { apiResponse } = require('../lib/apiResponse');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

async function riskScore({ carrierId, laneKey, countryCode }){
  const profile=await db.prepare('SELECT rating_avg, completed_jobs FROM profiles WHERE user_id=?').get(carrierId);
  const rating=profile?.rating_avg ?? 5;
  const completed=profile?.completed_jobs ?? 0;
  // lane stability: avg jobs on lane last 90d
  const laneCount = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE pickup_terminal||'->'||delivery_area = ? AND created_at >= datetime('now','-90 days')`).get(laneKey))?.c ?? 0;
  const laneScore=Math.min(laneCount/20,1); // 0-1
  const countryRisk={AE:0.1, SA:0.2, OM:0.2, IN:0.5, US:0.1, GB:0.1}[countryCode]??0.3;
  const score = (5-rating)*0.3 + (1-Math.min(completed/50,1))*0.3 + (1-laneScore)*0.2 + countryRisk*0.2; // 0-1
  return Math.round(score*100)/100;
}
function rateForRisk(score){
  // dynamic interest: 8% base + 0-12% risk premium
  return 800 + Math.round(score*1200); // bps
}
router.post('/api/jobs/:id/tokenize', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(req.user.role!=='ADMIN' && job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  const { blNumber, bl_number, faceValueAed } = req.body||{};
  const bl=blNumber||bl_number;
  if(!bl) return sendError(res,400,'blNumber required');
  const face=Number(faceValueAed || job.agreed_price_aed || job.max_budget_aed);
  if(!face) return sendError(res,400,'faceValueAed or agreed price required');
  const laneKey=`${job.pickup_terminal}->${job.delivery_area}`;
  const score=await riskScore({ carrierId: job.carrier_id||job.shipper_id, laneKey, countryCode: job.country_code||'AE' });
  const rate=rateForRisk(score);
  const tokenId=`BLT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const r=await db.prepare(`INSERT INTO debt_instruments (job_id, bl_number, face_value_aed, interest_rate_bps, risk_score, token_id) VALUES (?,?,?,?,?,?) RETURNING id`).run(job.id, String(bl), face, rate, score, tokenId);
  const inst=await db.prepare('SELECT * FROM debt_instruments WHERE id=?').get(Number(r.lastInsertRowid));
  res.status(201).json({ instrument: inst, risk:{ score, rateBps: rate, lane: laneKey }});
});
// Platform-wide, unfiltered — admin only, same reasoning as the audit chain.
router.get('/api/ledger/instruments', auth(['ADMIN']), async (req,res)=>{
  const rows=await db.prepare('SELECT * FROM debt_instruments ORDER BY created_at DESC LIMIT 100').all();
  res.json({ instruments: rows });
});
router.get('/api/jobs/:id/instruments', auth(), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(req.user.role!=='ADMIN' && job.shipper_id!==req.user.id && job.carrier_id!==req.user.id) return sendError(res,403,'Not permitted');
  const rows=await db.prepare('SELECT * FROM debt_instruments WHERE job_id=?').all(req.params.id);
  res.json({ instruments: rows });
});
module.exports = router;

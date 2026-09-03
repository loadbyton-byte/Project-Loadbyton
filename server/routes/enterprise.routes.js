// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */
const db = require('../db');
const apiResponse = require('../lib/apiResponse');
const { auth, requireSeatRole } = require('../middleware/auth');
const { writeAudit, notify } = require('../lib/helpers');
const router = require('express').Router();

// DP World E-Token — carrier pastes/syncs token, shipper auto-notified
router.post('/api/jobs/:id/etoken', auth(['CARRIER']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return apiResponse.error(req,res,'JOB_NOT_FOUND','Job not found');
  if(job.carrier_id!==req.user.id) return apiResponse.error(req,res,'FORBIDDEN','Not your job');
  const { token } = req.body||{};
  if(!token||String(token).trim().length<6) return apiResponse.error(req,res,'VALIDATION_FAILED','E-Token required (min 6 chars)');
  await db.prepare(`UPDATE jobs SET dp_world_e_token=?, updated_at=datetime('now') WHERE id=?`).run(String(token).trim(), job.id);
  await notify(job.shipper_id, 'E-Token locked', `Carrier locked DP World gate slot for ${job.job_code}: ${String(token).trim().slice(0,12)}…`, job.id, 'status');
  await writeAudit(req,{userId:req.actorId, action:'ETOKEN_SET', entityType:'job', entityId:job.id});
  res.json({ ok:true });
});

// EIR 3-photo checklist — Seal, Right, Left — becomes immutable ledger via job_documents
router.post('/api/jobs/:id/eir', auth(['CARRIER']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return apiResponse.error(req,res,'JOB_NOT_FOUND','Job not found');
  if(job.carrier_id!==req.user.id) return apiResponse.error(req,res,'FORBIDDEN','Not your job');
  const { photos } = req.body||{}; // [{title, fileBase64|storageKey, mimeType}]
  if(!Array.isArray(photos)||photos.length!==3) return apiResponse.error(req,res,'VALIDATION_FAILED','EIR requires exactly 3 photos: Seal, Right Side, Left Side');
  const labels=['Seal','Right Side','Left Side'];
  const { resolveUploadedFile } = require('../lib/helpers');
  const stored=[];
  for(let i=0;i<3;i++){
    const p=photos[i];
    if(!(p.fileBase64||p.storageKey)||!p.mimeType) return apiResponse.error(req,res,'VALIDATION_FAILED',`Photo ${i+1} missing fileBase64/storageKey or mimeType`);
    const { storagePath } = await resolveUploadedFile(String(job.id), { mimeType: p.mimeType, fileBase64: p.fileBase64, storageKey: p.storageKey });
    const title = `EIR ${labels[i]} — ${job.job_code}`;
    await db.prepare(`INSERT INTO job_documents (job_id,uploader_id,doc_type,title,file_url,storage_path,mime_type) VALUES (?,?,?,?,?,?,?)`).run(job.id, req.user.id, 'EIR', title, storagePath, storagePath, p.mimeType);
    stored.push(storagePath);
  }
  await db.prepare(`UPDATE jobs SET eir_photos=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(stored), job.id);
  await writeAudit(req,{userId:req.actorId, action:'EIR_UPLOADED', details:`${job.job_code} EIR 3 photos`, entityType:'job', entityId:job.id});
  res.json({ ok:true, photos: stored });
});

// Demurrage/detention alarm check — called by cron or carrier dashboard
router.get('/api/jobs/:id/detention', auth(), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return apiResponse.error(req,res,'JOB_NOT_FOUND','Job not found');
  const free = job.detention_free_days ?? job.free_time_days ?? 5;
  const rate = job.demurrage_rate_aed ?? 400;
  const deliveredAt = job.delivered_at ? new Date(job.delivered_at) : null;
  const now = new Date();
  let daysSinceDelivery = deliveredAt ? Math.floor((now - deliveredAt)/86400000) : 0;
  let daysLeft = free - daysSinceDelivery;
  let status = daysLeft>1 ? 'OK' : daysLeft===1 ? 'DUE_TOMORROW' : daysLeft===0 ? 'DUE_TODAY' : 'OVERDUE';
  let alarm = daysLeft<=1;
  res.json({ jobId: job.id, freeDays: free, rateAed: rate, daysSinceDelivery, daysLeft, status, alarm });
});
// Admin trigger for SMS alarms (24h before penalty)
router.post('/api/system/detention-alarms', async (req,res)=>{
  const key=req.headers['x-internal-key'];
  if(key!==process.env.INTERNAL_KEY && req.user?.role!=='ADMIN') return apiResponse.error(req,res,'NOT_AUTHENTICATED','Internal key required');
  const jobs=await db.prepare(`SELECT * FROM jobs WHERE status IN ('DELIVERED','IN_TRANSIT','PICKED_UP') AND delivered_at IS NOT NULL`).all();
  let alerted=0;
  for(const job of jobs){
    const free=job.detention_free_days??job.free_time_days??5;
    const days = Math.floor((Date.now()-new Date(job.delivered_at))/86400000);
    if(days===free-1){
      const carrier = await db.prepare('SELECT phone FROM profiles WHERE user_id=?').get(job.carrier_id);
      // send via whatsapp/sms stub
      try{ require('../lib/whatsapp').sendTemplate? require('../lib/whatsapp').sendTemplate(carrier?.phone, 'detention_warning', { job: job.job_code, daysLeft:1 }):null;}catch{}
      await notify(job.carrier_id, 'Detention alert', `${job.job_code} empty must return in 24h or AED ${job.demurrage_rate_aed||400}/day penalty applies.`, job.id, 'status');
      alerted++;
    }
  }
  res.json({ alerted });
});

// Fuel/Salik advance — 20% of agreed freight instantly as voucher/wallet
router.post('/api/jobs/:id/fuel-advance', auth(['CARRIER']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return apiResponse.error(req,res,'JOB_NOT_FOUND','Job not found');
  if(job.carrier_id!==req.user.id) return apiResponse.error(req,res,'FORBIDDEN','Not your job');
  const exists=await db.prepare('SELECT 1 FROM fuel_advances WHERE job_id=? AND carrier_id=?').get(job.id, req.user.id);
  if(exists) return apiResponse.error(req,res,'VALIDATION_FAILED','Advance already taken for this job');
  const amount = Math.round((job.agreed_price_aed||job.max_budget_aed||0)*0.20);
  if(amount<=0) return apiResponse.error(req,res,'VALIDATION_FAILED','No agreed price to advance');
  const { type } = req.body||{};
  const t = String(type||'FUEL').toUpperCase();
  if(!['FUEL','SALIK'].includes(t)) return apiResponse.error(req,res,'VALIDATION_FAILED','type must be FUEL or SALIK');
  await db.prepare(`INSERT INTO fuel_advances (job_id,carrier_id,amount_aed,type) VALUES (?,?,?,?)`).run(job.id, req.user.id, amount, t);
  await writeAudit(req,{userId:req.actorId, action:'FUEL_ADVANCE', details:`${job.job_code} ${t} ${amount} AED`, entityType:'job', entityId:job.id});
  res.json({ ok:true, amount, type: t });
});
router.get('/api/jobs/:id/fuel-advances', auth(), async (req,res)=>{
  const rows=await db.prepare('SELECT * FROM fuel_advances WHERE job_id=?').all(req.params.id);
  res.json({ advances: rows });
});

// Driver performance dashboard — carrier's fleet panel
router.get('/api/carrier/fleet', auth(['CARRIER']), async (req,res)=>{
  const jobs=await db.prepare(`SELECT * FROM jobs WHERE carrier_id=? ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  const byDriver={};
  for(const j of jobs){
    const k=j.assigned_driver_name||'Unassigned';
    if(!byDriver[k]) byDriver[k]={ driver:k, jobs:0, completed:0, podClean:0, avgHours:null, _hours:[] };
    byDriver[k].jobs++;
    if(['DELIVERED','COMPLETED'].includes(j.status)) byDriver[k].completed++;
    // POD clean = has POD document
    const hasPod=await db.prepare(`SELECT 1 FROM job_documents WHERE job_id=? AND doc_type='POD'`).get(j.id);
    if(hasPod && ['DELIVERED','COMPLETED'].includes(j.status)) byDriver[k].podClean++;
    if(j.delivered_at && j.created_at){
      const h=(new Date(j.delivered_at)-new Date(j.created_at))/3600000;
      if(Number.isFinite(h)&&h>0) byDriver[k]._hours.push(h);
    }
  }
  const fleet=Object.values(byDriver).map(d=>({ driver:d.driver, jobs:d.jobs, completed:d.completed, completionRate: d.jobs? Math.round(d.completed/d.jobs*100):0, podClean:d.podClean, avgHours: d._hours.length? Math.round(d._hours.reduce((a,b)=>a+b,0)/d._hours.length*10)/10 : null }));
  res.json({ fleet });
});
module.exports = router;

const db = require('../db');
const { sendError } = require('../lib/http');
const { auth, requireSeatRole } = require('../middleware/auth');
const { writeAudit, notify } = require('../lib/helpers');
const router = require('express').Router();

// DP World E-Token — carrier pastes/syncs token, shipper auto-notified
router.post('/api/jobs/:id/etoken', auth(['CARRIER']), (req,res)=>{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.carrier_id!==req.user.id) return sendError(res,403,'Not your job');
  const { token } = req.body||{};
  if(!token||String(token).trim().length<6) return sendError(res,400,'E-Token required (min 6 chars)');
  db.prepare(`UPDATE jobs SET dp_world_e_token=?, updated_at=datetime('now') WHERE id=?`).run(String(token).trim(), job.id);
  notify(job.shipper_id, 'E-Token locked', `Carrier locked DP World gate slot for ${job.job_code}: ${String(token).trim().slice(0,12)}…`, job.id, 'status');
  writeAudit(req,{userId:req.actorId, action:'ETOKEN_SET', entityType:'job', entityId:job.id});
  res.json({ ok:true });
});

// EIR 3-photo checklist — Seal, Right, Left — becomes immutable ledger via job_documents
router.post('/api/jobs/:id/eir', auth(['CARRIER']), (req,res)=>{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.carrier_id!==req.user.id) return sendError(res,403,'Not your job');
  const { photos } = req.body||{}; // [{title, fileBase64, mimeType}]
  if(!Array.isArray(photos)||photos.length!==3) return sendError(res,400,'EIR requires exactly 3 photos: Seal, Right Side, Left Side');
  const labels=['Seal','Right Side','Left Side'];
  const { saveUploadedFile } = require('../lib/helpers');
  const stored=[];
  for(let i=0;i<3;i++){
    const p=photos[i];
    if(!p.fileBase64||!p.mimeType) return sendError(res,400,`Photo ${i+1} missing fileBase64/mimeType`);
    const { storagePath } = saveUploadedFile(job.id, p.mimeType, p.fileBase64);
    const title = `EIR ${labels[i]} — ${job.job_code}`;
    db.prepare(`INSERT INTO job_documents (job_id,uploader_id,doc_type,title,file_url,storage_path,mime_type) VALUES (?,?,?,?,?,?,?)`).run(job.id, req.user.id, 'EIR', title, storagePath, storagePath, p.mimeType);
    stored.push(storagePath);
  }
  db.prepare(`UPDATE jobs SET eir_photos=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(stored), job.id);
  writeAudit(req,{userId:req.actorId, action:'EIR_UPLOADED', details:`${job.job_code} EIR 3 photos`, entityType:'job', entityId:job.id});
  res.json({ ok:true, photos: stored });
});

// Demurrage/detention alarm check — called by cron or carrier dashboard
router.get('/api/jobs/:id/detention', auth(), (req,res)=>{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
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
router.post('/api/system/detention-alarms', (req,res)=>{
  const key=req.headers['x-internal-key'];
  if(key!==process.env.INTERNAL_KEY && req.user?.role!=='ADMIN') return sendError(res,401,'Internal key required');
  const jobs=db.prepare(`SELECT * FROM jobs WHERE status IN ('DELIVERED','IN_TRANSIT','PICKED_UP') AND delivered_at IS NOT NULL`).all();
  let alerted=0;
  for(const job of jobs){
    const free=job.detention_free_days??job.free_time_days??5;
    const days = Math.floor((Date.now()-new Date(job.delivered_at))/86400000);
    if(days===free-1){
      const carrier = db.prepare('SELECT phone FROM profiles WHERE user_id=?').get(job.carrier_id);
      // send via whatsapp/sms stub
      try{ require('../lib/whatsapp').sendTemplate? require('../lib/whatsapp').sendTemplate(carrier?.phone, 'detention_warning', { job: job.job_code, daysLeft:1 }):null;}catch{}
      notify(job.carrier_id, 'Detention alert', `${job.job_code} empty must return in 24h or AED ${job.demurrage_rate_aed||400}/day penalty applies.`, job.id, 'status');
      alerted++;
    }
  }
  res.json({ alerted });
});

// Fuel/Salik advance — 20% of agreed freight instantly as voucher/wallet
router.post('/api/jobs/:id/fuel-advance', auth(['CARRIER']), (req,res)=>{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.carrier_id!==req.user.id) return sendError(res,403,'Not your job');
  const exists=db.prepare('SELECT 1 FROM fuel_advances WHERE job_id=? AND carrier_id=?').get(job.id, req.user.id);
  if(exists) return sendError(res,400,'Advance already taken for this job');
  const amount = Math.round((job.agreed_price_aed||job.max_budget_aed||0)*0.20);
  if(amount<=0) return sendError(res,400,'No agreed price to advance');
  const { type } = req.body||{};
  const t = String(type||'FUEL').toUpperCase();
  if(!['FUEL','SALIK'].includes(t)) return sendError(res,400,'type must be FUEL or SALIK');
  db.prepare(`INSERT INTO fuel_advances (job_id,carrier_id,amount_aed,type) VALUES (?,?,?,?)`).run(job.id, req.user.id, amount, t);
  writeAudit(req,{userId:req.actorId, action:'FUEL_ADVANCE', details:`${job.job_code} ${t} ${amount} AED`, entityType:'job', entityId:job.id});
  res.json({ ok:true, amount, type: t });
});
router.get('/api/jobs/:id/fuel-advances', auth(), (req,res)=>{
  const rows=db.prepare('SELECT * FROM fuel_advances WHERE job_id=?').all(req.params.id);
  res.json({ advances: rows });
});

// Driver performance dashboard — carrier's fleet panel
router.get('/api/carrier/fleet', auth(['CARRIER']), (req,res)=>{
  const jobs=db.prepare(`SELECT * FROM jobs WHERE carrier_id=? ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  const byDriver={};
  for(const j of jobs){
    const k=j.assigned_driver_name||'Unassigned';
    if(!byDriver[k]) byDriver[k]={ driver:k, jobs:0, completed:0, podClean:0, avgHours:null, _hours:[] };
    byDriver[k].jobs++;
    if(['DELIVERED','COMPLETED'].includes(j.status)) byDriver[k].completed++;
    // POD clean = has POD document
    const hasPod=db.prepare(`SELECT 1 FROM job_documents WHERE job_id=? AND doc_type='POD'`).get(j.id);
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

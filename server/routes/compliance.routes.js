const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const crypto = require('node:crypto');
const router = require('express').Router();

function validateHsCode(hs){
  // HS 6-10 digits, real: WCO HS nomenclature API
  return /^\d{6,10}$/.test(String(hs||'').replace(/\s/g,''));
}
function zkCommit(manifest){
  // Simulated ZKP commitment: SHA-256(manifest + salt) — real: snarkjs Groth16
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.createHash('sha256').update(JSON.stringify(manifest)+salt).digest('hex');
  const proof=`zkp:groth16:${crypto.createHash('sha256').update(hash+salt).digest('hex').slice(0,32)}`;
  return { manifestHash: hash, zkProof: proof, salt };
}
router.post('/api/jobs/:id/compliance', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  // Was missing — any authenticated SHIPPER could file a customs
  // declaration against any other shipper's job by id.
  if(req.user.role!=='ADMIN' && job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  const { hsCode, hs_code, manifest } = req.body||{};
  const hs=hsCode||hs_code;
  if(!validateHsCode(hs)) return sendError(res,400,'hsCode must be 6-10 digit HS classification');
  const m=manifest||{ job: job.job_code, hs, origin: job.pickup_terminal, dest: job.delivery_area };
  const { manifestHash, zkProof } = zkCommit(m);
  const r=await db.prepare(`INSERT INTO compliance_declarations (job_id, hs_code, manifest_hash, zk_proof, status) VALUES (?,?,?,?, 'PENDING') RETURNING id`).run(job.id, String(hs), manifestHash, zkProof);
  // simulate sovereign tax webhook async
  setTimeout(()=>{
    try{
      const hook=process.env.TAX_CLEARING_WEBHOOK;
      if(hook) fetch(hook,{method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jobId: job.id, hs, manifestHash, event:'declaration.created' })}).catch(()=>{});
    }catch{}
  },0);
  const decl=await db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(Number(r.lastInsertRowid));
  res.status(201).json({ declaration: decl, manifest: m });
});
router.post('/api/compliance/:id/clear', auth(['ADMIN']), async (req,res)=>{
  await db.prepare(`UPDATE compliance_declarations SET status='CLEARED', cleared_at=datetime('now') WHERE id=?`).run(req.params.id);
  const d=await db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(req.params.id);
  if(!d) return sendError(res,404,'Declaration not found');
  res.json({ declaration: d });
});
router.get('/api/jobs/:id/compliance', auth(), async (req,res)=>{
  const job = await db.prepare('SELECT shipper_id, carrier_id FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  // Was missing entirely — any logged-in user could read another
  // company's HS code / customs manifest-hash declarations by job id.
  const permitted = req.user.role==='ADMIN' || job.shipper_id===req.user.id || job.carrier_id===req.user.id;
  if(!permitted) return sendError(res,403,'Not permitted');
  const rows=await db.prepare('SELECT * FROM compliance_declarations WHERE job_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json({ declarations: rows });
});
module.exports = router;

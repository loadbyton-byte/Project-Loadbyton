const crypto = require('node:crypto');
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
// Verified chain: each audit row's hash = sha(prevHash|action|entity|timestamp)
router.get('/api/audit/chain/verify', auth(['ADMIN']), async (req,res)=>{
  const rows=await db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  let prev='GENESIS';
  let ok=true; let brokenAt=null;
  for(const r of rows){
    const expected=sha256(`${prev}|${r.action}|${r.entity_type||''}|${r.entity_id||''}|${r.created_at}`);
    if(r.hash && r.hash!==expected){ ok=false; brokenAt=r.id; break; }
    prev=r.hash||expected;
  }
  res.json({ ok, brokenAt, length: rows.length, head: prev });
});
router.get('/api/audit/chain', auth(['ADMIN']), async (req,res)=>{
  const rows=await db.prepare('SELECT id, action, entity_type, entity_id, hash, prev_hash, created_at FROM audit_log ORDER BY id DESC LIMIT 100').all();
  res.json({ chain: rows });
});
module.exports = router;

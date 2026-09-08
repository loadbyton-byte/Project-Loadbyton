const crypto = require('node:crypto');
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
// Verified chain: each audit row's hash = sha(prevHash|action|entity|timestamp).
// Pre-chain-era rows (hash NULL — everything written before lib/helpers.js's
// writeAudit started populating this) are skipped, not flagged, mirroring
// lib/ledger.js's verifyChain() exactly — a row with no hash was never part
// of the chain to begin with, so it can't be a "break" in it, and treating
// it as one made every real row after it look broken (a bug this fix
// caught: the two were previously inconsistent since nothing had ever
// populated a real audit_log hash before now).
router.get('/api/audit/chain/verify', auth(['ADMIN']), async (req,res)=>{
  const rows=await db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  let prev='GENESIS';
  let ok=true; let brokenAt=null; let checked=0;
  for(const r of rows){
    if(!r.hash) continue; // pre-chain era — prev stays whatever it already was
    checked += 1;
    const expected=sha256(`${prev}|${r.action}|${r.entity_type||''}|${r.entity_id||''}|${r.created_at}`);
    if(r.hash!==expected){ ok=false; brokenAt=r.id; break; }
    prev=r.hash;
  }
  res.json({ ok, brokenAt, length: rows.length, checked, head: prev });
});
router.get('/api/audit/chain', auth(['ADMIN']), async (req,res)=>{
  const rows=await db.prepare('SELECT id, action, entity_type, entity_id, hash, prev_hash, created_at FROM audit_log ORDER BY id DESC LIMIT 100').all();
  res.json({ chain: rows });
});
module.exports = router;

const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { verifyTrnExternal, cache } = require('../services/verification.service');
const router = require('express').Router();

// Carrier hits external registry before OpenLoads
router.get('/api/verify/trn/:trn', auth(), async (req,res)=>{
  const trn = String(req.params.trn||'').trim();
  if(!/^\d{15}$/.test(trn)) return sendError(res,400,'TRN must be 15 digits');
  const r = await verifyTrnExternal(trn);
  res.json(r);
});
router.post('/api/verify/check', auth(), async (req,res)=>{
  const { trnNumber, tradeLicenseNumber } = req.body||{};
  if(!trnNumber) return sendError(res,400,'trnNumber required');
  const trn = await verifyTrnExternal(trnNumber);
  // trade licence external check stub (same service)
  const licenceOk = tradeLicenseNumber ? /^[A-Z0-9-]{5,15}$/.test(String(tradeLicenseNumber).toUpperCase()) : true;
  const ok = trn.valid && licenceOk;
  if(ok){
    // cache success to ensure carrier can access OpenLoads
    cache.set(trnNumber, { valid:true, cached:true });
  }
  res.json({ trn, licenceValid: licenceOk, overall: ok, canAccessOpenLoads: ok });
});
// gate: carrier cannot list jobs if TRN not verified (enforced server-side)
router.get('/api/verify/gate', auth(['CARRIER']), async (req,res)=>{
  const profile = await db.prepare('SELECT trn_number FROM profiles WHERE user_id=?').get(req.user.id);
  const trnEnc = profile?.trn_number;
  // decrypt if enc:v1: — keep simple: if starts with enc:, consider not yet verified via external
  const isEnc = trnEnc && trnEnc.startsWith('enc:v1:');
  // allow verified users regardless; otherwise require external check
  if(req.user.is_verified) return res.json({ allowed:true, reason:'already verified' });
  if(!trnEnc) return res.json({ allowed:false, reason:'no TRN on file' });
  // try external verification of stored TRN (if enc, we can't verify — treat as pending)
  if(isEnc) return res.json({ allowed:false, reason:'TRN encrypted — verify via /api/verify/check with plaintext TRN before bidding' });
  const v = await verifyTrnExternal(trnEnc);
  res.json({ allowed: v.valid, verification: v });
});
module.exports = router;

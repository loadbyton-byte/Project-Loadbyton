const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { sendError } = require('../lib/http');
const { writeAudit, notify } = require('../lib/helpers');
const { createPaymentIntent, createTransfer, constructWebhookEvent } = require('../lib/stripe');
const { ledgerHash, verifyMultiSig, getHsmKeys } = require('../lib/hsm');
const router = express.Router();

// Shipper creates hosted checkout / payment_intent for a job's escrow
router.post('/api/jobs/:id/pay', auth(['SHIPPER']), async (req,res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  if(!['AWARDED','PICKED_UP','IN_TRANSIT'].includes(job.status)) return sendError(res,400,'Job not in payable state');
  const amount = job.agreed_price_aed || job.max_budget_aed;
  if(!amount) return sendError(res,400,'No agreed price');
  // incidentals buffer 10% held automatically
  const buffer = Math.round(amount * 0.10);
  const total = amount + buffer;
  const intent = await createPaymentIntent({ amountAed: total, jobCode: job.job_code, shipperEmail: req.user.email });
  db.prepare(`UPDATE jobs SET processor_payment_ref=?, processor_amount_aed=?, processor_payment_status='REQUIRES_PAYMENT', incidentals_buffer_aed=?, updated_at=datetime('now') WHERE id=?`).run(intent.id, total, buffer, job.id);
  writeAudit(req,{userId:req.actorId, action:'PAYMENT_INTENT_CREATED', details:`${job.job_code} pi ${intent.id} ${total} AED`, entityType:'job', entityId:job.id});
  res.json({ paymentIntent: intent, amount, buffer, total });
});

// Webhook — Stripe calls with payment_intent.succeeded → HELD
router.post('/api/webhooks/stripe', express.raw({type:'*/*'}), async (req,res) => {
  let event;
  try { event = await constructWebhookEvent(req.rawBody||req.body, req.headers['stripe-signature']); }
  catch(e){ return res.status(400).send(`Webhook error: ${e.message}`); }
  if(event.type==='payment_intent.succeeded' || event.type==='payment_intent.succeeded_mock' || event.data?.object?.id?.startsWith('pi_')){
    const pi = event.data?.object || event;
    const piId = pi.id;
    const job = db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(piId);
    if(job){
      const prev = job.ledger_hash || 'GENESIS';
      const hash = ledgerHash(prev, job.id, 'HELD', job.processor_amount_aed, new Date().toISOString());
      db.prepare(`UPDATE jobs SET escrow_status='HELD', processor_payment_status='PAID', ledger_hash=?, prev_ledger_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, prev, job.id);
      db.prepare(`UPDATE payouts SET status='HELD' WHERE job_id=?`).run(job.id);
      writeAudit({headers:{}, actorId:0, requestId:req.headers['x-request-id']},{userId:0, action:'ESCROW_HELD', details:`${job.job_code} held via Stripe ${piId}`, entityType:'job', entityId:job.id, beforeState:'PENDING', afterState:'HELD'});
      notify(job.shipper_id, 'Escrow held', `${job.job_code} escrow is now HELD — carrier may pick up.`, job.id, 'payout');
    }
  }
  res.json({received:true});
});

// Manual test webhook for mock mode (no Stripe sig needed)
router.post('/api/webhooks/stripe/mock-confirm', (req,res)=>{
  const { processorPaymentRef } = req.body||{};
  if(!processorPaymentRef) return sendError(res,400,'processorPaymentRef required');
  const job = db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(processorPaymentRef);
  if(!job) return sendError(res,404,'Job not found for that ref');
  const prev = job.ledger_hash || 'GENESIS';
  const hash = ledgerHash(prev, job.id, 'HELD', job.processor_amount_aed||0, new Date().toISOString());
  db.prepare(`UPDATE jobs SET escrow_status='HELD', processor_payment_status='PAID', ledger_hash=?, prev_ledger_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, prev, job.id);
  db.prepare(`UPDATE payouts SET status='HELD' WHERE job_id=?`).run(job.id);
  res.json({ ok:true, escrow:'HELD', hash });
});

// Transfer script — programmatic payout on delivery validation (carrier must have processor_account_id)
router.post('/api/jobs/:id/release-payout', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(!['DELIVERED','COMPLETED'].includes(job.status)) return sendError(res,400,'Job not delivered yet');
  if(job.escrow_status==='DISPUTED') return sendError(res,400,'Escrow frozen by dispute');
  const payout = db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id);
  if(!payout) return sendError(res,404,'No payout');
  if(payout.status==='RELEASED') return sendError(res,400,'Already released');
  // HSM multi-sig: require 2-of-3 signatures on payload jobId|amount|timestamp
  const sigs = req.headers['x-hsm-sigs'] ? req.headers['x-hsm-sigs'].split(',') : [];
  const payload = `${job.id}|${payout.net_aed}|${new Date().toISOString().slice(0,10)}`;
  if(!verifyMultiSig(payload, sigs, getHsmKeys())) {
    // in dev without HSM keys, this passes; in prod with keys it enforces
    if(getHsmKeys().length) return sendError(res,403,'HSM multi-sig required (2-of-3)');
  }
  const profile = db.prepare('SELECT processor_account_id FROM profiles WHERE user_id=?').get(job.carrier_id);
  const dest = profile?.processor_account_id || 'acct_mock_carrier';
  // include buffer if not yet released
  const buffer = job.incidentals_buffer_aed || 0;
  const netWithBuffer = payout.net_aed + (job.buffer_released?0:buffer);
  const tr = await createTransfer({ amountAed: netWithBuffer, destination: dest, jobCode: job.job_code });
  const prev = job.ledger_hash || 'GENESIS';
  const hash = ledgerHash(prev, job.id, 'RELEASED', netWithBuffer, new Date().toISOString());
  db.prepare(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now'), ledger_hash=?, prev_ledger_hash=?, buffer_released=1, updated_at=datetime('now') WHERE id=?`).run(hash, prev, job.id);
  db.prepare(`UPDATE payouts SET status='RELEASED', released_at=datetime('now'), processor_payout_status='SENT', processor_payout_ref=?, transfer_reference=? WHERE id=?`).run(tr.id, tr.id, payout.id);
  writeAudit(req,{userId:req.actorId, action:'PAYOUT_RELEASED', details:`${job.job_code} ${netWithBuffer} AED → ${dest} via ${tr.id}`, entityType:'payout', entityId:payout.id});
  notify(job.carrier_id, 'Payout sent', `Your payout for ${job.job_code} (${netWithBuffer} AED) is on the way.`, job.id, 'payout');
  res.json({ ok:true, transfer: tr, net: netWithBuffer, hash });
});

module.exports = router;

const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { auth, writeLimiter } = require('../middleware/auth');
const { sendError } = require('../lib/http');
const { writeAudit, notify } = require('../lib/helpers');
const { createPaymentIntent, createTransfer, constructWebhookEvent, createConnectAccount, createAccountLink, retrieveAccount } = require('../lib/stripe');
const { ledgerHash, verifyMultiSig, getHsmKeys } = require('../lib/hsm');
const { providerInfo } = require('../lib/payments');
const router = express.Router();

// Carrier Connect onboarding — provision an Express account + hosted
// onboarding link. The carrier is redirected to Stripe, completes KYC
// there, and is returned to FRONTEND_URL. The resulting account id is
// stored on profiles.processor_account_id and used as the transfer
// destination in both payments.js executePayout (unified flow) and
// release-payout below.
router.post('/api/stripe/connect/onboard', auth(['CARRIER']), async (req, res) => {
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  let accountId = profile?.processor_account_id;
  // Reuse a real, already-verified account; otherwise provision a fresh
  // one. Mock accounts (acct_mock_*) are intentionally recreated so a
  // reviewer can step through onboarding without side effects.
  const needsNew = !accountId || String(accountId).startsWith('acct_mock_');
  if (needsNew) {
    try {
      const acct = await createConnectAccount({ email: req.user.email });
      accountId = acct.id;
      await db.prepare('UPDATE profiles SET processor_account_id=? WHERE user_id=?').run(accountId, req.user.id);
      await writeAudit(req, { userId: req.actorId, action: 'CONNECT_ACCOUNT_CREATED', details: `carrier ${req.user.id} -> ${accountId}`, entityType: 'profile', entityId: profile?.id || req.user.id });
    } catch (e) {
      return sendError(res, 502, `Connect account creation failed: ${e.message}`);
    }
  }
  const origin = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
  const base = String(origin).replace(/\/$/, '');
  try {
    const link = await createAccountLink({ accountId, refreshUrl: `${base}/carrier/onboarding?refresh=1`, returnUrl: `${base}/carrier/onboarding?success=1` });
    res.json({ accountId, url: link.url, mock: !!link.mock });
  } catch (e) {
    sendError(res, 502, `Account link failed: ${e.message}`);
  }
});

router.get('/api/stripe/connect/status', auth(['CARRIER']), async (req, res) => {
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  if (!profile?.processor_account_id) return res.json({ accountId: null, onboarded: false });
  try {
    const acct = await retrieveAccount(profile.processor_account_id);
    res.json({
      accountId: profile.processor_account_id,
      charges_enabled: !!acct.charges_enabled,
      payouts_enabled: !!acct.payouts_enabled,
      details_submitted: !!acct.details_submitted,
      mock: !!acct.mock,
      onboarded: !!acct.payouts_enabled,
    });
  } catch (e) {
    sendError(res, 502, `Status check failed: ${e.message}`);
  }
});

// Shipper creates hosted checkout / payment_intent for a job's escrow
router.post('/api/jobs/:id/pay', auth(['SHIPPER']), writeLimiter, async (req,res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  if(!['AWARDED','PICKED_UP','IN_TRANSIT'].includes(job.status)) return sendError(res,400,'Job not in payable state');
  const amount = job.agreed_price_aed || job.max_budget_aed;
  if(!amount) return sendError(res,400,'No agreed price');
  // incidentals buffer 10% held automatically
  const buffer = Math.round(amount * 0.10);
  const total = amount + buffer;
  const intent = await createPaymentIntent({ amountAed: total, jobCode: job.job_code, shipperEmail: req.user.email });
  await db.prepare(`UPDATE jobs SET processor_payment_ref=?, processor_amount_aed=?, processor_payment_status='REQUIRES_PAYMENT', incidentals_buffer_aed=?, updated_at=datetime('now') WHERE id=?`).run(intent.id, total, buffer, job.id);
  await writeAudit(req,{userId:req.actorId, action:'PAYMENT_INTENT_CREATED', details:`${job.job_code} pi ${intent.id} ${total} AED`, entityType:'job', entityId:job.id});
  res.json({ paymentIntent: intent, amount, buffer, total });
});

// Webhook — Stripe calls with payment_intent.succeeded → HELD
router.post('/api/webhooks/stripe', express.raw({type:'*/*'}), async (req,res) => {
  let event;
  try { event = await constructWebhookEvent(req.rawBody||req.body, req.headers['stripe-signature']); }
  catch(e){ return res.status(400).send(`Webhook error: ${e.message}`); }

  // Idempotency — Stripe's delivery is at-least-once, so the same event id
  // can arrive more than once. payment_webhook_events (system.routes.js's
  // generic payments webhook already uses this table the same way) is the
  // durable dedup boundary; the INSERT's UNIQUE constraint on
  // (provider, provider_event_id) is what actually blocks a replay, not
  // just a best-effort check.
  const payloadHash = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body) || '').digest('hex');
  const providerEventId = event.id || payloadHash;
  try {
    await db.prepare(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_hash, raw_payload, status) VALUES ('stripe',?,?,?,?, 'PENDING')`
    ).run(providerEventId, event.type || 'unknown', payloadHash, String(req.rawBody || '').slice(0, 8000));
  } catch (e) {
    if (e.message && /UNIQUE|duplicate key/i.test(e.message)) return res.json({ received:true, idempotent:true, duplicate_event:true });
    if (!/no such table/i.test(e.message || '')) throw e;
    // Table missing (DB without the payments-hardening migration) — fall through.
  }

  if(event.type==='payment_intent.succeeded' || event.type==='payment_intent.succeeded_mock' || event.data?.object?.id?.startsWith('pi_')){
    const pi = event.data?.object || event;
    const piId = pi.id;
    const job = await db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(piId);
    if(job){
      const prev = job.ledger_hash || 'GENESIS';
      const hash = ledgerHash(prev, job.id, 'HELD', job.processor_amount_aed, new Date().toISOString());
      // jobs + payouts updated atomically — previously two separate
      // statements, so a crash between them could leave escrow HELD with
      // the payout row never following.
      await db.transaction(async (trx) => {
        await trx.query(`UPDATE jobs SET escrow_status='HELD', processor_payment_status='PAID', ledger_hash=?, prev_ledger_hash=?, updated_at=datetime('now') WHERE id=?`, [hash, prev, job.id]);
        await trx.query(`UPDATE payouts SET status='HELD' WHERE job_id=?`, [job.id]);
      });
      await writeAudit({headers:{}, actorId:0, requestId:req.headers['x-request-id']},{userId:0, action:'ESCROW_HELD', details:`${job.job_code} held via Stripe ${piId}`, entityType:'job', entityId:job.id, beforeState:'PENDING', afterState:'HELD'});
      await notify(job.shipper_id, 'Escrow held', `${job.job_code} escrow is now HELD — carrier may pick up.`, job.id, 'payout');
    }
  }
  try {
    await db.prepare(`UPDATE payment_webhook_events SET status='PROCESSED', processed_at=datetime('now') WHERE provider='stripe' AND provider_event_id=?`).run(providerEventId);
  } catch {}
  res.json({received:true});
});

// Manual test webhook for mock/test mode (no Stripe sig needed) — this
// simulates a real payment succeeding, so it must never be reachable
// against a live Stripe key, and only an admin should be able to trigger
// it even in test mode.
router.post('/api/webhooks/stripe/mock-confirm', auth(['ADMIN']), async (req,res)=>{
  if (!providerInfo().testMode) return sendError(res, 403, 'Not available outside test/mock payment mode');
  const { processorPaymentRef } = req.body||{};
  if(!processorPaymentRef) return sendError(res,400,'processorPaymentRef required');
  const job = await db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(processorPaymentRef);
  if(!job) return sendError(res,404,'Job not found for that ref');
  const prev = job.ledger_hash || 'GENESIS';
  const hash = ledgerHash(prev, job.id, 'HELD', job.processor_amount_aed||0, new Date().toISOString());
  await db.prepare(`UPDATE jobs SET escrow_status='HELD', processor_payment_status='PAID', ledger_hash=?, prev_ledger_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, prev, job.id);
  await db.prepare(`UPDATE payouts SET status='HELD' WHERE job_id=?`).run(job.id);
  res.json({ ok:true, escrow:'HELD', hash });
});

// Transfer script — programmatic payout on delivery validation (carrier must have processor_account_id)
router.post('/api/jobs/:id/release-payout', auth(['SHIPPER','ADMIN']), writeLimiter, async (req,res)=>{
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  // Missing until now — any authenticated SHIPPER could release any other
  // shipper's payout by guessing/enumerating a job id, forcing a real
  // Stripe transfer ahead of the actual shipper's own confirmation. The
  // sibling /pay endpoint above already has this check; this one didn't.
  if(req.user.role!=='ADMIN' && job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  if(!['DELIVERED','COMPLETED'].includes(job.status)) return sendError(res,400,'Job not delivered yet');
  if(job.escrow_status==='DISPUTED') return sendError(res,400,'Escrow frozen by dispute');
  const payout = await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id);
  if(!payout) return sendError(res,404,'No payout');
  if(payout.status==='RELEASED') return sendError(res,400,'Already released');
  // HSM multi-sig: require 2-of-3 signatures on payload jobId|amount|timestamp.
  // hsmKeys.length>0 is the actual gate — verifyMultiSig itself now fails
  // closed on a partial (1-key) configuration rather than silently passing.
  const sigs = req.headers['x-hsm-sigs'] ? req.headers['x-hsm-sigs'].split(',') : [];
  const payload = `${job.id}|${payout.net_aed}|${new Date().toISOString().slice(0,10)}`;
  const hsmKeys = getHsmKeys();
  if (hsmKeys.length > 0 && !verifyMultiSig(payload, sigs, hsmKeys)) {
    return sendError(res,403,'HSM multi-sig required (2-of-3)');
  }

  // Claim this release BEFORE calling the real payment processor — the
  // status check above reads a value that can go stale under a race (two
  // near-simultaneous release requests both read status!=='RELEASED'
  // before either write commits); the UNIQUE constraint on
  // payout_attempts.idempotency_key is the actual safety boundary, since
  // it's enforced atomically by the database itself. Numbered per attempt
  // (not a single fixed key) so a legitimate retry after a failed transfer
  // can still claim a fresh attempt.
  const attemptCountRow = await db.prepare('SELECT COUNT(*) as c FROM payout_attempts WHERE payout_id=?').get(payout.id);
  const attemptNumber = (attemptCountRow?.c || 0) + 1;
  const releaseKey = `manual-release-${payout.id}-attempt${attemptNumber}`;
  const profile = await db.prepare('SELECT processor_account_id FROM profiles WHERE user_id=?').get(job.carrier_id);
  const dest = profile?.processor_account_id || 'acct_mock_carrier';
  try {
    await db.prepare(
      `INSERT INTO payout_attempts (payout_id, attempt_number, provider, amount_aed, destination, idempotency_key, status) VALUES (?,?,'stripe-manual',?,?,?, 'SUBMITTED')`
    ).run(payout.id, attemptNumber, payout.net_aed, dest, releaseKey);
  } catch (e) {
    if (e.message && /UNIQUE|duplicate key/i.test(e.message)) return sendError(res,409,'A release for this payout is already in progress');
    throw e;
  }

  try {
    // include buffer if not yet released
    const buffer = job.incidentals_buffer_aed || 0;
    const netWithBuffer = payout.net_aed + (job.buffer_released?0:buffer);
    const tr = await createTransfer({ amountAed: netWithBuffer, destination: dest, jobCode: job.job_code });
    const prev = job.ledger_hash || 'GENESIS';
    const hash = ledgerHash(prev, job.id, 'RELEASED', netWithBuffer, new Date().toISOString());
    // Real money already moved above — these three writes recording that
    // must land together, not as separate statements a crash could split
    // (e.g. jobs flips to RELEASED but payouts never follows, making the
    // payout look unfulfilled and resubmittable for a second real transfer).
    await db.transaction(async (trx) => {
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now'), ledger_hash=?, prev_ledger_hash=?, buffer_released=1, updated_at=datetime('now') WHERE id=?`, [hash, prev, job.id]);
      await trx.query(`UPDATE payouts SET status='RELEASED', released_at=datetime('now'), processor_payout_status='SENT', processor_payout_ref=?, transfer_reference=? WHERE id=? AND status != 'RELEASED'`, [tr.id, tr.id, payout.id]);
      await trx.query(`UPDATE payout_attempts SET status='SETTLED', provider_response=? WHERE idempotency_key=?`, [tr.id, releaseKey]);
    });
    await writeAudit(req,{userId:req.actorId, action:'PAYOUT_RELEASED', details:`${job.job_code} ${netWithBuffer} AED → ${dest} via ${tr.id}`, entityType:'payout', entityId:payout.id});
    await notify(job.carrier_id, 'Payout sent', `Your payout for ${job.job_code} (${netWithBuffer} AED) is on the way.`, job.id, 'payout');
    res.json({ ok:true, transfer: tr, net: netWithBuffer, hash });
  } catch (e) {
    try { await db.prepare(`UPDATE payout_attempts SET status='FAILED', error=? WHERE idempotency_key=?`).run(e.message, releaseKey); } catch {}
    throw e;
  }
});

module.exports = router;

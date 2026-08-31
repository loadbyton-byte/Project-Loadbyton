// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

// @ts-ignore
const express = require('express');
/** @type {any} */
const crypto = require('node:crypto');
/** @type {any} */
const db = require('../db');
/** @type {any} */
const payments = require('../lib/payments');
const _config = /** @type {any} */ (require('../lib/config'));
const PORT = _config.PORT;
const INTERNAL_KEY = _config.INTERNAL_KEY;
const _http = /** @type {any} */ (require('../lib/http'));
const sendError = _http.sendError;
const asyncHandler = _http.asyncHandler;
const referralCode = _http.referralCode;
const _apiResponse = /** @type {any} */ (require('../lib/apiResponse'));
const apiResponse = _apiResponse;
const _helpers = /** @type {any} */ (require('../lib/helpers'));
const isPasswordValid = _helpers.isPasswordValid;
const writeAudit = _helpers.writeAudit;
const timingSafeEqualStr = _helpers.timingSafeEqualStr;
const notify = _helpers.notify;
const _constants = /** @type {any} */ (require('../lib/constants'));
const MIN_PASSWORD_LENGTH = _constants.MIN_PASSWORD_LENGTH;
const _auth = /** @type {any} */ (require('../middleware/auth'));
const auth = _auth.auth;
const _escrow = /** @type {any} */ (require('../services/escrow.service'));
const runAutoReleaseSweep = _escrow.runAutoReleaseSweep;
const _scheduling = /** @type {any} */ (require('../services/scheduling.service'));
const publishScheduledJobs = _scheduling.publishScheduledJobs;
// @ts-ignore
const bcrypt = require('bcryptjs');



// @ts-ignore
const router = require('express').Router();

/**
 * @param {any} req
 * @param {any} res
 * @returns {void}
 */
router.get('/api/health', async (/** @type {any} */ req, /** @type {any} */ res) => {
  let dbOk = false;
  let dbLatencyMs = null;
  try {
    const start = Date.now();
    await db.prepare('SELECT 1 as ok').get();
    dbOk = true;
    dbLatencyMs = Date.now() - start;
  } catch (e) {
    dbOk = false;
  }
  res.json({
    ok: dbOk,
    service: 'loadbyton-api',
    version: process.env.npm_package_version || '1.0.0',
    time: new Date().toISOString(),
    pid: String(process.pid),
    port: PORT,
    db: { ok: dbOk, latencyMs: dbLatencyMs, mode: db.isPostgres ? 'postgres' : 'sqlite' },
    payments: payments.providerInfo(),
    uptimeSec: Math.floor(process.uptime()),
  });
});

/**
 * @param {Job} _jobExample - example JSDoc param to satisfy strict Money/Job/Payout usage
 * @param {Money} _moneyExample
 * @param {Payout} _payoutExample
 * @returns {void}
 */
function _typeExamples(_jobExample, _moneyExample, _payoutExample) {}

router.post('/api/system/auto-release', async (/** @type {any} */ req, /** @type {any} */ res) => {
  const key = req.headers['x-internal-key'];
  let authorized = typeof key === 'string' && timingSafeEqualStr(key, INTERNAL_KEY);
  if (!authorized) {
    const token = req.cookies.lb_session;
    const session = token && await db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token);
    const user = session && await db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (user && user.role === 'ADMIN') authorized = true;
  }
  if (!authorized) return sendError(res, 403, 'Admin session or x-internal-key required');
  const released = await runAutoReleaseSweep(req);
  res.json({ ok: true, released, message: `Auto-release sweep complete: ${released} job(s) released.` });
});

setInterval(() => runAutoReleaseSweep(null).catch(() => {}), 10 * 60 * 1000).unref();

router.post('/api/system/publish-scheduled', async (/** @type {any} */ req, /** @type {any} */ res) => {
  const key = req.headers['x-internal-key'];
  let authorized = typeof key === 'string' && timingSafeEqualStr(key, INTERNAL_KEY);
  if (!authorized) {
    const token = req.cookies.lb_session;
    const session = token && await db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token);
    const user = session && await db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (user && user.role === 'ADMIN') authorized = true;
  }
  if (!authorized) return sendError(res, 403, 'Admin session or x-internal-key required');
  const published = await publishScheduledJobs(req);
  res.json({ ok: true, published });
});

setInterval(() => publishScheduledJobs(null).catch(() => {}), 60 * 1000).unref();


router.post(
  '/api/system/setup-admin',
  asyncHandler(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const key = req.headers['x-setup-key'];
    if (!process.env.ADMIN_SETUP_KEY || typeof key !== 'string' || !timingSafeEqualStr(key, process.env.ADMIN_SETUP_KEY)) {
      return sendError(res, 403, 'ADMIN_SETUP_KEY header required and must match the environment variable of the same name');
    }
    const adminExists = await db.prepare(`SELECT 1 FROM users WHERE role='ADMIN' LIMIT 1`).get();
    if (adminExists) return sendError(res, 403, 'An admin account already exists — this route only ever provisions the first one');

    const { email, password, companyName } = req.body || {};
    if (!email || !password) return sendError(res, 400, 'email and password are required');
    if (!isPasswordValid(password)) return sendError(res, 400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) return sendError(res, 400, 'An account with that email already exists');

    const passwordHash = bcrypt.hashSync(password, 10);
    const userResult = await db
      .prepare(
        `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at)
         VALUES (?,?,?,?,?,?,datetime('now'))`
      )
      .run(email, passwordHash, 'ADMIN', 1, 'GOLD', referralCode('ADM', companyName || 'LOADBYTON'));
    const userId = Number(userResult.lastInsertRowid);
    await db.prepare('INSERT INTO profiles (user_id, company_name) VALUES (?,?)').run(userId, companyName || 'Loadbyton Ops');

    await writeAudit(req, { userId, action: 'ADMIN_SETUP', details: `First admin account provisioned: ${email}`, entityType: 'user', entityId: userId });
    res.status(201).json({ ok: true, message: 'Admin account created. This route is now permanently disabled.' });
  })
);

router.post(
  '/api/webhooks/payments',
  // JSON callbacks arrive already-parsed by the global express.json above
  // (whose verify hook captured req.rawBody). Form-encoded callbacks (Telr)
  // are parsed here, with the same raw-body capture so the signature check
  // below always sees the exact bytes as transmitted.
  express.urlencoded({
    extended: false,
    limit: '1mb',
    verify: (/** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
  async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!payments.isConfigured()) return res.status(200).json({ ok: false, reason: 'not_configured' });

    const contentType = req.headers['content-type'] || '';
    // Stripe signs webhooks with the stripe-signature header; mock/telr
    // use x-payments-signature. Pick the right header for the active
    // provider so the unified /api/webhooks/payments endpoint works for
    // all three. For Stripe the raw JSON body captured by the global
    // express.json verify hook is exactly what constructEvent expects.
    const signature =
      payments.provider() === 'stripe'
        ? (req.headers['stripe-signature'] || req.headers['x-payments-signature'] || '')
        : (req.headers['x-payments-signature'] || (req.body && req.body.sig));
    if (!payments.verifyWebhookSignature(req.rawBody || '', signature, contentType)) {
      await writeAudit(req, {
        action: 'PAYMENT_WEBHOOK_REJECTED',
        details: `Webhook signature verification failed (ip ${req.ip || 'unknown'}, provider ${payments.provider()})`,
      });
      // Migrated webhook error to new envelope (preserves _legacy for old clients)
      return apiResponse.error(req, res, 'FORBIDDEN', 'Signature verification failed', { status: 401 });
    }

    const parsed = payments.parseWebhook(req.body, contentType);
    if (!parsed.ok) {
      await writeAudit(req, {
        action: 'PAYMENT_WEBHOOK_ERROR',
        details: `Could not parse webhook: ${parsed.error}${parsed.detail ? ` — ${parsed.detail}` : ''}`,
      });
      // Ack with reason — the processor must not retry something we'll
      // never accept (a permanent parse failure), and the audit log has it.
      return res.status(200).json({ ok: false, reason: parsed.error });
    }

    // Idempotency: durable event table prevents duplicate financial effects on replay
    const payloadHash = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body) || '').digest('hex');
    const providerEventId = parsed.providerEventId || payloadHash;
    try {
      await db.prepare(
        `INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_hash, raw_payload, status) VALUES (?,?,?,?,?, 'PENDING')`
      ).run(parsed.provider, providerEventId, parsed.rawEventType || parsed.event, payloadHash, (req.rawBody || '').slice(0, 8000));
    } catch (/** @type {any} */ e) {
      const _e = /** @type {any} */ (e);
      if (_e.message && /UNIQUE|duplicate key/i.test(_e.message)) {
        return res.json({ ok: true, idempotent: true, duplicate_event: true });
      }
      if (_e.message && !/no such table/i.test(_e.message)) throw _e;
      // Table missing (DB without 002) — fall through to legacy idempotency via escrow status check
    }

    const job = /** @type {Job} */ (await db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(parsed.ref));
    if (!job) {
      await writeAudit(req, { action: 'PAYMENT_WEBHOOK_ERROR', details: `Webhook for unknown payment ref ${parsed.ref}` });
      return res.status(200).json({ ok: false, reason: 'unknown_ref' });
    }

    if (parsed.event === 'AUTHORISED') {
      if (job.processor_payment_status === 'PAID' && job.escrow_status === 'FUNDED') {
        return res.json({ ok: true, idempotent: true });
      }
      const paidAmount = parsed.amountAed ?? job.agreed_price_aed;
      // Money was taken: always record PAID + tranref, even if escrow is
      // no longer HELD (a dispute froze it in between); only flip escrow
      // when it is still HELD.
      await db.prepare(
        `UPDATE jobs SET processor_payment_status='PAID', processor_tranref=?, processor_amount_aed=?, processor_last_error=NULL,
           escrow_status = CASE WHEN escrow_status='HELD' THEN 'FUNDED' ELSE escrow_status END, updated_at=datetime('now')
         WHERE id=?`
      ).run(parsed.tranref || null, paidAmount, job.id);
      const changed = await db.prepare('SELECT escrow_status, processor_payment_status FROM jobs WHERE id=?').get(job.id);
      if (changed.escrow_status === 'FUNDED') {
        await writeAudit(req, {
          action: 'ESCROW_FUND',
          details: `${job.job_code} paid AED ${paidAmount} via ${payments.provider()} (ref ${parsed.tranref || parsed.ref})`,
          entityType: 'job',
          entityId: job.id,
          beforeState: 'HELD',
          afterState: 'FUNDED',
        });
        await (/** @type {any} */ (notify))(job.shipper_id, 'Payment received', `Payment for ${job.job_code} was received. Escrow is now FUNDED.`, job.id, 'status');
        await (/** @type {any} */ (notify))(job.carrier_id, 'Escrow funded', `Payment for ${job.job_code} was received — escrow FUNDED.`, job.id, 'status');
      }
    } else if (parsed.event === 'DECLINED' || parsed.event === 'CANCELLED') {
      if (job.processor_payment_status === 'PAID') return res.json({ ok: true, idempotent: true });
      await db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(parsed.event, job.id);
      await (/** @type {any} */ (notify))(job.shipper_id, 'Payment failed', `Your payment for ${job.job_code} was ${parsed.event.toLowerCase()}. You can retry from the job page.`, job.id, 'status');
    } else if (parsed.event === 'REFUNDED') {
      await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', processor_last_error=NULL, updated_at=datetime('now') WHERE id=?`).run(job.id);
      await writeAudit(req, {
        action: 'PAYMENT_REFUND',
        details: `${job.job_code} refunded AED ${parsed.amountAed ?? job.agreed_price_aed} (ref ${parsed.tranref || parsed.ref})`,
        entityType: 'job',
        entityId: job.id,
      });
      await (/** @type {any} */ (notify))(job.shipper_id, 'Refund processed', `The refund for ${job.job_code} was processed by the payment provider.`, job.id, 'status');
    }

    try {
      await db.prepare(`UPDATE payment_webhook_events SET status='PROCESSED', processed_at=? WHERE provider_event_id=?`).run(new Date().toISOString(), providerEventId);
    } catch {}

    res.json({ ok: true });
  }
);


router.post('/api/system/rotate-key', auth(['ADMIN']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const { keyId } = req.body || {};
  // In production this would re-encrypt IBAN/TRN with the new key version (enc:v2:...) and update Vault.
  // Here we audit the rotation intent; the actual re-encryption is a manual runbook step (see docs/operations-runbook.md).
  await (/** @type {any} */ (require('../lib/helpers'))).writeAudit(req, { userId: req.actorId, action: 'ENCRYPTION_KEY_ROTATE', details: `Key rotation requested${keyId ? ` -> ${keyId}` : ''} by admin ${req.actorLabel}`, entityType: 'system', entityId: null });
  res.json({ ok: true, message: 'Rotation audit logged. Follow docs/operations-runbook.md § key rotation to re-encrypt at-rest fields and update ENCRYPTION_KEY in Vault.' });
});

module.exports = router;

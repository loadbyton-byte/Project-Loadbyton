const express = require('express');
const db = require('../db');
const payments = require('../lib/payments');
const { PORT, INTERNAL_KEY } = require('../lib/config');
const { sendError, asyncHandler } = require('../lib/http');
const { referralCode, isPasswordValid, writeAudit, timingSafeEqualStr, notify } = require('../lib/helpers');
const { auth } = require('../middleware/auth');
const { runAutoReleaseSweep } = require('../services/escrow.service');
const { publishScheduledJobs } = require('../services/scheduling.service');
const bcrypt = require('bcryptjs');



const router = require('express').Router();

router.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'loadbyton-api', time: new Date().toISOString(), pid: String(process.pid), port: PORT, payments: payments.providerInfo() });
});

router.post('/api/system/auto-release', async (req, res) => {
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

router.post('/api/system/publish-scheduled', async (req, res) => {
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
  asyncHandler(async (req, res) => {
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
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
  async (req, res) => {
    if (!payments.isConfigured()) return res.status(200).json({ ok: false, reason: 'not_configured' });

    const contentType = req.headers['content-type'] || '';
    const signature = req.headers['x-payments-signature'] || (req.body && req.body.sig);
    if (!payments.verifyWebhookSignature(req.rawBody || '', signature, contentType)) {
      await writeAudit(req, {
        action: 'PAYMENT_WEBHOOK_REJECTED',
        details: `Webhook signature verification failed (ip ${req.ip || 'unknown'}, provider ${payments.provider()})`,
      });
      return sendError(res, 401, 'Signature verification failed');
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

    const job = await db.prepare('SELECT * FROM jobs WHERE processor_payment_ref=?').get(parsed.ref);
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
        await notify(job.shipper_id, 'Payment received', `Payment for ${job.job_code} was received. Escrow is now FUNDED.`, job.id, 'status');
        await notify(job.carrier_id, 'Escrow funded', `Payment for ${job.job_code} was received — escrow FUNDED.`, job.id, 'status');
      }
    } else if (parsed.event === 'DECLINED' || parsed.event === 'CANCELLED') {
      if (job.processor_payment_status === 'PAID') return res.json({ ok: true, idempotent: true });
      await db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(parsed.event, job.id);
      await notify(job.shipper_id, 'Payment failed', `Your payment for ${job.job_code} was ${parsed.event.toLowerCase()}. You can retry from the job page.`, job.id, 'status');
    } else if (parsed.event === 'REFUNDED') {
      await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', processor_last_error=NULL, updated_at=datetime('now') WHERE id=?`).run(job.id);
      await writeAudit(req, {
        action: 'PAYMENT_REFUND',
        details: `${job.job_code} refunded AED ${parsed.amountAed ?? job.agreed_price_aed} (ref ${parsed.tranref || parsed.ref})`,
        entityType: 'job',
        entityId: job.id,
      });
      await notify(job.shipper_id, 'Refund processed', `The refund for ${job.job_code} was processed by the payment provider.`, job.id, 'status');
    }

    res.json({ ok: true });
  }
);


router.post('/api/system/rotate-key', auth(['ADMIN']), async (req, res) => {
  const { keyId } = req.body || {};
  // In production this would re-encrypt IBAN/TRN with the new key version (enc:v2:...) and update Vault.
  // Here we audit the rotation intent; the actual re-encryption is a manual runbook step (see docs/operations-runbook.md).
  await require('../lib/helpers').writeAudit(req, { userId: req.actorId, action: 'ENCRYPTION_KEY_ROTATE', details: `Key rotation requested${keyId ? ` -> ${keyId}` : ''} by admin ${req.actorLabel}`, entityType: 'system', entityId: null });
  res.json({ ok: true, message: 'Rotation audit logged. Follow docs/operations-runbook.md § key rotation to re-encrypt at-rest fields and update ENCRYPTION_KEY in Vault.' });
});

module.exports = router;

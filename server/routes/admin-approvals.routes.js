// Change 21 — two-person approval on sensitive admin actions.
//
// Requester admin POSTs a request; a DIFFERENT admin confirms (or rejects);
// only confirmation executes the underlying state change via the allowlisted
// executor below. Same-admin self-confirm → 403. All steps audited.
const db = require('../db');
const { sendError } = require('../lib/http');
const { apiResponse } = require('../lib/apiResponse');
const { auth } = require('../middleware/auth');
const { writeAudit } = require('../lib/helpers');

const router = require('express').Router();

const EXECUTABLE = ['MANUAL_ESCROW_RELEASE', 'MANUAL_REFUND'];

async function executeApproval(approval, confirmer, req) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(approval.job_id);
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
  const payload = approval.payload ? JSON.parse(approval.payload) : {};

  await db.transaction(async (trx) => {
    if (approval.action_type === 'MANUAL_ESCROW_RELEASE') {
      if (!['HELD', 'FUNDED'].includes(job.escrow_status)) {
        throw Object.assign(new Error(`Escrow is ${job.escrow_status}, nothing to release`), { status: 409 });
      }
      await trx.query(`UPDATE jobs SET escrow_status='RELEASED', payout_released_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, [job.id]);
      await trx.query(`UPDATE payouts SET status='RELEASED', release_type='MANUAL_OVERRIDE', released_at=datetime('now') WHERE job_id=? AND status != 'RELEASED'`, [job.id]);
    } else if (approval.action_type === 'MANUAL_REFUND') {
      if (job.escrow_status === 'RELEASED') {
        throw Object.assign(new Error('Escrow already released, cannot refund'), { status: 409 });
      }
      await trx.query(`UPDATE jobs SET escrow_status='REFUNDED', updated_at=datetime('now') WHERE id=?`, [job.id]);
      await trx.query(`UPDATE payouts SET status='CANCELLED' WHERE job_id=? AND status != 'RELEASED'`, [job.id]);
    } else {
      throw Object.assign(new Error(`Unknown action ${approval.action_type}`), { status: 400 });
    }
    await trx.query(`UPDATE admin_approvals SET status='EXECUTED', confirmed_by=?, decided_at=datetime('now') WHERE id=?`, [confirmer.id, approval.id]);
  });

  await writeAudit(req, {
    userId: confirmer.id, action: 'APPROVAL_EXECUTED',
    details: `${approval.action_type} on job ${job.job_code} requested by #${approval.requested_by}, confirmed+executed by ${confirmer.email}${payload.reason ? ` — reason: ${payload.reason}` : ''}`,
    entityType: 'job', entityId: job.id,
  });
}

router.post('/api/admin/action-approvals/request', auth(['ADMIN']), async (req, res) => {
  const { actionType, jobId, reason } = req.body || {};
  if (!EXECUTABLE.includes(actionType)) {
    return apiResponse.error(req, res, 'VALIDATION_FAILED', `actionType must be one of: ${EXECUTABLE.join(', ')}`);
  }
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(jobId));
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  const dup = await db.prepare(`SELECT id FROM admin_approvals WHERE job_id=? AND action_type=? AND status='PENDING'`).get(job.id, actionType);
  if (dup) return apiResponse.error(req, res, 'CONFLICT', 'A pending request for this action already exists', { status: 409 });
  const r = await db
    .prepare(`INSERT INTO admin_approvals (action_type, job_id, payload, requested_by) VALUES (?,?,?,?) RETURNING id`)
    .run(actionType, job.id, JSON.stringify({ reason: reason || null }), req.user.id);
  const approval = await db.prepare(`SELECT * FROM admin_approvals WHERE id=?`).get(Number(r.lastInsertRowid));
  await writeAudit(req, { userId: req.actorId, action: 'APPROVAL_REQUESTED', details: `${actionType} on ${job.job_code} requested${reason ? ` — ${reason}` : ''}`, entityType: 'job', entityId: job.id });
  res.status(201).json({ approval });
});

// Was '/api/admin/approvals' (GET) — collided with admin.routes.js's route
// of the exact same path (the pending-account-approval queue, a completely
// different feature: users.account_approval_status, not this file's
// admin_approvals table). Express resolves a path collision by first
// registration order (admin.routes.js is required before this file in
// app.js's route list), so this handler was 100% dead/unreachable code —
// any caller of GET /api/admin/approvals always got the account queue's
// {queue: [...]} shape, never this table's {approvals: [...]}. Renamed the
// whole action-approvals group together so it can't collide again.
router.get('/api/admin/action-approvals', auth(['ADMIN']), async (req, res) => {
  const { status } = req.query || {};
  const rows = status && ['PENDING', 'CONFIRMED', 'REJECTED', 'EXECUTED'].includes(String(status).toUpperCase())
    ? await db.prepare(`SELECT * FROM admin_approvals WHERE status=? ORDER BY created_at DESC LIMIT 100`).all(String(status).toUpperCase())
    : await db.prepare(`SELECT * FROM admin_approvals ORDER BY created_at DESC LIMIT 100`).all();
  res.json({ approvals: rows });
});

router.post('/api/admin/action-approvals/:id/confirm', auth(['ADMIN']), async (req, res) => {
  const approval = await db.prepare(`SELECT * FROM admin_approvals WHERE id=?`).get(req.params.id);
  if (!approval) return sendError(res, 404, 'Approval request not found');
  if (approval.status !== 'PENDING') return sendError(res, 409, `Request is already ${approval.status}`);
  if (approval.requested_by === req.user.id) {
    return sendError(res, 403, 'Two-person rule: the requesting admin cannot confirm their own request — a second admin must confirm');
  }
  try {
    await executeApproval(approval, req.user, req);
  } catch (e) {
    return sendError(res, e.status || 500, e.message || 'Execution failed');
  }
  res.json({ approval: await db.prepare(`SELECT * FROM admin_approvals WHERE id=?`).get(approval.id) });
});

router.post('/api/admin/action-approvals/:id/reject', auth(['ADMIN']), async (req, res) => {
  const approval = await db.prepare(`SELECT * FROM admin_approvals WHERE id=?`).get(req.params.id);
  if (!approval) return sendError(res, 404, 'Approval request not found');
  if (approval.status !== 'PENDING') return sendError(res, 409, `Request is already ${approval.status}`);
  if (approval.requested_by === req.user.id) {
    return sendError(res, 403, 'Two-person rule: the requesting admin cannot reject their own request — a second admin must decide');
  }
  const { reason } = req.body || {};
  await db.prepare(`UPDATE admin_approvals SET status='REJECTED', confirmed_by=?, decided_at=datetime('now') WHERE id=?`).run(req.user.id, approval.id);
  await writeAudit(req, { userId: req.actorId, action: 'APPROVAL_REJECTED', details: `${approval.action_type} on job #${approval.job_id} rejected by ${req.user.email}${reason ? ` — ${reason}` : ''}`, entityType: 'job', entityId: approval.job_id });
  res.json({ approval: await db.prepare(`SELECT * FROM admin_approvals WHERE id=?`).get(approval.id) });
});

// Ledger hash-chain verification (Change 21) — admin-only, same reasoning
// as the audit-chain endpoint: platform-wide and unfiltered.
router.get('/api/admin/ledger/verify-chain', auth(['ADMIN']), async (req, res) => {
  const { verifyChain } = require('../lib/ledger');
  res.json(await verifyChain(db));
});

module.exports = router;

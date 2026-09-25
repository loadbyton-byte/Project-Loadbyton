// Shipper-facing credit requests — closes a real gap in the existing
// CONTRACT_CREDIT admin flow (admin.routes.js's /api/admin/credit/*): an
// admin could only proactively grant a limit via two plain numbers, with
// no shipper-initiated request and no proof of ability to pay attached.
// This lets a shipper ask for a specific limit and attach a document (a
// cheque scan, a bank guarantee, whatever the ops team wants on file)
// before an admin decides — see admin.routes.js's decide endpoint for the
// other half of this workflow.
const db = require('../db');
const { auth, requireSeatRole } = require('../middleware/auth');
const { sendError, asyncHandler } = require('../lib/http');
const apiResponse = require('../lib/apiResponse');
const { resolveUploadedFile } = require('../lib/helpers');
const storage = require('../lib/storage');
const router = require('express').Router();

router.post('/api/credit/requests/upload-url', auth(['SHIPPER', 'FORWARDER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const { mimeType } = req.body || {};
  const presigned = await storage.getPresignedUploadUrl(`credit-proof/${req.user.id}`, mimeType);
  res.json(presigned || { useBase64: true });
}));

router.post('/api/credit/requests', auth(['SHIPPER', 'FORWARDER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const { requestedLimitAed, mimeType, fileBase64, storageKey } = req.body || {};
  const limit = Number(requestedLimitAed);
  if (!Number.isFinite(limit) || limit <= 0) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'requestedLimitAed must be a positive number');
  if (!fileBase64 && !storageKey) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'A proof document (e.g. a cheque or bank guarantee scan) is required');

  // A shipper with an already-PENDING request must resolve it (wait for
  // the admin, or it gets rejected) before filing another — otherwise
  // there'd be no single answer to "what did the admin actually decide"
  // for a shipper who fired off several requests in a row.
  const existingPending = await db.prepare(`SELECT id FROM credit_requests WHERE shipper_id=? AND status='PENDING'`).get(req.user.id);
  if (existingPending) return apiResponse.error(req, res, 'CONFLICT', 'You already have a pending credit request — wait for it to be decided before requesting again', { status: 409 });

  const saved = await resolveUploadedFile(`credit-proof/${req.user.id}`, { mimeType, fileBase64, storageKey });
  const r = await db
    .prepare(`INSERT INTO credit_requests (shipper_id, requested_limit_aed, proof_doc_storage_path, proof_doc_mime_type) VALUES (?,?,?,?) RETURNING id`)
    .run(req.user.id, limit, saved.storagePath, saved.mimeType);
  const request = await db.prepare('SELECT * FROM credit_requests WHERE id=?').get(Number(r.lastInsertRowid));
  res.status(201).json({ request });
}));

router.get('/api/credit/requests', auth(['SHIPPER', 'FORWARDER']), asyncHandler(async (req, res) => {
  const requests = await db.prepare('SELECT * FROM credit_requests WHERE shipper_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ requests });
}));

// Serves the uploaded proof document — the shipper who filed it, or an
// admin, same "one endpoint, two authorized viewers" pattern
// documents.routes.js already uses for profile documents.
router.get('/api/credit/requests/:id/document', auth(), asyncHandler(async (req, res) => {
  const request = await db.prepare('SELECT * FROM credit_requests WHERE id=?').get(req.params.id);
  if (!request) return sendError(res, 404, 'Credit request not found');
  if (req.user.role !== 'ADMIN' && request.shipper_id !== req.user.id) return sendError(res, 403, 'Not permitted');
  const file = await storage.getFile(request.proof_doc_storage_path);
  if (!file) return sendError(res, 404, 'Document not found in storage');
  res.set('Content-Type', request.proof_doc_mime_type || 'application/octet-stream');
  if (file.s3) file.stream.pipe(res);
  else res.sendFile(file.localPath);
}));

module.exports = router;

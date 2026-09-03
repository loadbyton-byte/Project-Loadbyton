// Company-level registration documents (trade licence, insurance) — the
// first real file storage for these; profiles.insurance_uploaded was
// previously just a self-reported boolean, no actual file behind it. Same
// presigned-upload pattern as driver documents (fleet.routes.js), and the
// GET below follows that same file's precedent of one endpoint unifying
// "the owner viewing their own doc" and "an admin viewing anyone's" rather
// than two parallel routes for the same resource.
const db = require('../db');
const { auth, requireSeatRole } = require('../middleware/auth');
const { sendError, asyncHandler } = require('../lib/http');
const { resolveUploadedFile } = require('../lib/helpers');
const storage = require('../lib/storage');
const router = require('express').Router();

const DOC_COLUMN = { TRADE_LICENSE: 'trade_license_doc', INSURANCE: 'insurance_doc' };

router.post('/api/profile/documents/upload-url', auth(['SHIPPER', 'CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const { docType, mimeType } = req.body || {};
  if (!DOC_COLUMN[docType]) return sendError(res, 400, "docType must be 'TRADE_LICENSE' or 'INSURANCE'");
  const presigned = await storage.getPresignedUploadUrl(`profile/${req.user.id}`, mimeType);
  res.json(presigned || { useBase64: true });
}));

router.post('/api/profile/documents', auth(['SHIPPER', 'CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const { docType, mimeType, fileBase64, storageKey } = req.body || {};
  const column = DOC_COLUMN[docType];
  if (!column) return sendError(res, 400, "docType must be 'TRADE_LICENSE' or 'INSURANCE'");

  const saved = await resolveUploadedFile(`profile/${req.user.id}`, { mimeType, fileBase64, storageKey });
  await db.prepare(`UPDATE profiles SET ${column}_storage_path=?, ${column}_mime_type=? WHERE user_id=?`)
    .run(saved.storagePath, saved.mimeType, req.user.id);
  // insurance_uploaded predates real file storage and still drives the
  // existing compliance-score checklist — keep it true once a real file
  // backs the claim, instead of leaving two sources of truth to drift.
  if (docType === 'INSURANCE') await db.prepare('UPDATE profiles SET insurance_uploaded=1 WHERE user_id=?').run(req.user.id);

  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  res.json({ profile });
}));

async function serveProfileDocument(req, res, targetUserId) {
  if (targetUserId !== req.user.id && req.user.role !== 'ADMIN') return sendError(res, 403, 'Not permitted');
  const column = DOC_COLUMN[req.params.docType];
  if (!column) return sendError(res, 400, "docType must be 'TRADE_LICENSE' or 'INSURANCE'");

  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(targetUserId);
  const storagePath = profile && profile[`${column}_storage_path`];
  if (!storagePath) return sendError(res, 404, 'No document uploaded');
  const file = await storage.getFile(storagePath);
  if (!file) return sendError(res, 404, 'Document not found in storage');
  res.set('Content-Type', profile[`${column}_mime_type`] || 'application/octet-stream');
  if (file.s3) file.stream.pipe(res);
  else res.sendFile(file.localPath);
}

// Express 5's router (path-to-regexp v8) dropped the old `:param?`
// optional-segment syntax — two routes instead of one with an optional
// trailing segment.
router.get('/api/profile/documents/:docType', auth(), asyncHandler(async (req, res) => {
  await serveProfileDocument(req, res, req.user.id);
}));
router.get('/api/profile/documents/:docType/:userId', auth(), asyncHandler(async (req, res) => {
  await serveProfileDocument(req, res, Number(req.params.userId));
}));

// Per-job documents rollup — every job this account (as shipper or
// carrier) has attached documents to, for the "per-job" section of
// /documents. Deliberately only jobs WITH at least one document (an inner
// join) — a full job list with a document count of zero for most rows
// isn't what "documents shared between them" means.
router.get('/api/documents/my-jobs', auth(['SHIPPER', 'CARRIER']), asyncHandler(async (req, res) => {
  const column = req.user.role === 'SHIPPER' ? 'shipper_id' : 'carrier_id';
  const rows = await db
    .prepare(
      `SELECT j.id, j.job_code, j.status, COUNT(jd.id) as doc_count
       FROM jobs j JOIN job_documents jd ON jd.job_id = j.id
       WHERE j.${column}=? GROUP BY j.id, j.job_code, j.status ORDER BY j.id DESC`
    )
    .all(req.user.id);
  res.json({ jobs: rows.map((r) => ({ id: r.id, jobCode: r.job_code, status: r.status, docCount: Number(r.doc_count) })) });
}));

module.exports = router;

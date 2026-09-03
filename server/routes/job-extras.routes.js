// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */
const path = require('node:path');
const fs = require('node:fs');
const db = require('../db');
const apiResponse = require('../lib/apiResponse');
const { BACKLOAD_ELIGIBLE_STATUSES, BACKLOAD_MAX_DISTANCE_KM, TERMINAL_EMIRATE, AREA_EMIRATE, DOC_TYPES } = require('../lib/constants');
const { resolveUploadedFile, getPresignedUploadUrl, UPLOADS_DIR, haversineKm, writeAudit, canSeeDocument, isParticipantOrBidder, isPartyOnJob, notify } = require('../lib/helpers');
const { auth } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/jobs/:id/backload-matches', auth(['CARRIER']), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (job.carrier_id !== req.user.id) return apiResponse.error(req, res, 'FORBIDDEN', 'Not your job');
  if (!BACKLOAD_ELIGIBLE_STATUSES.includes(job.status)) {
    return apiResponse.error(req, res, 'FORBIDDEN', `Backload matching is only available once a job is ${BACKLOAD_ELIGIBLE_STATUSES.join('/')}`);
  }

  const deliveryEmirate = AREA_EMIRATE[job.delivery_area] || null;
  const candidates = await db
    .prepare(
      `SELECT j.*, p.company_name AS shipper_company, p.rating_avg AS shipper_rating
       FROM jobs j LEFT JOIN profiles p ON p.user_id = j.shipper_id
       WHERE j.status='OPEN' AND j.id != ?
       ORDER BY j.created_at DESC LIMIT 200`
    )
    .all(job.id);

  const matches = [];
  for (const c of candidates) {
    let matchType = null;
    let distanceKm = null;
    if (job.delivery_lat !== null && job.delivery_lng !== null && c.pickup_lat !== null && c.pickup_lng !== null) {
      const d = haversineKm(job.delivery_lat, job.delivery_lng, c.pickup_lat, c.pickup_lng);
      if (d <= BACKLOAD_MAX_DISTANCE_KM) {
        matchType = 'coords';
        distanceKm = Math.round(d * 10) / 10;
      }
    } else if (deliveryEmirate && TERMINAL_EMIRATE[c.pickup_terminal] === deliveryEmirate) {
      matchType = 'area';
    }
    if (matchType) matches.push({ ...c, matchType, distanceKm });
  }
  matches.sort((a, b) => {
    if (a.matchType === 'coords' && b.matchType === 'coords') return a.distanceKm - b.distanceKm;
    if (a.matchType === 'coords') return -1;
    if (b.matchType === 'coords') return 1;
    return 0;
  });

  res.json({ matches: matches.slice(0, 10) });
});

// Direct-to-R2 upload, step 1 of 2 — see fleet.routes.js's sibling endpoint
// for the full explanation. Same party check as the registration endpoint.
router.post('/api/jobs/:id/documents/upload-url', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (!(await isPartyOnJob(job, req.user))) return apiResponse.error(req, res, 'FORBIDDEN', 'Only the shipper and the awarded carrier can attach documents');
  const { mimeType } = req.body || {};
  const presigned = await getPresignedUploadUrl(String(job.id), mimeType);
  res.json(presigned || { useBase64: true });
});

router.post('/api/jobs/:id/documents', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  // Uploads are for the job's parties (shipper or awarded carrier) — a
  // bidding carrier has no business attaching files to a job they may lose.
  if (!(await isPartyOnJob(job, req.user))) return apiResponse.error(req, res, 'FORBIDDEN', 'Only the shipper and the awarded carrier can attach documents');
  const b = req.body || {};
  if (!b.title || !(b.fileUrl || b.fileBase64 || b.storageKey)) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'title and (fileUrl, fileBase64+mimeType, or storageKey+mimeType) are required');
  let storagePath = null;
  let mimeType = null;
  if (b.fileBase64 || b.storageKey) {
    try {
      ({ storagePath, mimeType } = await resolveUploadedFile(String(job.id), { mimeType: b.mimeType, fileBase64: b.fileBase64, storageKey: b.storageKey }));
    } catch (e) {
      return apiResponse.error(req, res, 'VALIDATION_FAILED', e.message || 'Upload failed', { status: e.status || 400 });
    }
  }
  await db.prepare('INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,?,?,?,?,?)').run(
    job.id,
    req.actorId,
    DOC_TYPES.includes(b.docType) ? b.docType : 'OTHER',
    b.title,
    b.fileUrl || storagePath || '',
    storagePath,
    mimeType
  );
  await writeAudit(req, { userId: req.actorId, action: 'DOCUMENT_ADD', details: `${b.docType || 'OTHER'} on ${job.job_code}`, entityType: 'job', entityId: job.id });
  res.status(201).json({ ok: true });
});

router.get('/api/jobs/:id/documents/:docId/file', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  const doc = await db.prepare('SELECT * FROM job_documents WHERE id=? AND job_id=?').get(req.params.docId, job.id);
  if (!doc) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'Document not found', { status: 404 });
  if (!canSeeDocument(job, doc, req.user)) return apiResponse.error(req, res, 'FORBIDDEN', 'Not permitted — documents are shared once the bid is confirmed');
  if (!doc.storage_path) return res.redirect(doc.file_url);
  res.set('Content-Type', doc.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${doc.title.replace(/[^\w.-]/g, '_')}"`);
  try {
    const storage = require('../lib/storage');
    if (storage.isS3Enabled()) {
      const obj = await storage.getFile(doc.storage_path);
      if (!obj || !obj.stream) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'File not found', { status: 404 });
      // Stream S3 object directly; adapt Web ReadableStream vs Node stream
      if (typeof obj.stream.pipe === 'function') {
        return obj.stream.pipe(res);
      }
      // @aws-sdk returns a web stream in some runtimes — convert
      const { Readable } = require('node:stream');
      return Readable.fromWeb(obj.stream).pipe(res);
    }
  } catch {}
  const filePath = path.join(UPLOADS_DIR, doc.storage_path);
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'File not found', { status: 404 });
  res.sendFile(filePath);
});

router.post('/api/jobs/:id/rating', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  if (!(await isParticipantOrBidder(job, req.user)) || (req.user.id !== job.shipper_id && req.user.id !== job.carrier_id)) {
    return apiResponse.error(req, res, 'FORBIDDEN', 'Not permitted');
  }
  if (job.status !== 'COMPLETED') return apiResponse.error(req, res, 'FORBIDDEN', 'Job must be completed before rating');
  const existing = await db.prepare('SELECT 1 FROM ratings WHERE job_id=? AND rater_id=?').get(job.id, req.user.id);
  if (existing) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'You already rated this job', { status: 409 });

  const b = req.body || {};
  const score = Number(b.score);
  if (!score || score < 1 || score > 5) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'score must be 1-5');
  const rateeId = req.user.id === job.shipper_id ? job.carrier_id : job.shipper_id;

  // submits — idx_ratings_one_per_rater (server/db.js) is the real
  // guarantee; this just turns a constraint violation into a clean 409
  // instead of a 500.
  try {
    await db.prepare('INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)').run(job.id, req.user.id, rateeId, score, b.comment || null);
  } catch (e) {
    // 23505 is Postgres's unique_violation code — the ERR_SQLITE_ERROR
    // check alone left this dead on Postgres (any real double-submit threw
    // a raw 500 instead of this clean 409).
    const isUniqueViolation = e.code === '23505' || (e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(e.message));
    if (isUniqueViolation) {
      return apiResponse.error(req, res, 'VALIDATION_FAILED', 'You already rated this job', { status: 409 });
    }
    throw e;
  }
  const agg = await db.prepare('SELECT AVG(score) avg, COUNT(*) n FROM ratings WHERE ratee_id=?').get(rateeId);
  await db.prepare('UPDATE profiles SET rating_avg=?, completed_jobs=completed_jobs+1 WHERE user_id=?').run(Math.round(agg.avg * 100) / 100, rateeId);
  await writeAudit(req, { userId: req.actorId, action: 'RATING', details: `${score}/5 on ${job.job_code}`, entityType: 'job', entityId: job.id });
  res.status(201).json({ ok: true });
});

router.get('/api/jobs/:id/messages', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  // Once a job is DISPUTED this thread doubles as the dispute correspondence
  // (see GET /api/jobs/:id/dispute) — a losing bidder who never won the
  // award has no business reading it, so drop the bidder-visibility
  // fallback specifically for disputed jobs.
  const permitted = job.status === 'DISPUTED' ? await isPartyOnJob(job, req.user) : await isParticipantOrBidder(job, req.user);
  if (!permitted) return apiResponse.error(req, res, 'FORBIDDEN', 'Not permitted');
  // sender_role is additive (existing consumers only ever read
  // sender_id/content) — lets the party-facing dispute view (JobDispute.jsx)
  // render an admin's reply as a distinct "Admin" bubble instead of looking
  // like a second copy of the counterparty.
  const messages = await db
    .prepare('SELECT m.*, u.role as sender_role FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.job_id=? ORDER BY m.created_at ASC')
    .all(job.id);
  res.json({ messages });
});

router.post('/api/jobs/:id/messages', auth(), async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return apiResponse.error(req, res, 'JOB_NOT_FOUND', 'Job not found');
  const permitted = job.status === 'DISPUTED' ? await isPartyOnJob(job, req.user) : await isParticipantOrBidder(job, req.user);
  if (!permitted) return apiResponse.error(req, res, 'FORBIDDEN', 'Not permitted');
  const { content } = req.body || {};
  if (!content || !content.trim()) return apiResponse.error(req, res, 'VALIDATION_FAILED', 'content is required');
  const result = await db.prepare('INSERT INTO messages (job_id, sender_id, content) VALUES (?,?,?) RETURNING id').run(job.id, req.actorId, content.trim());
  // Sender may be neither party (an admin replying in a dispute thread) —
  // notify both shipper and carrier in that case rather than defaulting to
  // the shipper, which previously left the carrier silently un-notified.
  if (req.user.id === job.shipper_id) {
    await notify(job.carrier_id, 'New message', `New message on ${job.job_code}`, job.id, 'message');
  } else if (req.user.id === job.carrier_id) {
    await notify(job.shipper_id, 'New message', `New message on ${job.job_code}`, job.id, 'message');
  } else {
    await notify(job.shipper_id, 'New message', `New message on ${job.job_code}`, job.id, 'message');
    await notify(job.carrier_id, 'New message', `New message on ${job.job_code}`, job.id, 'message');
  }
  const message = await db.prepare('SELECT * FROM messages WHERE id=?').get(Number(result.lastInsertRowid));
  try { require('../lib/socket').emitNewMessage(job.id, message); } catch {}
  res.status(201).json({ message });
});

module.exports = router;

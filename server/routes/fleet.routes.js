// Carrier driver roster — registered once, picked from (not retyped) when
// assigning to a job (see job-lifecycle.routes.js's PATCH /:id/driver).
// Addresses docs/STRATEGIC_REVIEW.md's flagged gap: "driver identity not
// bound to the bid."
const db = require('../db');
const { auth, requireSeatRole } = require('../middleware/auth');
const { sendError, asyncHandler } = require('../lib/http');
const { normalizeUaeMobile, resolveUploadedFile } = require('../lib/helpers');
const storage = require('../lib/storage');
const router = require('express').Router();

const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;

router.get('/api/fleet/overview', auth(['CARRIER']), async (req, res) => {
  // thin proxy to /api/carrier/fleet for fleet ops UI
  const jobs = await db.prepare('SELECT * FROM jobs WHERE carrier_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ jobs: jobs.map((j) => ({ job_code: j.job_code, status: j.status, driver: j.assigned_driver_name, delivered_at: j.delivered_at })) });
});

router.get('/api/fleet/drivers', auth(['CARRIER']), asyncHandler(async (req, res) => {
  const drivers = await db.prepare('SELECT * FROM drivers WHERE carrier_id=? AND is_active=1 ORDER BY name').all(req.user.id);
  res.json({ drivers });
}));

router.post('/api/fleet/drivers', auth(['CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const { name, phone, licenseNumber, licenseExpiry } = req.body || {};
  if (!name || !name.trim()) return sendError(res, 400, 'name is required');
  const normalizedPhone = normalizeUaeMobile(phone);
  if (!normalizedPhone) return sendError(res, 400, 'phone is required and must be a valid UAE mobile number');
  if (licenseNumber && !UAE_LICENCE_RE.test(String(licenseNumber).toUpperCase())) {
    return sendError(res, 400, 'licenseNumber must be 5-15 letters/digits/dashes and contain at least one digit');
  }

  const result = await db.prepare(
    `INSERT INTO drivers (carrier_id, name, phone, license_number, license_expiry) VALUES (?,?,?,?,?) RETURNING id`
  ).run(req.user.id, name.trim(), normalizedPhone, licenseNumber ? String(licenseNumber).toUpperCase() : null, licenseExpiry || null);
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ driver });
}));

router.patch('/api/fleet/drivers/:id', auth(['CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=?').get(req.params.id, req.user.id);
  if (!driver) return sendError(res, 404, 'Driver not found');
  const { name, phone, licenseNumber, licenseExpiry } = req.body || {};

  const sets = [];
  const vals = [];
  if (name !== undefined) {
    if (!name.trim()) return sendError(res, 400, 'name cannot be empty');
    sets.push('name=?'); vals.push(name.trim());
  }
  if (phone !== undefined) {
    const normalizedPhone = normalizeUaeMobile(phone);
    if (!normalizedPhone) return sendError(res, 400, 'phone must be a valid UAE mobile number');
    sets.push('phone=?'); vals.push(normalizedPhone);
  }
  if (licenseNumber !== undefined) {
    if (licenseNumber && !UAE_LICENCE_RE.test(String(licenseNumber).toUpperCase())) {
      return sendError(res, 400, 'licenseNumber must be 5-15 letters/digits/dashes and contain at least one digit');
    }
    sets.push('license_number=?'); vals.push(licenseNumber ? String(licenseNumber).toUpperCase() : null);
  }
  if (licenseExpiry !== undefined) { sets.push('license_expiry=?'); vals.push(licenseExpiry || null); }
  if (!sets.length) return sendError(res, 400, 'No fields to update');
  sets.push(`updated_at=datetime('now')`);
  vals.push(driver.id);
  await db.prepare(`UPDATE drivers SET ${sets.join(', ')} WHERE id=?`).run(...vals);

  const updated = await db.prepare('SELECT * FROM drivers WHERE id=?').get(driver.id);
  res.json({ driver: updated });
}));

// Soft delete — a past job's assigned_driver_id may still reference this
// row, so it's deactivated (hidden from the picker), never removed.
router.delete('/api/fleet/drivers/:id', auth(['CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=?').get(req.params.id, req.user.id);
  if (!driver) return sendError(res, 404, 'Driver not found');
  await db.prepare(`UPDATE drivers SET is_active=0, updated_at=datetime('now') WHERE id=?`).run(driver.id);
  res.json({ ok: true });
}));

// Direct-to-R2 upload, step 1 of 2: mint a presigned PUT URL scoped to this
// driver. Same auth as the registration endpoint below — a client can only
// ever get a URL for a driver they actually own. Returns null (server/lib/
// storage.js) when S3 isn't configured, which the client reads as "use the
// inline base64 path instead" (still fully functional against local disk).
router.post('/api/fleet/drivers/:id/documents/upload-url', auth(['CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=?').get(req.params.id, req.user.id);
  if (!driver) return sendError(res, 404, 'Driver not found');
  const { mimeType } = req.body || {};
  const presigned = await storage.getPresignedUploadUrl(`drivers/${driver.id}`, mimeType);
  res.json(presigned || { useBase64: true });
}));

router.post('/api/fleet/drivers/:id/documents', auth(['CARRIER']), requireSeatRole(['OPS']), asyncHandler(async (req, res) => {
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=? AND carrier_id=?').get(req.params.id, req.user.id);
  if (!driver) return sendError(res, 404, 'Driver not found');
  const { docType, mimeType, fileBase64, storageKey } = req.body || {};
  if (!['LICENSE', 'VEHICLE'].includes(docType)) return sendError(res, 400, "docType must be 'LICENSE' or 'VEHICLE'");

  const saved = await resolveUploadedFile(`drivers/${driver.id}`, { mimeType, fileBase64, storageKey });
  const column = docType === 'LICENSE' ? 'license_doc' : 'vehicle_doc';
  await db.prepare(`UPDATE drivers SET ${column}_storage_path=?, ${column}_mime_type=?, updated_at=datetime('now') WHERE id=?`)
    .run(saved.storagePath, saved.mimeType, driver.id);

  const updated = await db.prepare('SELECT * FROM drivers WHERE id=?').get(driver.id);
  res.json({ driver: updated });
}));

// Shipper-facing: view a specific driver's docs on a job that's been
// assigned to them — server/lib/storage.js's getFile is the same one
// job-document downloads already use, so this inherits the same S3/local
// fallback behavior with no new code path.
router.get('/api/fleet/drivers/:id/documents/:docType', auth(), asyncHandler(async (req, res) => {
  const driver = await db.prepare('SELECT * FROM drivers WHERE id=?').get(req.params.id);
  if (!driver) return sendError(res, 404, 'Driver not found');
  const isOwner = req.user.role === 'CARRIER' && driver.carrier_id === req.user.id;
  const isAssignedShipper = req.user.role === 'SHIPPER' &&
    await db.prepare('SELECT 1 FROM jobs WHERE assigned_driver_id=? AND shipper_id=?').get(driver.id, req.user.id);
  if (!isOwner && !isAssignedShipper && req.user.role !== 'ADMIN') return sendError(res, 403, 'Not permitted');

  const docType = req.params.docType === 'license' ? 'LICENSE' : req.params.docType === 'vehicle' ? 'VEHICLE' : null;
  if (!docType) return sendError(res, 400, "docType must be 'license' or 'vehicle'");
  const column = docType === 'LICENSE' ? 'license_doc' : 'vehicle_doc';
  const storagePath = driver[`${column}_storage_path`];
  if (!storagePath) return sendError(res, 404, 'No document uploaded');

  const file = await storage.getFile(storagePath);
  if (!file) return sendError(res, 404, 'Document not found in storage');
  res.set('Content-Type', driver[`${column}_mime_type`] || 'application/octet-stream');
  if (file.s3) file.stream.pipe(res);
  else res.sendFile(file.localPath);
}));

module.exports = router;

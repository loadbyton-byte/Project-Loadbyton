// Extracted from job-lifecycle.routes.js's POST /api/jobs/:id/pod so the
// WhatsApp bot's "Delivered" button reply (server/routes/whatsapp.routes.js)
// triggers the exact same job-status-update path as the web dashboard's
// delivery confirmation, instead of a second, drifting copy of this logic.
// Auth/ownership checks stay in each caller (the route already checked
// req.user; the webhook resolves the driver's job independently) — this
// function assumes the caller has already established the actor is allowed
// to confirm delivery for this job.
const db = require('../db');
const { resolveUploadedFile, getSettings, writeAudit, notify } = require('../lib/helpers');
const { DOC_TYPES } = require('../lib/constants');

/**
 * @param {any} job
 * @param {{ actorId: number, doc?: any, req?: any }} opts
 */
async function confirmDelivery(job, { actorId, doc, req }) {
  if (job.status !== 'IN_TRANSIT') {
    const e = new Error('Job must be IN_TRANSIT to submit proof of delivery');
    e.status = 403;
    throw e;
  }

  let storagePath = null;
  let mimeType = null;
  if (doc && (doc.fileBase64 || doc.storageKey)) {
    ({ storagePath, mimeType } = await resolveUploadedFile(String(job.id), { mimeType: doc.mimeType, fileBase64: doc.fileBase64, storageKey: doc.storageKey }));
  }
  await db.prepare(`UPDATE jobs SET status='DELIVERED', delivered_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(job.id);
  if (doc && (doc.fileUrl || storagePath)) {
    await db.prepare('INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,?,?,?,?,?)').run(
      job.id,
      actorId,
      DOC_TYPES.includes(doc.docType) ? doc.docType : 'POD',
      doc.title || 'Proof of Delivery',
      doc.fileUrl || storagePath || '',
      storagePath,
      mimeType
    );
  }
  await writeAudit(req || null, {
    userId: actorId,
    action: 'STATUS',
    details: `${job.job_code}: POD submitted`,
    entityType: 'job',
    entityId: job.id,
    beforeState: 'IN_TRANSIT',
    afterState: 'DELIVERED',
  });
  const { auto_release_hours } = await getSettings();
  await notify(job.shipper_id, 'Proof of delivery submitted', `Confirm delivery on ${job.job_code}, or it auto-releases in ${auto_release_hours}h.`, job.id, 'status');
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
}

module.exports = { confirmDelivery };

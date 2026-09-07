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
  // PAY_ON_DELIVERY tier: award skipped escrow entirely — this is where payment
  // becomes due. Lives here (not in the route) so the WhatsApp "Delivered"
  // button triggers the exact same escrow/ledger path as the web POD upload.
  // Guarded for once-only firing under retried/duplicate POD submissions.
  if (job.payment_tier === 'PAY_ON_DELIVERY' && job.escrow_status === 'PENDING') {
    try {
      const ledger = require('../lib/ledger');
      await db.transaction(async (/** @type {any} */ trx) => {
        const locked = await trx.query(`SELECT escrow_status, agreed_price_aed FROM jobs WHERE id=? FOR UPDATE`, [job.id]);
        const current = locked.rows[0];
        if (!current || current.escrow_status !== 'PENDING') return;
        await trx.query(
          `UPDATE jobs SET escrow_status='HELD', processor_payment_status='REQUIRES_PAYMENT', updated_at=datetime('now') WHERE id=?`,
          [job.id]
        );
        await ledger.createTransaction(trx, {
          idempotencyKey: `pay-on-delivery-${job.id}`,
          jobId: job.id,
          description: `Payment due on delivery ${job.job_code} AED ${current.agreed_price_aed}`,
          entries: [
            { account: 'processor_clearing', side: 'DEBIT', amountMinor: ledger.toMinor(current.agreed_price_aed) },
            { account: 'escrow_liability', side: 'CREDIT', amountMinor: ledger.toMinor(current.agreed_price_aed) },
          ],
        });
      });
      await notify(job.shipper_id, 'Payment due', `${job.job_code} was delivered — payment is now due (pay-on-delivery).`, job.id, 'payout');
    } catch (e) { console.error(`[delivery] PAY_ON_DELIVERY escrow failed for job ${job.id}:`, e); }
  }
  // Equipment capacity — trip done, carrier slot free again. Restores exactly
  // what award.service.js decremented (total incl. job_line_items extras).
  // Lives here so WhatsApp-confirmed deliveries restore capacity too,
  // not just web-POD ones.
  try {
    const { jobUnitCount } = require('../lib/capacity');
    const unitCount = await jobUnitCount(job);
    await db.prepare(`UPDATE profiles SET available_units = available_units + ? WHERE user_id=?`).run(unitCount, job.carrier_id);
    await db.prepare(
      `INSERT INTO carrier_capacity_events (carrier_id, job_id, event_type, units_delta, note) VALUES (?,?,?,?,?)`
    ).run(job.carrier_id, job.id, 'RESTORED', unitCount, `Delivered ${job.job_code}`);
  } catch (e) { console.error(`[delivery] capacity restore failed for job ${job.id}:`, e); }
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

// Extracted from job-lifecycle.routes.js's POST /api/jobs/:id/dispute so the
// WhatsApp bot's "Issue" button reply (server/routes/whatsapp.routes.js)
// files a dispute through the exact same path the web dashboard's dispute
// form uses, instead of a second, drifting copy of this logic. Auth/
// ownership checks stay in each caller (the route already checked
// req.user is a participant; the webhook resolves the sender's job
// independently) — this function assumes the caller has already
// established the actor is allowed to dispute this job.
const db = require('../db');
const { writeAudit, recordShipmentEvent, notify, notifyAdmins } = require('../lib/helpers');

// Single source of truth — also re-exported for the route and the
// DisputePanel-equivalent web form to validate against.
const DISPUTE_TYPES = ['PRICE', 'DELAY_DEMURRAGE', 'DAMAGE_SHORTAGE', 'MISSING_DOCS', 'NO_SHOW', 'PAYMENT_VAT', 'FRAUD_IDENTITY', 'OTHER'];

/**
 * @param {any} job
 * @param {{ actorId: number, reason: string, disputeType: string, req?: any, actorLabel?: string, openedByUserId?: number }} opts
 */
async function fileDispute(job, { actorId, reason, disputeType, req, actorLabel, openedByUserId }) {
  const { DISPUTABLE_STATUSES } = require('../lib/constants');
  if (!DISPUTABLE_STATUSES.includes(job.status)) {
    const e = new Error(`Cannot dispute a job in ${job.status} status`);
    e.status = 403;
    throw e;
  }
  if (!DISPUTE_TYPES.includes(disputeType)) {
    const e = new Error(`disputeType must be one of: ${DISPUTE_TYPES.join(', ')}`);
    e.status = 400;
    throw e;
  }
  // Per-type minimum evidence — require photo evidence to already exist
  // rather than accepting an empty claim and leaving the admin to chase it
  // down. Scoped to the two types with a clear, mechanical evidence check
  // today; the other types are surfaced to the admin at resolution time
  // instead (see the evidence-bundle logic on the resolve side).
  if (disputeType === 'DAMAGE_SHORTAGE') {
    const hasEirPhoto = await db.prepare(`SELECT 1 FROM job_documents WHERE job_id=? AND doc_type='EIR'`).get(job.id);
    if (!hasEirPhoto) {
      const e = new Error('A damage/shortage dispute requires at least one EIR photo already on file for this job');
      e.status = 400;
      throw e;
    }
  }
  if (disputeType === 'NO_SHOW') {
    const hasLocation = await db.prepare(`SELECT 1 FROM location_logs WHERE job_id=?`).get(job.id);
    if (!hasLocation) {
      const e = new Error('A no-show dispute requires at least one recorded location ping, or a gate-attempt photo uploaded as a document first');
      e.status = 400;
      throw e;
    }
  }

  // opened_by is the root account, not the acting seat — matches every
  // other "who owns this record" field in the app (e.g. jobs.shipper_id),
  // while actorId below stays seat-level for audit/event attribution.
  const ownerId = openedByUserId || actorId;
  const result = /** @type {any} */ (await db.prepare(
    `INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, sla_deadline) VALUES (?,?,?,'OPEN',?,datetime('now','+48 hours')) RETURNING id`
  ).run(job.id, ownerId, String(reason).trim(), disputeType));
  await db.prepare(`UPDATE jobs SET status='DISPUTED', escrow_status='DISPUTED', updated_at=datetime('now') WHERE id=?`).run(job.id);
  await writeAudit(req || null, {
    userId: actorId,
    action: 'DISPUTE_OPEN',
    details: String(reason).trim(),
    entityType: 'job',
    entityId: job.id,
    beforeState: job.status,
    afterState: 'DISPUTED',
  });
  try {
    await recordShipmentEvent(job.id, {
      eventType: 'DISPUTE_OPENED',
      actorId,
      actorRole: ownerId === job.shipper_id ? 'SHIPPER' : 'CARRIER',
      summary: `${job.job_code}: dispute opened (${disputeType})`,
      data: { disputeType, disputeId: Number(result.lastInsertRowid) },
    });
  } catch (e) { console.error(`[shipment_events] DISPUTE_OPENED record failed for job ${job.id}:`, e); }
  const other = ownerId === job.shipper_id ? job.carrier_id : job.shipper_id;
  await notify(other, 'Dispute opened', `${job.job_code}: a dispute was opened by the counterparty. Escrow is frozen pending admin review.`, job.id, 'dispute');
  let label = actorLabel;
  if (!label) {
    const actor = await db.prepare('SELECT email FROM users WHERE id=?').get(actorId);
    label = (actor && actor.email) || `user#${actorId}`;
  }
  await notifyAdmins('New dispute filed', `${job.job_code}: filed by ${label}. Escrow frozen, awaiting review.`, job.id);
  return db.prepare('SELECT * FROM disputes WHERE id=?').get(Number(result.lastInsertRowid));
}

module.exports = { fileDispute, DISPUTE_TYPES };

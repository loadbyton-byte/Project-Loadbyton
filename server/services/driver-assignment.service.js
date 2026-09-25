// Extracted from job-lifecycle.routes.js's PATCH /api/jobs/:id/driver so a
// trip-offer acceptance over WhatsApp (server/routes/whatsapp.routes.js)
// binds a driver the exact same way the web dashboard's reassign flow
// does — one implementation, not two. Callers are responsible for their
// own authorization/status checks before calling this.
const db = require('../db');
const { writeAudit, recordShipmentEvent, notify } = require('../lib/helpers');
const { notifyDriverAsync } = require('../lib/whatsapp');

/**
 * @param {any} job
 * @param {{ driverId?: number, driverName: string, driverPhone: string, actorId: number, req?: any }} opts
 */
async function bindDriverToJob(job, { driverId, driverName, driverPhone, actorId, req }) {
  await db.prepare(`UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone=?, assigned_driver_id=?, updated_at=datetime('now') WHERE id=?`).run(
    driverName,
    driverPhone,
    driverId || null,
    job.id
  );
  await writeAudit(req || null, {
    userId: actorId,
    action: 'DRIVER_REASSIGN',
    details: `${job.job_code}: driver changed from ${job.assigned_driver_name || 'unset'} (${job.assigned_driver_phone || 'unset'}) to ${driverName} (${driverPhone})`,
    entityType: 'job',
    entityId: job.id,
    beforeState: job.assigned_driver_phone || 'unset',
    afterState: driverPhone,
  });
  try {
    await recordShipmentEvent(job.id, {
      eventType: 'DRIVER_ASSIGNED',
      actorId: actorId,
      actorRole: 'CARRIER',
      summary: `${job.job_code}: driver assigned — ${driverName}${driverId ? '' : ' (not linked to carrier roster)'}`,
      data: { driverId: driverId || null, driverName, driverPhone },
    });
  } catch (e) { console.error(`[shipment_events] DRIVER_ASSIGNED record failed for job ${job.id}:`, e); }
  await notify(job.shipper_id, 'Driver reassigned', `${job.job_code}: the assigned driver was changed to ${driverName}.`, job.id, 'status');
  // Deliberately does not pin whatsapp_sessions.last_outbound_job_id here —
  // this send is informational only (no buttons, no reply expected), so it
  // must not steal the "which job is this conversation about" pin away
  // from a job that's genuinely mid-exchange (e.g. an IN_TRANSIT delivery-
  // confirmation prompt still awaiting Delivered/Delayed/Issue). Only sends
  // that actually invite a specific reply pin — see lib/whatsapp.js's
  // recordOutboundJobContext() and its call sites.
  notifyDriverAsync({
    to: driverPhone,
    template: 'job_awarded_pickup_details',
    params: [driverName, job.job_code, job.pickup_terminal],
  });
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
}

module.exports = { bindDriverToJob };

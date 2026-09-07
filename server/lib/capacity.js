// Capacity unit accounting — single implementation for award (decrement),
// delivery restore, and cancellation restore.
//
// A multi-line-item job (Change 2, Prompt 2) stores line item 1 in the
// job's own container_count/truck_count columns and any extras in
// job_line_items. The carrier's occupied capacity is the SUM of all of
// them, not just the first — PR #32 flagged this cross-branch interaction
// explicitly, this is the fix.
const db = require('../db');

/**
 * Total capacity units a job occupies.
 * LOCAL → truck_count (line items are a container concept, never apply).
 * Otherwise → container_count (line item 1) + SUM(job_line_items.count).
 * Missing table / query failure → falls back to the legacy single-count
 * behavior rather than breaking the award/delivery/cancel transaction.
 * @param {any} job
 * @param {{ trx?: any }} [opts] - optional transaction query interface
 */
async function jobUnitCount(job, opts = {}) {
  if (job.shipment_type === 'LOCAL') return job.truck_count || 1;
  const base = job.container_count || 1;
  try {
    if (opts.trx) {
      const r = await opts.trx.query(`SELECT COALESCE(SUM(count),0) AS extra FROM job_line_items WHERE job_id=?`, [job.id]);
      return base + (Number(r.rows[0]?.extra) || 0);
    }
    const row = await db.prepare(`SELECT COALESCE(SUM(count),0) AS extra FROM job_line_items WHERE job_id=?`).get(job.id);
    return base + (Number(row?.extra) || 0);
  } catch {
    return base;
  }
}

module.exports = { jobUnitCount };

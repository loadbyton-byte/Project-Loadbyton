const db = require('../db');

async function findByJobId(jobId) {
  return db.prepare('SELECT * FROM payouts WHERE job_id=?').get(jobId);
}

async function findById(id) {
  return db.prepare('SELECT * FROM payouts WHERE id=?').get(id);
}

async function create({ jobId, carrierId, grossAed, platformFeeAed, netAed, idempotencyKey }) {
  const r = await db.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, idempotency_key) VALUES (?,?,?,?,?, 'PENDING', ?)`
  ).run(jobId, carrierId, grossAed, platformFeeAed, netAed, idempotencyKey);
  return findById(Number(r.lastInsertRowid));
}

async function markReleased(jobId) {
  await db.prepare(`UPDATE payouts SET status='RELEASED', released_at=datetime('now'), sla_deadline=datetime('now', '+48 hours') WHERE job_id=?`).run(jobId);
}

module.exports = { findByJobId, findById, create, markReleased };

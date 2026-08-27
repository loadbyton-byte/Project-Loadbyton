const db = require('../db');

async function findById(id) {
  return db.prepare('SELECT * FROM bids WHERE id=?').get(id);
}

async function findByJobAndCarrier(jobId, carrierId) {
  return db.prepare('SELECT * FROM bids WHERE job_id=? AND carrier_id=?').all(jobId, carrierId);
}

async function findPendingByJob(jobId) {
  return db.prepare("SELECT * FROM bids WHERE job_id=? AND status='PENDING'").all(jobId);
}

async function create({ jobId, carrierId, amountAed, etaMinutes, truckType, notes }) {
  const r = await db.prepare(
    `INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, truck_type, notes) VALUES (?,?,?,?,?,?)`
  ).run(jobId, carrierId, amountAed, etaMinutes || 0, truckType || null, notes || null);
  return findById(Number(r.lastInsertRowid));
}

module.exports = { findById, findByJobAndCarrier, findPendingByJob, create };

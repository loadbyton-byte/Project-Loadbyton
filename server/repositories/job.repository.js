const db = require('../db');

async function findById(id, { forUpdate = false } = {}) {
  const sql = forUpdate ? 'SELECT * FROM jobs WHERE id=? FOR UPDATE' : 'SELECT * FROM jobs WHERE id=?';
  const row = await db.prepare(sql).get(id);
  return row || null;
}

async function findByCode(code) {
  return db.prepare('SELECT * FROM jobs WHERE job_code=?').get(code);
}

async function findOpenWithFilters({ status, equipmentType, escrowStatus, shipmentType, q, sort, limit, offset, user }) {
  const { JOB_SORT_COLUMNS, EQUIPMENT_TYPES, SHIPMENT_TYPES, ESCROW_STATUSES } = require('../lib/constants');
  let where = '1=1';
  const params = [];
  // user scoping handled by caller — this is pure query building
  if (status) {
    const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length) {
      where += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
  }
  if (equipmentType && EQUIPMENT_TYPES.includes(equipmentType)) {
    where += ' AND equipment_type = ?';
    params.push(equipmentType);
  }
  if (escrowStatus && ESCROW_STATUSES.includes(escrowStatus)) {
    where += ' AND escrow_status = ?';
    params.push(escrowStatus);
  }
  const orderBy = JOB_SORT_COLUMNS[sort] || JOB_SORT_COLUMNS.date_desc;
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  const total = (await db.prepare(`SELECT COUNT(*) c FROM jobs WHERE ${where}`).get(...params)).c;
  const rows = await db.prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, lim, off);
  return { rows, total, limit: lim, offset: off };
}

async function updateStatus(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k}=?`);
    vals.push(v);
  }
  if (!sets.length) return;
  vals.push(id);
  await db.prepare(`UPDATE jobs SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...vals);
}

module.exports = { findById, findByCode, findOpenWithFilters, updateStatus };

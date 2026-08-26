const crypto = require('node:crypto');
const db = require('../db');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
async function writeAuditChained(req, { userId, action, details, entityType, entityId, beforeState, afterState }) {
  const prev = (await db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get())?.hash || 'GENESIS';
  const ts = new Date().toISOString();
  const hash = sha256(`${prev}|${action}|${entityType || ''}|${entityId || ''}|${ts}`);
  await db.prepare(`INSERT INTO audit_log (user_id,action,details,entity_type,entity_id,before_state,after_state,request_id,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(userId || req?.actorId || null, action, details || null, entityType || null, entityId || null, beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null, req?.requestId || null, prev, hash);
  return hash;
}
module.exports = { writeAuditChained, sha256 };

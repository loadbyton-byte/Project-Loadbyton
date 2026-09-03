// Thread resolution + access control for multi-party job messaging.
// A thread is keyed by (job_id, role-pair) — not by specific user IDs —
// because a job has exactly one shipper and (once awarded) exactly one
// carrier, so "the shipper's thread with the carrier" is already unique
// without naming users. ADMIN is a role any admin can answer (a queue, like
// the existing dispute/verification consoles), not a specific admin user.
const db = require('../db');

// Position in this array = canonical rank. Lower rank always becomes
// party_a_role, so (SHIPPER, ADMIN) and (ADMIN, SHIPPER) requests resolve
// to the same stored row instead of creating two threads for one
// conversation.
const ROLE_ORDER = ['SHIPPER', 'CARRIER', 'ADMIN', 'DRIVER'];

function canonicalizeRoles(roleA, roleB) {
  if (!ROLE_ORDER.includes(roleA) || !ROLE_ORDER.includes(roleB)) {
    throw { status: 400, message: `roles must be one of ${ROLE_ORDER.join(', ')}` };
  }
  if (roleA === roleB) throw { status: 400, message: 'cannot open a thread with yourself' };
  return ROLE_ORDER.indexOf(roleA) < ROLE_ORDER.indexOf(roleB) ? [roleA, roleB] : [roleB, roleA];
}

async function resolveOrCreateThread(jobId, roleA, roleB) {
  const [partyA, partyB] = canonicalizeRoles(roleA, roleB);
  const existing = await db.prepare('SELECT * FROM message_threads WHERE job_id=? AND party_a_role=? AND party_b_role=?').get(jobId, partyA, partyB);
  if (existing) return existing;
  try {
    const result = await db.prepare('INSERT INTO message_threads (job_id, party_a_role, party_b_role) VALUES (?,?,?) RETURNING id').run(jobId, partyA, partyB);
    return await db.prepare('SELECT * FROM message_threads WHERE id=?').get(Number(result.lastInsertRowid));
  } catch (e) {
    // Two requests racing to open the same thread — the UNIQUE index is the
    // real guard; whichever loses just reads back the winner's row.
    if (/unique|duplicate/i.test(e.message || '')) {
      return await db.prepare('SELECT * FROM message_threads WHERE job_id=? AND party_a_role=? AND party_b_role=?').get(jobId, partyA, partyB);
    }
    throw e;
  }
}

// Does this user sit on either side of this thread, for this specific job?
// SHIPPER/CARRIER must actually be the job's shipper/awarded carrier, not
// just anyone holding that role platform-wide; ADMIN is any admin.
function isThreadParticipant(job, thread, user) {
  const roles = [thread.party_a_role, thread.party_b_role];
  if (user.role === 'ADMIN') return roles.includes('ADMIN');
  if (user.role === 'SHIPPER') return roles.includes('SHIPPER') && job.shipper_id === user.id;
  if (user.role === 'CARRIER') return roles.includes('CARRIER') && job.carrier_id === user.id;
  return false;
}

// Which roles can this user open a new thread with, on this job, right now?
// Matches the existing isPartyOnJob gate messaging already had (no
// messaging on an OPEN job with no counterparty yet).
function availableRecipientRoles(job, user) {
  const NOT_YET = ['OPEN', 'DRAFT'];
  if (NOT_YET.includes(job.status)) return [];
  if (user.role === 'SHIPPER' && job.shipper_id === user.id) {
    return job.carrier_id ? ['CARRIER', 'ADMIN'] : ['ADMIN'];
  }
  if (user.role === 'CARRIER' && job.carrier_id === user.id) {
    return ['SHIPPER', 'ADMIN'];
  }
  if (user.role === 'ADMIN') {
    return job.carrier_id ? ['SHIPPER', 'CARRIER'] : ['SHIPPER'];
  }
  return [];
}

module.exports = { ROLE_ORDER, canonicalizeRoles, resolveOrCreateThread, isThreadParticipant, availableRecipientRoles };

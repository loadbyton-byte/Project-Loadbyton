// Cross-job inbox — lists every thread the current actor is a party to,
// across all their jobs, reusing the exact participation rules Stage B's
// per-job view uses (lib/messaging.js) rather than a parallel set of role
// checks. Deliberately not reachable by a DRIVER seat (see
// middleware/auth.js's DRIVER_SEAT_ALLOWED_ROUTES) — a driver's whole app
// is one job, no cross-job history to browse.
const db = require('../db');
const { auth } = require('../middleware/auth');
const { effectiveRole } = require('../lib/helpers');
const { isThreadParticipant } = require('../lib/messaging');

const router = require('express').Router();

router.get('/api/messages/threads', auth(), async (req, res) => {
  const myRole = effectiveRole(req.user);
  let rows;
  if (req.user.role === 'ADMIN') {
    rows = await db
      .prepare(`SELECT mt.*, j.job_code, j.status as job_status FROM message_threads mt JOIN jobs j ON j.id = mt.job_id WHERE mt.party_a_role='ADMIN' OR mt.party_b_role='ADMIN'`)
      .all();
  } else if (myRole === 'DRIVER') {
    rows = await db
      .prepare(
        `SELECT mt.*, j.job_code, j.status as job_status FROM message_threads mt
         JOIN jobs j ON j.id = mt.job_id JOIN drivers d ON d.id = j.assigned_driver_id
         WHERE (mt.party_a_role='DRIVER' OR mt.party_b_role='DRIVER') AND d.seat_user_id=?`
      )
      .all(req.user.actingSeatId);
  } else if (myRole === 'SHIPPER') {
    rows = await db
      .prepare(`SELECT mt.*, j.job_code, j.status as job_status FROM message_threads mt JOIN jobs j ON j.id = mt.job_id WHERE (mt.party_a_role='SHIPPER' OR mt.party_b_role='SHIPPER') AND j.shipper_id=?`)
      .all(req.user.id);
  } else if (myRole === 'CARRIER') {
    rows = await db
      .prepare(`SELECT mt.*, j.job_code, j.status as job_status FROM message_threads mt JOIN jobs j ON j.id = mt.job_id WHERE (mt.party_a_role='CARRIER' OR mt.party_b_role='CARRIER') AND j.carrier_id=?`)
      .all(req.user.id);
  } else {
    rows = [];
  }

  const threads = [];
  for (const t of rows) {
    const last = await db.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY created_at DESC LIMIT 1').get(t.id);
    const unread = await db.prepare('SELECT COUNT(*) as n FROM messages WHERE thread_id=? AND is_read=0 AND sender_id!=?').get(t.id, req.actorId);
    const otherRole = t.party_a_role === myRole ? t.party_b_role : t.party_a_role;
    threads.push({
      id: t.id,
      jobId: t.job_id,
      jobCode: t.job_code,
      jobStatus: t.job_status,
      otherRole,
      lastMessage: last || null,
      unreadCount: unread ? Number(unread.n) : 0,
    });
  }
  threads.sort((a, b) => {
    const at = a.lastMessage ? a.lastMessage.created_at : '';
    const bt = b.lastMessage ? b.lastMessage.created_at : '';
    return bt.localeCompare(at);
  });
  res.json({ threads });
});

router.post('/api/messages/threads/:id/read', auth(), async (req, res) => {
  const thread = await db.prepare('SELECT * FROM message_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(thread.job_id);
  if (!job || !(await isThreadParticipant(job, thread, req.user))) return res.status(403).json({ error: 'Not permitted' });
  await db.prepare('UPDATE messages SET is_read=1 WHERE thread_id=? AND sender_id!=?').run(thread.id, req.actorId);
  res.json({ ok: true });
});

module.exports = router;

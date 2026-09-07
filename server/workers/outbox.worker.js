// Outbox worker — reliable event delivery for financial transactions.
// Polls outbox_events (inserted atomically with award/payout transactions)
// and delivers to side-effects (email, WhatsApp, analytics). For now it
// just marks events as processed and logs; the delivery logic is pluggable.
const db = require('../db');
const { logger } = require('../lib/logger');

let timer = null;

async function processOutboxBatch(limit = 20) {
  let events;
  try {
    events = await db.prepare(`SELECT * FROM outbox_events WHERE status='PENDING' ORDER BY id ASC LIMIT ?`).all(limit);
  } catch (e) {
    if (e.message && /no such table/i.test(e.message)) return 0;
    throw e;
  }
  if (!events.length) return 0;

  for (const ev of events) {
    try {
      // Atomic claim: this worker also runs on its own setInterval per
      // process (below), with no distributed lock — the WHERE clause
      // repeats the SELECT's status='PENDING' guard so a second instance
      // that already claimed and processed this same event between the
      // SELECT and here finds nothing left to update (0 changes) instead
      // of re-processing it.
      const claim = await db.prepare(`UPDATE outbox_events SET status='PROCESSED', processed_at=? WHERE id=? AND status='PENDING'`).run(new Date().toISOString(), ev.id);
      if (!claim.changes) continue;
      // Future: dispatch to real handlers based on ev.event_type
      // e.g., if (ev.event_type === 'JOB_AWARDED') await sendAwardNotifications(JSON.parse(ev.payload))
      logger.info('outbox_processed', { eventId: ev.id, type: ev.event_type, aggregate: `${ev.aggregate_type}:${ev.aggregate_id}` });
    } catch (e) {
      logger.error('outbox_failed', { eventId: ev.id, error: e.message });
      try {
        await db.prepare(`UPDATE outbox_events SET status='FAILED' WHERE id=?`).run(ev.id);
      } catch {}
    }
  }
  return events.length;
}

function startOutboxWorker({ intervalMs = 5000 } = {}) {
  if (timer) return;
  // Only run when not in test (harness sets NODE_ENV=test with temp DB)
  if (process.env.NODE_ENV === 'test') return;
  timer = setInterval(() => {
    processOutboxBatch().catch((e) => logger.error('outbox_worker_error', { error: e.message }));
  }, intervalMs).unref();
  logger.info('outbox_worker_started', { intervalMs });
}

function stopOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { processOutboxBatch, startOutboxWorker, stopOutboxWorker };

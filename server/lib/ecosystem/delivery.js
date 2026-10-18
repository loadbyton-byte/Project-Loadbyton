// Delivers queued ecosystem events to LOAD|BY|TON.store as signed webhooks.
//
// Receiver contract (same as the Store's merchant webhooks): verify
// LBT-Signature over the raw body, reject a timestamp older than 5 minutes,
// de-duplicate on the event id, answer 2xx within 10 s. Anything else is
// retried with growing back-off; after DELIVERY_MAX_ATTEMPTS the event is
// parked as DEAD for review. A 410 stops delivery immediately. Redirects are
// not followed.

'use strict';

const db = require('../../db');
const { sign } = require('./signing');
const { DELIVERY_MAX_ATTEMPTS } = require('./constants');

const LEASE_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10000;

const backoffSeconds = (attempts) => Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));

async function deliverPending({ limit = 20, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const url = process.env.STORE_WEBHOOK_URL;
  const secret = process.env.ECOSYSTEM_SHARED_SECRET;
  if (!url || !secret) return { skipped: true, delivered: 0, failed: 0, dead: 0 };
  const due = await db.prepare(
    `SELECT * FROM ecosystem_events WHERE status='PENDING' AND next_attempt_at<=? ORDER BY id ASC LIMIT ?`).all(now.toISOString(), limit);
  const out = { skipped: false, delivered: 0, failed: 0, dead: 0 };
  for (const ev of due) {
    // Lease: push the next attempt out so a second worker skips this row.
    const lease = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
    const claim = await db.prepare(
      `UPDATE ecosystem_events SET attempts=attempts+1, next_attempt_at=? WHERE id=? AND status='PENDING' AND next_attempt_at<=?`)
      .run(lease, ev.id, now.toISOString());
    if (!claim.changes) continue;
    const attempts = ev.attempts + 1;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST', redirect: 'manual', signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'LBT-Signature': sign(secret, ev.body, now.getTime()), 'LBT-Event-Id': ev.event_id },
          body: ev.body,
        });
      } finally { clearTimeout(timer); }
      if (res.status >= 200 && res.status < 300) {
        await db.prepare(`UPDATE ecosystem_events SET status='DELIVERED', delivered_at=?, last_error=NULL WHERE id=?`).run(now.toISOString(), ev.id);
        out.delivered += 1;
        continue;
      }
      if (res.status === 410) {
        await db.prepare(`UPDATE ecosystem_events SET status='DEAD', last_error=? WHERE id=?`).run('receiver answered 410 Gone', ev.id);
        out.dead += 1;
        continue;
      }
      throw new Error(`receiver answered ${res.status}`);
    } catch (e) {
      const message = String(e.message || e).slice(0, 300);
      if (attempts >= DELIVERY_MAX_ATTEMPTS) {
        await db.prepare(`UPDATE ecosystem_events SET status='DEAD', last_error=? WHERE id=?`).run(message, ev.id);
        out.dead += 1;
      } else {
        const next = new Date(now.getTime() + backoffSeconds(attempts) * 1000).toISOString();
        await db.prepare(`UPDATE ecosystem_events SET next_attempt_at=?, last_error=? WHERE id=?`).run(next, message, ev.id);
        out.failed += 1;
      }
    }
  }
  return out;
}

module.exports = { deliverPending, backoffSeconds };

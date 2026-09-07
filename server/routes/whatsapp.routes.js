// WhatsApp inbound webhook — the two-way half of server/lib/whatsapp.js's
// existing send-only integration (see docs/WHATSAPP_SETUP.md for why the
// whole channel stays dark until Meta Business Verification + template
// approval finish; that's an external process, not a code gap).
//
// Narrow first flow only: resolve the inbound phone number to a driver (or
// a shipper/carrier profile), attach the message to that party's most
// relevant job, and — for the delivery-confirmation bot flow specifically —
// interpret a "Delivered" button reply by calling the exact same
// confirmDelivery() path the web dashboard's POD upload already uses. No
// free-text NLP, no other flows, per this pass's scope.
const crypto = require('node:crypto');
const db = require('../db');
const { confirmDelivery } = require('../services/delivery.service');
const { recordInboundSession } = require('../lib/whatsapp');
const { resolveOrCreateThread } = require('../lib/messaging');
const router = require('express').Router();

// Meta's subscription verification handshake — GET with hub.mode/verify_token/
// challenge, must echo the challenge back exactly when the token matches.
router.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta signs the payload with the app secret (X-Hub-Signature-256). When
// WHATSAPP_APP_SECRET isn't set, verification is skipped — matches this
// codebase's existing "dark until configured" pattern rather than a hard
// failure for an integration nobody's turned on yet.
function verifySignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Compares only the last 9 digits (the local UAE mobile part) since stored
// phone numbers exist in a mix of formats (+971..., 0..., bare 5...) while
// Meta's `from` field always arrives as bare E.164 digits (e.g. 971501234567).
function last9Digits(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9);
}

function extractContent(msg) {
  if (msg.type === 'text') return msg.text && msg.text.body ? msg.text.body : null;
  if (msg.type === 'interactive' && msg.interactive && msg.interactive.type === 'button_reply') {
    return `[Bot reply] ${msg.interactive.button_reply.title}`;
  }
  if (msg.type === 'image') return '[Photo attachment]';
  return null;
}

// threadRoles pairs with lib/messaging.js's resolveOrCreateThread so an
// inbound WhatsApp message lands in the SAME conversation a web reply would
// use, rather than a disconnected side-channel — the whole point of adding
// a channel concept instead of a parallel messaging system.
async function resolveSender(last9) {
  const driver = await db
    .prepare(`SELECT * FROM drivers WHERE is_active=1 AND REPLACE(REPLACE(REPLACE(phone,'+',''),'-',''),' ','') LIKE '%' || ?`)
    .get(last9);
  if (driver) {
    const job = await db
      .prepare(`SELECT * FROM jobs WHERE assigned_driver_id=? AND status IN ('AWARDED','PICKED_UP','IN_TRANSIT') ORDER BY updated_at DESC LIMIT 1`)
      .get(driver.id);
    if (driver.seat_user_id) {
      return { senderId: driver.seat_user_id, job, driver, threadRoles: ['DRIVER', 'CARRIER'] };
    }
    // Roster driver with no login of their own yet — attributed to the
    // carrier, same as the ad-hoc case below.
    return { senderId: driver.carrier_id, job, driver, threadRoles: ['CARRIER', 'SHIPPER'] };
  }

  // Most drivers are bound to a job ad-hoc (PATCH /api/jobs/:id/driver's
  // name+phone, no fleet roster entry required — see job-lifecycle.routes.js)
  // rather than via the drivers table, so this is actually the more common
  // real-world match. No login identity exists for an ad-hoc driver, so the
  // inbound message/action is attributed to the carrier account, same as
  // every other job-level action taken on that driver's behalf today.
  const adHocJob = await db
    .prepare(`SELECT * FROM jobs WHERE status IN ('AWARDED','PICKED_UP','IN_TRANSIT') AND REPLACE(REPLACE(REPLACE(assigned_driver_phone,'+',''),'-',''),' ','') LIKE '%' || ? ORDER BY updated_at DESC LIMIT 1`)
    .get(last9);
  if (adHocJob) {
    return { senderId: adHocJob.carrier_id, job: adHocJob, driver: null, threadRoles: ['CARRIER', 'SHIPPER'] };
  }

  const profile = await db
    .prepare(`SELECT p.user_id, u.role FROM profiles p JOIN users u ON u.id = p.user_id WHERE REPLACE(REPLACE(REPLACE(p.phone,'+',''),'-',''),' ','') LIKE '%' || ?`)
    .get(last9);
  if (profile) {
    const job = await db
      .prepare(`SELECT * FROM jobs WHERE shipper_id=? OR carrier_id=? ORDER BY updated_at DESC LIMIT 1`)
      .get(profile.user_id, profile.user_id);
    const threadRoles = profile.role === 'SHIPPER' ? ['SHIPPER', 'CARRIER'] : profile.role === 'CARRIER' ? ['CARRIER', 'SHIPPER'] : null;
    return { senderId: profile.user_id, job, driver: null, threadRoles };
  }

  return { senderId: null, job: null, driver: null, threadRoles: null };
}

async function handleInboundMessage(msg) {
  const digits = String(msg.from || '').replace(/\D/g, '');
  if (!digits) return;
  await recordInboundSession(digits).catch(() => {});

  const { senderId, job, threadRoles } = await resolveSender(last9Digits(digits));
  const content = extractContent(msg);

  if (senderId && job && content) {
    let threadId = null;
    if (threadRoles) {
      try {
        const thread = await resolveOrCreateThread(job.id, threadRoles[0], threadRoles[1]);
        threadId = thread.id;
      } catch {
        // Falls back to an unthreaded message rather than dropping it —
        // still visible via the raw messages table even if the thread
        // views can't render it.
      }
    }
    await db
      .prepare(`INSERT INTO messages (job_id, sender_id, thread_id, content, channel, whatsapp_message_id) VALUES (?,?,?,?,'WHATSAPP',?)`)
      .run(job.id, senderId, threadId, content, msg.id || null);
  } else if (content) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp:webhook] inbound from unrecognized/jobless number ${digits}: ${content}`);
  }

  if (msg.type === 'interactive' && msg.interactive && msg.interactive.type === 'button_reply' && job) {
    const buttonId = msg.interactive.button_reply.id;
    if (buttonId === 'DELIVERED') {
      try {
        await confirmDelivery(job, { actorId: senderId, req: null });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[whatsapp:webhook] confirmDelivery failed for job ${job.id}:`, err.message);
      }
    }
    // 'DELAYED' / 'ISSUE' — logged as an inbound message above for a human
    // to follow up on; no automated status transition for those in this
    // narrow first pass.
  }
}

// Body is already parsed + req.rawBody already captured globally in app.js's
// express.json() middleware (applied before the routes array is mounted) —
// no per-route body parser needed here.
router.post('/api/whatsapp/webhook', async (req, res) => {
  // Meta requires a fast ack and retries aggressively on non-2xx/timeout —
  // acknowledge first, process after, matching this repo's other
  // fire-and-forget webhook-adjacent patterns.
  if (!verifySignature(req)) return res.sendStatus(403);
  res.sendStatus(200);

  try {
    const entry = req.body && req.body.entry && req.body.entry[0];
    const value = entry && entry.changes && entry.changes[0] && entry.changes[0].value;
    const messages = value && value.messages;
    if (!Array.isArray(messages) || !messages.length) return; // e.g. a delivery-status callback, not a message
    for (const msg of messages) {
      await handleInboundMessage(msg);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp:webhook] error processing payload:', err.message);
  }
});

module.exports = router;

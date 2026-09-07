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
const { bindDriverToJob } = require('../services/driver-assignment.service');
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
  if (msg.type === 'location') return `[Shared location] ${msg.location.latitude}, ${msg.location.longitude}`;
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
    // A DRIVER_ASSOCIATE with a PENDING trip offer isn't assigned_driver_id
    // yet (that only happens on acceptance) — check for a live offer first,
    // so ACCEPT_TRIP/DECLINE_TRIP has a job to act on before binding exists.
    const tripOffer = await db.prepare(`SELECT * FROM trip_offers WHERE driver_id=? AND status='PENDING' ORDER BY offered_at DESC LIMIT 1`).get(driver.id);
    const job = tripOffer
      ? await db.prepare('SELECT * FROM jobs WHERE id=?').get(tripOffer.job_id)
      : await db.prepare(`SELECT * FROM jobs WHERE assigned_driver_id=? AND status IN ('AWARDED','PICKED_UP','IN_TRANSIT') ORDER BY updated_at DESC LIMIT 1`).get(driver.id);
    if (driver.seat_user_id) {
      return { senderId: driver.seat_user_id, job, driver, tripOffer, threadRoles: ['DRIVER', 'CARRIER'] };
    }
    // Roster driver with no login of their own yet — attributed to the
    // carrier, same as the ad-hoc case below.
    return { senderId: driver.carrier_id, job, driver, tripOffer, threadRoles: ['CARRIER', 'SHIPPER'] };
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

// A DRIVER_ASSOCIATE accepting a trip offer runs through the exact same
// compliance-engine gate (server/lib/compliance.js) as every other
// dispatch decision — "no private plates," "auto-pause on expired docs"
// must hold at acceptance time, not just at signup, per the register's own
// requirement. On pass, binds the driver via the same
// driver-assignment.service.js path the web dashboard's reassign flow
// uses — one implementation, not a second copy of the bind logic.
async function handleTripOfferResponse(tripOffer, job, driver, accepted) {
  const { sendWhatsAppMessage } = require('../lib/whatsapp');
  const { notify } = require('../lib/helpers');

  if (!accepted) {
    await db.prepare(`UPDATE trip_offers SET status='DECLINED', responded_at=datetime('now') WHERE id=?`).run(tripOffer.id);
    await notify(tripOffer.carrier_id, 'Trip offer declined', `${driver.name} declined the trip offer for ${job.job_code}.`, job.id, 'system');
    return;
  }

  const { evaluateCompliance } = require('../lib/compliance');
  const vehicle = driver.vehicle_id ? await db.prepare('SELECT * FROM vehicles WHERE id=?').get(driver.vehicle_id) : null;
  const carrierProfile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(driver.carrier_id);
  const result = await evaluateCompliance(driver, vehicle, job, carrierProfile);

  if (!result.pass) {
    await db.prepare(`UPDATE trip_offers SET status='DECLINED', decline_reason=?, responded_at=datetime('now') WHERE id=?`).run(
      result.blockers.map((b) => b.description).join('; '),
      tripOffer.id
    );
    await notify(tripOffer.carrier_id, 'Trip offer blocked — compliance', `${driver.name} cannot take ${job.job_code}: ${result.blockers.map((b) => b.description).join('; ')}`, job.id, 'system');
    sendWhatsAppMessage({ to: driver.phone, template: 'trip_offer_blocked', params: [job.job_code] }).catch(() => {});
    return;
  }

  await db.prepare(`UPDATE trip_offers SET status='ACCEPTED', responded_at=datetime('now') WHERE id=?`).run(tripOffer.id);
  await bindDriverToJob(job, { driverId: driver.id, driverName: driver.name, driverPhone: driver.phone, actorId: driver.carrier_id, req: null });
}

async function handleInboundMessage(msg) {
  const digits = String(msg.from || '').replace(/\D/g, '');
  if (!digits) return;
  await recordInboundSession(digits).catch(() => {});

  const { senderId, job, driver, tripOffer, threadRoles } = await resolveSender(last9Digits(digits));
  const content = extractContent(msg);

  // Live location, shared over WhatsApp — lands in the exact same
  // location_logs table/GET endpoint the browser-Geolocation path already
  // feeds (LiveMap.jsx), so the shipper/carrier dashboard needs no new UI:
  // it just sees points tagged source='WHATSAPP' alongside any others.
  if (msg.type === 'location' && job && msg.location) {
    const lat = Number(msg.location.latitude);
    const lng = Number(msg.location.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      await db
        .prepare(`INSERT INTO location_logs (job_id, carrier_id, lat, lng, source) VALUES (?,?,?,?,'WHATSAPP')`)
        .run(job.id, job.carrier_id, lat, lng);
    }
  }

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
    if ((buttonId === 'ACCEPT_TRIP' || buttonId === 'DECLINE_TRIP') && tripOffer) {
      await handleTripOfferResponse(tripOffer, job, driver, buttonId === 'ACCEPT_TRIP');
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

// WhatsApp inbound webhook — the two-way half of server/lib/whatsapp.js's
// existing send-only integration (see docs/WHATSAPP_SETUP.md for why the
// whole channel stays dark until Meta Business Verification + template
// approval finish; that's an external process, not a code gap).
//
// Narrow first flow only: resolve the inbound phone number to a driver (or
// a shipper/carrier profile), attach the message to that party's most
// relevant job, and interpret the delivery-confirmation bot's button
// replies by calling the same service paths the web dashboard already
// uses for each — "Delivered" through confirmDelivery(), "Issue" through
// fileDispute(). No free-text NLP, no other flows, per this pass's scope.
const crypto = require('node:crypto');
const db = require('../db');
const { confirmDelivery } = require('../services/delivery.service');
const { fileDispute } = require('../services/dispute.service');
const { bindDriverToJob } = require('../services/driver-assignment.service');
const { recordInboundSession, isConfigured: isWhatsappConfigured, downloadWhatsAppMedia, last9Digits } = require('../lib/whatsapp');
const { resolveOrCreateThread } = require('../lib/messaging');
const { saveUploadedFile, recordShipmentEvent, notify } = require('../lib/helpers');
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
// nothing is configured at all the webhook is inert (no sender resolves to
// a job, so nothing executes) and verification is skipped. But the moment
// sending is live ( WHATSAPP_ACCESS_TOKEN set), an unset APP_SECRET would
// leave inbound delivery confirmations unauthenticated — anyone could forge
// a "Delivered" reply — so that combination fails closed instead.
function verifySignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return !isWhatsappConfigured();
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractContent(msg) {
  if (msg.type === 'text') return msg.text && msg.text.body ? msg.text.body : null;
  if (msg.type === 'interactive' && msg.interactive && msg.interactive.type === 'button_reply') {
    return `[Bot reply] ${msg.interactive.button_reply.title}`;
  }
  // Real gap a QA audit found: this used to be a bare placeholder string
  // with the actual photo never fetched, and 'audio' had no case at all —
  // an inbound voice note was silently dropped, not even logged. Both now
  // also get an actual attempt at storeInboundMedia() below; this text is
  // just what lands in the chat thread either way (the real file, when the
  // download succeeds, shows up in the job's Documents tab instead).
  if (msg.type === 'image') return '[Photo attachment]';
  if (msg.type === 'audio') return '[Voice message]';
  if (msg.type === 'location') return `[Shared location] ${msg.location.latitude}, ${msg.location.longitude}`;
  return null;
}

// Downloads an inbound photo/voice-note via lib/whatsapp.js's
// downloadWhatsAppMedia() and attaches it to the job as a real
// job_documents row (doc_type WHATSAPP_MEDIA) — visible in the same
// Documents tab/section any other job document uses, not a side-channel
// only the chat thread knows about. Best-effort: dark mode, a network
// error, or an unsupported mime type all just mean no document gets
// attached (the chat message from extractContent() above still lands
// regardless) — never lets a media-download failure break processing of
// the message itself.
async function storeInboundMedia(msg, { job, senderId }) {
  if (!job || !senderId) return;
  const media = msg.type === 'image' ? msg.image : msg.type === 'audio' ? msg.audio : null;
  if (!media || !media.id) return;
  const result = await downloadWhatsAppMedia(media.id);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp:webhook] media download skipped for job ${job.id} (${result.reason}) — chat message still recorded`);
    return;
  }
  try {
    const { storagePath, mimeType } = await saveUploadedFile(String(job.id), result.mimeType, result.buffer.toString('base64'));
    const title = `WhatsApp ${msg.type === 'image' ? 'photo' : 'voice message'} — ${new Date().toISOString()}`;
    await db
      .prepare('INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,?,?,?,?,?)')
      .run(job.id, senderId, 'WHATSAPP_MEDIA', title, storagePath, storagePath, mimeType);
  } catch (err) {
    // e.g. an mp4/unsupported mime type Meta sent that saveUploadedFile's
    // allowlist rejects — log and move on, same "never break the message"
    // guarantee as a failed download above.
    // eslint-disable-next-line no-console
    console.error(`[whatsapp:webhook] storing downloaded media failed for job ${job.id}:`, err.message);
  }
}

// A phone can legitimately match more than one active job at once (a
// driver reassigned to a second load while the first is still awaiting a
// reply). "Most recently updated" alone can misroute the reply to the
// wrong one — this prefers whichever job this phone's last OUTBOUND
// WhatsApp send was actually about (whatsapp_sessions.last_outbound_job_id,
// set by lib/whatsapp.js's recordOutboundJobContext()) and only falls back
// to the updated_at ordering already baked into `candidates` when no send
// is on record for this phone, or it doesn't match any current candidate
// (e.g. that job has since left the active-status set).
async function pinnedJob(candidates, last9) {
  if (candidates.length <= 1) return candidates[0] || null;
  const session = await db.prepare('SELECT last_outbound_job_id FROM whatsapp_sessions WHERE phone=?').get(last9);
  const pinnedId = session && session.last_outbound_job_id;
  if (pinnedId) {
    const pinned = candidates.find((j) => j.id === pinnedId);
    if (pinned) return pinned;
  }
  return candidates[0];
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
    let job;
    if (tripOffer) {
      job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(tripOffer.job_id);
    } else {
      const candidates = await db.prepare(`SELECT * FROM jobs WHERE assigned_driver_id=? AND status IN ('AWARDED','PICKED_UP','IN_TRANSIT') ORDER BY updated_at DESC`).all(driver.id);
      job = await pinnedJob(candidates, last9);
    }
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
  const adHocCandidates = await db
    .prepare(`SELECT * FROM jobs WHERE status IN ('AWARDED','PICKED_UP','IN_TRANSIT') AND REPLACE(REPLACE(REPLACE(assigned_driver_phone,'+',''),'-',''),' ','') LIKE '%' || ? ORDER BY updated_at DESC`)
    .all(last9);
  const adHocJob = await pinnedJob(adHocCandidates, last9);
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
    // No pin here — informational only, no reply expected (see the comment
    // on recordOutboundJobContext()'s call sites: only sends that invite a
    // specific reply are allowed to move the "which job" pin).
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
    const result = await db
      .prepare(`INSERT INTO messages (job_id, sender_id, thread_id, content, channel, whatsapp_message_id) VALUES (?,?,?,?,'WHATSAPP',?) RETURNING id`)
      .run(job.id, senderId, threadId, content, msg.id || null);
    // A QA audit found an inbound WhatsApp message landed in the `messages`
    // table (and rendered fine on a job's own thread view) but never
    // notified anyone and never pushed a socket event — unlike the web
    // composer's send path (routes/job-extras.routes.js), which does both
    // right after its own INSERT. The Messages inbox page only refreshes
    // its conversation list on a `notification:new` event of type
    // 'message', and only live-updates an already-open thread on
    // `new_message` — with neither ever firing, a WhatsApp reply was
    // invisible there until the page was manually reloaded and the thread
    // re-opened. Mirrors job-extras.routes.js's pattern exactly: notify
    // whichever real user the thread's "other" role resolves to, then push
    // the socket event to anyone with that thread open.
    if (threadRoles) {
      const otherRole = threadRoles[1];
      const recipientId = otherRole === 'SHIPPER' ? job.shipper_id : otherRole === 'CARRIER' ? job.carrier_id : null;
      if (recipientId && recipientId !== senderId) {
        await notify(recipientId, 'New message', `New message on ${job.job_code} (via WhatsApp)`, job.id, 'message').catch(() => {});
      }
    }
    if (threadId) {
      const message = await db.prepare('SELECT * FROM messages WHERE id=?').get(Number(result.lastInsertRowid));
      try { require('../lib/socket').emitNewMessage(threadId, message); } catch {}
    }
    if (msg.type === 'image' || msg.type === 'audio') {
      await storeInboundMedia(msg, { job, senderId });
    }
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
    // 'ISSUE' files a real dispute through the same path the web dashboard's
    // dispute form uses (services/dispute.service.js) — escrow freezes and
    // an admin gets notified, rather than a chat line only a human happens
    // to read. No free-text detail is available from a button tap, so it
    // files as dispute_type OTHER for an admin to triage; the button-reply
    // text itself was already recorded as a thread message above regardless.
    // A job already DISPUTED (e.g. a repeat tap) is rejected by fileDispute
    // itself, so this can't create duplicates.
    if (buttonId === 'ISSUE' && senderId) {
      try {
        await fileDispute(job, {
          actorId: senderId,
          reason: 'Reported via WhatsApp "Issue" button reply — needs human follow-up.',
          disputeType: 'OTHER',
          req: null,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[whatsapp:webhook] auto-filing dispute for job ${job.id} failed:`, err.message);
      }
    }
    // 'DELAYED' has no job-status value to transition to (there's no
    // "delayed" state in the state machine, and inventing one is a bigger
    // schema/UI change than a button reply warrants) — so instead of
    // staying log-only, it records a real DELAY_REPORTED shipment event
    // (visible on the job's timeline, same as DRIVER_ASSIGNED/POD_SUBMITTED/
    // DISPUTE_OPENED above) and notifies the shipper immediately, so a
    // driver-reported delay actually reaches the party waiting on the load
    // instead of sitting unread in a chat thread.
    if (buttonId === 'DELAYED' && senderId) {
      try {
        await recordShipmentEvent(job.id, {
          eventType: 'DELAY_REPORTED',
          actorId: senderId,
          actorRole: senderId === job.shipper_id ? 'SHIPPER' : 'CARRIER',
          summary: `${job.job_code}: driver reported a delay via WhatsApp`,
          data: { source: 'whatsapp' },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[shipment_events] DELAY_REPORTED record failed for job ${job.id}:`, err.message);
      }
      await notify(job.shipper_id, 'Delivery delayed', `${job.job_code}: the driver reported a delay via WhatsApp.`, job.id, 'status').catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[whatsapp:webhook] delay notification failed for job ${job.id}:`, err.message);
      });
    }
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
// Reused by routes/driver.routes.js's web accept/decline endpoints — same
// compliance-check/bind logic either channel triggers it through, not a
// second copy for the case where a driver has no WhatsApp configured.
module.exports.handleTripOfferResponse = handleTripOfferResponse;
// Exported for direct testing (server/test/whatsapp-media.test.js) — lets
// a test drive the real inbound-message/media-download logic in-process
// against a real job/user, with global.fetch mocked, without needing a
// second process's fetch calls to be interceptable over HTTP.
module.exports.handleInboundMessage = handleInboundMessage;
module.exports.storeInboundMedia = storeInboundMedia;

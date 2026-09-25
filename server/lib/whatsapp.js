// WhatsApp driver messaging — TODO-4 scaffold.
//
// WHAT THIS IS: a real, provider-agnostic send function wired into the one
// moment STRATEGY.md calls launch-critical (a driver gets bound to a job at
// award — see TODO-2's assigned_driver_phone — and needs pickup details on
// the channel this market actually uses). It is code-complete for the Meta
// WhatsApp Cloud API and will genuinely send a message the moment
// WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID are set.
//
// WHAT THIS IS NOT: Meta Business API approval and template pre-approval
// are an external, non-technical process (business verification + template
// review, multi-week and outside this repo's control) — see
// docs/WHATSAPP_SETUP.md. Until that's done, every call here safely no-ops
// with a logged intent, exactly the fallback order STRATEGY.md specifies
// (WhatsApp -> SMS -> in-app; in-app notifications already fire regardless
// via notify() in server/index.js, so nothing is lost while this is dark).

// Lazily required (not at module load) — a bare require('./lib/whatsapp')
// for sendWhatsAppMessage/isConfigured must not open the shared default
// SQLite file as a side effect. It did until this fix: test/whatsapp.test.js
// predates isSessionOpen/recordInboundSession below and never expected this
// module to touch a database at all, so it doesn't isolate its own DB_PATH
// the way harness-based tests do — a top-level `require('../db')` here made
// running it alongside other test files racy ("database is locked"),
// reproducible under node --test's default file-level concurrency.
function getDb() { return require('../db'); }

const WHATSAPP_API_VERSION = 'v21.0';
const SESSION_WINDOW_HOURS = 24;

function isConfigured() {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// Stored phone numbers exist in a mix of formats (local 0-prefixed, bare
// 5-prefixed, +971-prefixed) while Meta's inbound `from` field always
// arrives as bare E.164 digits (e.g. 971501234567) — comparing only the
// last 9 digits (the local UAE mobile part) is what makes those two worlds
// match. Single implementation shared with routes/whatsapp.routes.js's
// resolveSender(), which used to keep its own private copy of this.
function last9Digits(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9);
}

// Meta only allows free-form (including interactive button/list) messages
// within 24h of the contact's last inbound message — outside that window
// only a pre-approved template may be sent. server/routes/whatsapp.routes.js
// updates this row on every inbound webhook message.
//
// A QA audit found this previously keyed whatsapp_sessions by whatever raw
// format the caller happened to pass in — recordInboundSession() got the
// webhook's bare E.164 digits (e.g. "971501234567"), while isSessionOpen()
// got a stored driver phone in local format (e.g. "0501234567"). Those
// never matched, so a session could never be found "open" for a real
// driver phone and the interactive-buttons flow always fell through to the
// template fallback, even seconds after the driver had just replied. Both
// now key on last9Digits() instead, matching every other phone comparison
// in this codebase (see routes/whatsapp.routes.js's resolveSender()).
async function isSessionOpen(phone) {
  const row = await getDb().prepare('SELECT session_expires_at FROM whatsapp_sessions WHERE phone=?').get(last9Digits(phone));
  return !!row && new Date(row.session_expires_at) > new Date();
}

async function recordInboundSession(phone) {
  const key = last9Digits(phone);
  if (!key) return;
  const expiresAt = new Date(Date.now() + SESSION_WINDOW_HOURS * 3600 * 1000).toISOString();
  await getDb().prepare(
    `INSERT INTO whatsapp_sessions (phone, last_inbound_at, session_expires_at) VALUES (?, datetime('now'), ?)
     ON CONFLICT(phone) DO UPDATE SET last_inbound_at=datetime('now'), session_expires_at=excluded.session_expires_at`
  ).run(key, expiresAt);
}

// Records which job an outbound send was about, so a later inbound reply
// from the same phone can be routed back to that specific job even if the
// phone is (or becomes, in the interim) bound to more than one active job
// — see resolveSender() in routes/whatsapp.routes.js and schema.js's
// comment on whatsapp_sessions.last_outbound_job_id. Call this ONLY for a
// send that genuinely invites a reply (the delivery-confirmation and
// trip-offer interactive-button prompts) — a purely informational push
// (e.g. "here are your pickup details", no buttons) must not steal the
// "which job is this conversation about" pin away from a job that's
// actually mid-exchange. Deliberately never opens or extends the 24h
// session window itself — only a genuine inbound message does that, per
// Meta's actual rules — so a phone with no prior
// inbound message gets a pre-expired row here, keeping isSessionOpen()
// accurate.
async function recordOutboundJobContext(phone, jobId) {
  const key = last9Digits(phone);
  if (!key || !jobId) return;
  await getDb().prepare(
    `INSERT INTO whatsapp_sessions (phone, last_inbound_at, session_expires_at, last_outbound_job_id) VALUES (?, datetime('now'), datetime('now'), ?)
     ON CONFLICT(phone) DO UPDATE SET last_outbound_job_id=excluded.last_outbound_job_id`
  ).run(key, jobId);
}

// `template` must already be an approved WhatsApp message template name
// (see docs/WHATSAPP_SETUP.md) — WhatsApp Business API rejects free-form
// text outside the 24h customer-service window, so this never attempts one.
async function sendWhatsAppMessage({ to, template, params = [] }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp:dark] would send template "${template}" to ${to} — WHATSAPP_ACCESS_TOKEN not set, see docs/WHATSAPP_SETUP.md`);
    return { sent: false, reason: 'not_configured' };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: to.replace(/[^\d+]/g, ''),
    type: 'template',
    template: {
      name: template,
      language: { code: 'en' },
      components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }] : undefined,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[whatsapp:error] ${res.status} sending "${template}" to ${to}: ${errText}`);
      return { sent: false, reason: 'provider_error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    // Never let a WhatsApp failure break the request it's attached to — the
    // in-app notification already fired via notify() regardless.
    // eslint-disable-next-line no-console
    console.error(`[whatsapp:error] sending "${template}" to ${to} failed:`, err.message);
    return { sent: false, reason: 'network_error' };
  }
}

// Fire-and-forget wrapper for call sites that must never await/block on
// delivery (e.g. inside the award transaction) — matches how notify() is
// already used as a side effect, never inline with the response.
function notifyDriverAsync({ to, template, params }) {
  sendWhatsAppMessage({ to, template, params }).catch(() => {});
}

// Sends a Meta "interactive" button message (free-form, only valid inside
// the 24h customer-service window). Used for the first real two-way bot
// flow — see docs/WHATSAPP_SETUP.md for why this stays dark until Meta
// approval is complete.
async function sendInteractiveButtons({ to, bodyText, buttons }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp:dark] would send interactive buttons [${buttons.map((b) => b.id).join(', ')}] to ${to} — WHATSAPP_ACCESS_TOKEN not set`);
    return { sent: false, reason: 'not_configured' };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: to.replace(/[^\d+]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[whatsapp:error] ${res.status} sending interactive buttons to ${to}: ${errText}`);
      return { sent: false, reason: 'provider_error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[whatsapp:error] sending interactive buttons to ${to} failed:`, err.message);
    return { sent: false, reason: 'network_error' };
  }
}

// First real two-way bot flow: delivery confirmation. Sends an interactive
// button prompt ("Delivered" / "Delayed" / "Issue") if the contact's 24h
// session is open (e.g. they've messaged recently); otherwise falls back to
// the pre-approved 'delivery_confirmation_prompt' template — Meta rejects
// free-form outside the window, so this must never attempt one there, and
// logs clearly instead of silently dropping the prompt.
async function sendDeliveryConfirmationPrompt({ to, jobCode }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  const sessionOpen = await isSessionOpen(to).catch(() => false);
  if (sessionOpen) {
    return sendInteractiveButtons({
      to,
      bodyText: `${jobCode}: have you delivered this load?`,
      buttons: [
        { id: 'DELIVERED', title: 'Delivered' },
        { id: 'DELAYED', title: 'Delayed' },
        { id: 'ISSUE', title: 'Issue' },
      ],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[whatsapp:session] 24h window closed for ${to} — sending delivery_confirmation_prompt as a template instead of interactive buttons`);
  return sendWhatsAppMessage({ to, template: 'delivery_confirmation_prompt', params: [jobCode] });
}

// Downloads an inbound media attachment (photo, voice note, document) from
// Meta's Graph API. A QA audit found this gap: inbound images only ever
// stored a literal '[Photo attachment]' placeholder string as the chat
// message, and voice/audio messages were silently dropped entirely
// (extractContent() in whatsapp.routes.js had no case for them at all) —
// neither the real photo nor the real voice note was ever fetched, so
// nothing could show up in the web dashboard's Documents tab.
//
// Two-step Meta flow (developers.facebook.com/docs/whatsapp/cloud-api/reference/media):
// resolve the media_id to a short-lived signed URL, then download from
// that URL with the same bearer token. Gated behind isConfigured() like
// every other real network call in this module — dark by default returns
// {ok:false, reason:'not_configured'} with no attempt at either request.
async function downloadWhatsAppMedia(mediaId) {
  if (!mediaId) return { ok: false, reason: 'no_media_id' };
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    });
    if (!metaRes.ok) return { ok: false, reason: 'provider_error', status: metaRes.status };
    const meta = await metaRes.json();
    if (!meta || !meta.url) return { ok: false, reason: 'no_url' };
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } });
    if (!fileRes.ok) return { ok: false, reason: 'download_failed', status: fileRes.status };
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { ok: true, buffer, mimeType: meta.mime_type || fileRes.headers.get('content-type') || null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[whatsapp:error] downloading media ${mediaId} failed:`, err.message);
    return { ok: false, reason: 'network_error' };
  }
}

module.exports = {
  sendWhatsAppMessage,
  notifyDriverAsync,
  isConfigured,
  isSessionOpen,
  recordInboundSession,
  recordOutboundJobContext,
  sendInteractiveButtons,
  sendDeliveryConfirmationPrompt,
  downloadWhatsAppMedia,
  last9Digits,
};

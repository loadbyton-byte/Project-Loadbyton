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

// Meta only allows free-form (including interactive button/list) messages
// within 24h of the contact's last inbound message — outside that window
// only a pre-approved template may be sent. server/routes/whatsapp.routes.js
// updates this row on every inbound webhook message.
async function isSessionOpen(phone) {
  const row = await getDb().prepare('SELECT session_expires_at FROM whatsapp_sessions WHERE phone=?').get(phone);
  return !!row && new Date(row.session_expires_at) > new Date();
}

async function recordInboundSession(phone) {
  const expiresAt = new Date(Date.now() + SESSION_WINDOW_HOURS * 3600 * 1000).toISOString();
  await getDb().prepare(
    `INSERT INTO whatsapp_sessions (phone, last_inbound_at, session_expires_at) VALUES (?, datetime('now'), ?)
     ON CONFLICT(phone) DO UPDATE SET last_inbound_at=datetime('now'), session_expires_at=excluded.session_expires_at`
  ).run(phone, expiresAt);
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

module.exports = {
  sendWhatsAppMessage,
  notifyDriverAsync,
  isConfigured,
  isSessionOpen,
  recordInboundSession,
  sendInteractiveButtons,
  sendDeliveryConfirmationPrompt,
};

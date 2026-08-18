// Transactional email — verification + password reset (gstack review F3).
//
// Same shape as server/lib/whatsapp.js: a real, provider-agnostic send
// function that is code-complete against a Resend-compatible HTTP API and
// will genuinely send the moment EMAIL_API_KEY/EMAIL_FROM are set. Until
// then every call safely no-ops with a logged intent (including the actual
// link, so verification/reset are still fully testable without a live
// provider) — nothing in the auth flow depends on delivery succeeding.

const fs = require('node:fs');
const path = require('node:path');

function isConfigured() {
  return !!(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[email:dark] would send "${subject}" to ${to} — EMAIL_API_KEY not set:\n${html}`);
    // Test-only capture: EMAIL_DARK_LOG_DIR makes the dark-mode payload
    // (which contains the real verification/reset link) retrievable from a
    // file, so tests can complete the verify-email flow end-to-end without
    // a live provider.
    const logDir = process.env.EMAIL_DARK_LOG_DIR;
    if (logDir) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, 'emails.log'), JSON.stringify({ to, subject, html, at: new Date().toISOString() }) + '\n');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[email:dark] could not write ${logDir}: ${e.message}`);
      }
    }
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[email:error] ${res.status} sending "${subject}" to ${to}: ${errText}`);
      return { sent: false, reason: 'provider_error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[email:error] sending "${subject}" to ${to} failed:`, err.message);
    return { sent: false, reason: 'network_error' };
  }
}

// Fire-and-forget wrapper — auth routes must never block/fail on delivery.
function sendEmailAsync(args) {
  sendEmail(args).catch(() => {});
}

module.exports = { sendEmail, sendEmailAsync, isConfigured };

//
// Same shape as server/lib/whatsapp.js: a real, provider-agnostic send
// function that is code-complete against a Resend-compatible HTTP API and
// will genuinely send the moment EMAIL_API_KEY/EMAIL_FROM are set. Until
// then every call safely no-ops with a logged intent (including the actual
// link, so verification/reset are still fully testable without a live
// provider) — nothing in the auth flow depends on delivery succeeding.

// Branded shell for every outgoing email: navy header carrying the Loadbyton
// wordmark (an absolute URL — mail clients can't resolve relative paths, and
// the solid-navy PNG avoids the transparent-PNG dark-mode inversion problem),
// the caller's content, and a one-line footer. Table layout + inline styles
// because that is what mail clients reliably render.
function brandedEmail(innerHtml) {
  const { FRONTEND_URL } = require('./config');
  const origin = (process.env.SITE_ORIGIN || FRONTEND_URL || '').replace(/\/$/, '');
  const logo = `${origin}/brand/logo-wordmark-on-navy.png`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F5F6F4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F4;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
      <tr><td style="background:#0F2B3D;padding:0;line-height:0;">
        <a href="${origin}" style="text-decoration:none;"><img src="${logo}" alt="Loadbyton" width="260" style="display:block;border:0;height:auto;max-width:100%;" /></a>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;color:#0F2129;font-size:15px;line-height:1.6;">${innerHtml}</td></tr>
      <tr><td style="padding:16px 28px 24px;color:#586A72;font-size:12px;border-top:1px solid #E5E8E3;">Loadbyton — UAE road freight &amp; container drayage marketplace</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function isConfigured() {
  return !!(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!/^\s*<!doctype html/i.test(html || '')) html = brandedEmail(html || '');
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[email:dark] would send "${subject}" to ${to} — EMAIL_API_KEY not set:\n${html}`);
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

module.exports = { sendEmailAsync, brandedEmail };

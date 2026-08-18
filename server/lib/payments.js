// Payment processing — escrow charges, refunds, and carrier payouts.
//
// Same shape as server/lib/email.js and server/lib/whatsapp.js: a real,
// provider-agnostic integration that is code-complete and genuinely works
// the moment the right env vars are set. Three modes:
//
//   internal (default) — PAYMENTS_PROVIDER unset. Escrow stays exactly what
//     it always was: internal bookkeeping with no processor involvement.
//     Every function in this module returns ok:false/not_configured and the
//     call sites in index.js preserve the pre-payments behavior byte-for-
//     byte, so an existing deployment is untouched.
//
//   mock — PAYMENTS_PROVIDER=mock (+ PAYMENTS_WEBHOOK_SECRET). A simulated
//     processor with an in-process ledger: createCheckoutOrder() returns a
//     ref, confirmation happens ONLY through POST /api/webhooks/payments
//     (same code path a real processor uses, signature-verified against
//     PAYMENTS_WEBHOOK_SECRET), refunds and payouts "execute". This makes
//     the entire escrow->fund->release->refund flow testable end-to-end in
//     CI and dev with zero credentials — see server/test/payments.test.js
//     and docs/PAYMENTS.md.
//
//   telr — PAYMENTS_PROVIDER=telr + TELR_STORE_ID/TELR_AUTH_KEY. Real
//     charges via Telr hosted checkout (card data never touches our
//     servers) and real refunds via the gateway refund endpoint. Payouts
//     to carriers remain a documented VERIFY point (Telr's Payouts API
//     shape must be confirmed against live sandbox docs) — until then
//     executePayout() returns not_implemented and the existing admin
//     "mark-transferred" flow (payouts-sla view) remains the operating
//     procedure. Everything is fail-closed: any verification or provider
//     failure leaves escrow untouched and surfaces via Sentry + the audit
//     log; the job/refund/release never silently assumes success.

const crypto = require('node:crypto');

const TELR_GATEWAY = 'https://secure.telr.com/gateway';

function provider() {
  return (process.env.PAYMENTS_PROVIDER || 'internal').toLowerCase();
}

function isConfigured() {
  const p = provider();
  if (p === 'mock') return !!process.env.PAYMENTS_WEBHOOK_SECRET;
  if (p === 'telr') return !!(process.env.TELR_STORE_ID && process.env.TELR_AUTH_KEY);
  return false;
}

function providerInfo() {
  const p = provider();
  return {
    provider: p,
    configured: isConfigured(),
    // Telr sandbox uses ivp_test=1; production uses ivp_test=0. Never
    // default to production when the env var is missing.
    testMode: p === 'telr' ? process.env.TELR_TEST !== '0' : p === 'mock',
  };
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Mock provider ledger — in-process only, resets on restart. Deliberate:
// this exists to exercise the integration code paths in dev/CI, not to
// persist money movements (real movements persist via the DB columns the
// call sites write).
// ---------------------------------------------------------------------------

const mockLedger = new Map();

function mockEntry(ref) {
  return mockLedger.get(ref);
}

// ---------------------------------------------------------------------------
// createCheckoutOrder — shipper pays via a processor-hosted page.
// Returns { ok, ref, url, error } — ref is OUR payment ref (stored on the
// job as processor_payment_ref and echoed to the processor as the order
// reference, so the webhook can always find the job).
// ---------------------------------------------------------------------------

async function createCheckoutOrder({ jobCode, amountAed, currency = 'AED', description, returnUrls, paymentRef }) {
  const p = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured', provider: p };
  if (!paymentRef || !jobCode || !Number.isFinite(amountAed) || amountAed <= 0) {
    return { ok: false, error: 'invalid_args' };
  }

  try {
    if (p === 'mock') {
      mockLedger.set(paymentRef, {
        type: 'CHARGE',
        status: 'REQUIRES_PAYMENT',
        amountAed,
        jobCode,
        createdAt: Date.now(),
      });
      // Mock has no hosted page — confirmation arrives via the webhook
      // endpoint with a valid signature, same as a real processor callback.
      return { ok: true, ref: paymentRef, url: null, provider: p, mock: true };
    }

    if (p === 'telr') {
      // VERIFY against current Telr docs before go-live: endpoint + field
      // names for hosted checkout order creation. Order reference is ours
      // (order_ref echoes back through every callback/refund call).
      const body = new URLSearchParams({
        ivp_method: 'create',
        ivp_store: process.env.TELR_STORE_ID,
        ivp_authkey: process.env.TELR_AUTH_KEY,
        ivp_test: providerInfo().testMode ? '1' : '0',
        ivp_amount: String(amountAed),
        ivp_currency: currency,
        ivp_cart: jobCode,
        ivp_desc: description || `Loadbyton escrow — ${jobCode}`,
        order_ref: paymentRef,
        return_auth_url: returnUrls?.auth || '',
        return_cancel_url: returnUrls?.cancel || '',
        return_decline_url: returnUrls?.decline || '',
      });
      const res = await fetch(`${TELR_GATEWAY}/order.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        // A hung processor must fail closed (and surface via the audit log)
        // rather than leaving a checkout/payout/refund silently in flight.
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.order || !data.order.ref) {
        const detail = data && data.error ? JSON.stringify(data.error) : `HTTP ${res.status}`;
        return { ok: false, error: 'telr_create_failed', detail, provider: p };
      }
      // Telr's own transaction ref for the order (used for refunds); our
      // paymentRef stays the lookup key on the job.
      mockLedger.set(paymentRef, { type: 'CHARGE', status: 'CREATED', telrRef: data.order.ref, amountAed, jobCode, createdAt: Date.now() });
      return { ok: true, ref: paymentRef, url: data.order.url || null, provider: p };
    }

    return { ok: false, error: 'unknown_provider', provider: p };
  } catch (e) {
    return { ok: false, error: 'network_error', detail: e.message, provider: p };
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification. Fail-closed: any mismatch rejects the
// webhook and no state changes.
//
// mock:  HMAC-SHA256(PAYMENTS_WEBHOOK_SECRET, rawBody), sent as the
//        x-payments-signature header.
// telr:  VERIFY against Telr's current callback docs — Telr signs its
//        callback with a shared-secret HMAC; the exact canonicalization
//        (sorted fields, exclusion of the sig param, secret = your Telr
//        callback secret) must be confirmed from the sandbox docs and
//        applied here before go-live. Fail-closed until then.
// ---------------------------------------------------------------------------

function verifyWebhookSignature(rawBody, signature, _contentType) {
  if (!isConfigured() || !signature) return false;
  const secret = provider() === 'mock' ? process.env.PAYMENTS_WEBHOOK_SECRET : process.env.TELR_WEBHOOK_SECRET;
  if (!secret) return false;

  // Providers sign the body as received; for form-encoded callbacks the
  // signature covers the canonical query string. Support both shapes and
  // let the caller's provider mode decide what it actually receives.
  let expected = null;
  if (provider() === 'mock') {
    expected = hmac(secret, rawBody);
  } else {
    // telr — VERIFY canonicalization with Telr sandbox docs (see header).
    expected = hmac(secret, rawBody);
  }
  return timingSafeEqualStr(expected, String(signature).toLowerCase());
}

// ---------------------------------------------------------------------------
// parseWebhook — normalizes a processor callback into our event model.
// Returns { ok, event, ref, tranref, amountAed, error }.
//   event: 'AUTHORISED' | 'DECLINED' | 'CANCELLED' | 'REFUNDED'
//   ref:   our processor_payment_ref (job lookup key)
// ---------------------------------------------------------------------------

function parseWebhook(body, _contentType) {
  const p = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };

  try {
    if (p === 'mock') {
      const payload = typeof body === 'string' ? JSON.parse(body) : body;
      if (!payload || !payload.ref || !payload.event) return { ok: false, error: 'malformed_payload' };
      const entry = mockEntry(payload.ref);
      if (!entry) return { ok: false, error: 'unknown_ref' };
      const event = String(payload.event).toUpperCase();
      if (!['AUTHORISED', 'DECLINED', 'CANCELLED', 'REFUNDED'].includes(event)) {
        return { ok: false, error: 'unknown_event' };
      }
      const amountAed = Number(payload.amount_aed ?? entry.amountAed);
      if (event === 'AUTHORISED') entry.status = 'PAID';
      if (event === 'REFUNDED') entry.status = 'REFUNDED';
      if (event === 'DECLINED' || event === 'CANCELLED') entry.status = event;
      return { ok: true, event, ref: payload.ref, tranref: payload.tranref || null, amountAed: Number.isFinite(amountAed) ? amountAed : null, provider: p };
    }

    if (p === 'telr') {
      // VERIFY field names against Telr's current callback docs. The
      // callback is form-encoded (parsed by the route into body) and
      // carries the order ref + status + transaction ref.
      const orderStatus = String(body.order_status || '').toUpperCase();
      const eventMap = { AUTHORISED: 'AUTHORISED', DECLINED: 'DECLINED', CANCELLED: 'CANCELLED', REFUNDED: 'REFUNDED' };
      const event = eventMap[orderStatus];
      if (!event) return { ok: false, error: 'unknown_event' };
      const ref = body.order_ref || body.ref;
      if (!ref) return { ok: false, error: 'missing_ref' };
      const amountFils = Number(body.amount); // VERIFY: Telr amounts arrive in fils
      const amountAed = Number.isFinite(amountFils) ? amountFils / 100 : null;
      return { ok: true, event, ref, tranref: body.tran_ref || null, amountAed, provider: p };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    return { ok: false, error: 'parse_error', detail: e.message };
  }
}

// ---------------------------------------------------------------------------
// refundCharge — full or partial refund of a paid charge.
// Returns { ok, refundRef, error }. Only meaningful once the charge was
// AUTHORISED/PAID; call sites guard on processor_payment_status='PAID'.
// ---------------------------------------------------------------------------

async function refundCharge({ tranref, amountAed, paymentRef }) {
  const p = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!tranref || !Number.isFinite(amountAed) || amountAed <= 0) return { ok: false, error: 'invalid_args' };

  try {
    if (p === 'mock') {
      const entry = mockEntry(paymentRef);
      if (!entry) return { ok: false, error: 'unknown_ref' };
      entry.status = 'REFUNDED';
      return { ok: true, refundRef: `mckrefund-${crypto.randomUUID()}`, provider: p };
    }

    if (p === 'telr') {
      // VERIFY against Telr docs before go-live: refund.json field names.
      const body = new URLSearchParams({
        ivp_method: 'refund',
        ivp_store: process.env.TELR_STORE_ID,
        ivp_authkey: process.env.TELR_AUTH_KEY,
        ivp_test: providerInfo().testMode ? '1' : '0',
        order_ref: paymentRef,
        ivp_tranref: tranref,
        ivp_amount: String(amountAed),
        ivp_currency: 'AED',
      });
      const res = await fetch(`${TELR_GATEWAY}/refund.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== 'OK') {
        const detail = data && data.error ? JSON.stringify(data.error) : `HTTP ${res.status}`;
        return { ok: false, error: 'telr_refund_failed', detail, provider: p };
      }
      return { ok: true, refundRef: data.refund?.ref || tranref, provider: p };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    return { ok: false, error: 'network_error', detail: e.message, provider: p };
  }
}

// ---------------------------------------------------------------------------
// executePayout — moves released funds to the carrier.
//
// mock:  ledger payout entry; the call site records transfer_executed_at +
//        transfer_reference on the payout row, exactly like a real wire.
// telr:  NOT IMPLEMENTED pending VERIFY of Telr's Payouts API against live
//        sandbox docs. Returns not_implemented so the existing admin
//        mark-transferred flow stays the operating procedure — released
//        payouts keep appearing in /api/admin/payouts-sla until a human
//        confirms the real-world transfer, exactly as before.
// ---------------------------------------------------------------------------

async function executePayout({ paymentRef, jobCode, amountAed, carrierAccountId, carrierIban, reference }) {
  const p = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!Number.isFinite(amountAed) || amountAed <= 0) return { ok: false, error: 'invalid_args' };

  try {
    if (p === 'mock') {
      mockLedger.set(`payout-${paymentRef}-${reference}`, {
        type: 'PAYOUT',
        status: 'SENT',
        amountAed,
        jobCode,
        carrierAccountId: carrierAccountId || null,
        carrierIban: carrierIban || null,
        createdAt: Date.now(),
      });
      return { ok: true, payoutRef: `mckpayout-${crypto.randomUUID()}`, provider: p };
    }

    if (p === 'telr') {
      // VERIFY Telr Payouts / split-payment API against sandbox docs.
      // Until confirmed, released payouts remain admin-confirmed manually.
      return { ok: false, error: 'not_implemented', detail: 'TELR payout API shape pending verification — see docs/PAYMENTS.md', provider: p };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    return { ok: false, error: 'network_error', detail: e.message, provider: p };
  }
}

module.exports = {
  provider,
  isConfigured,
  providerInfo,
  createCheckoutOrder,
  verifyWebhookSignature,
  parseWebhook,
  refundCharge,
  executePayout,
};
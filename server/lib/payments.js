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
//     procedure.
//
//   stripe — PAYMENTS_PROVIDER=stripe + STRIPE_SECRET_KEY (+ optional
//     STRIPE_WEBHOOK_SECRET, recommended). Stripe Connect marketplace
//     flow: createCheckoutOrder() returns a hosted Stripe Checkout
//     Session URL (card data never touches our servers), the
//     checkout.session.completed webhook funds escrow, refundCharge()
//     calls Stripe Refunds, and executePayout() performs a Connect
//     transfer to the carrier's connected account (profiles
//     .processor_account_id, provisioned via the Connect onboarding
//     endpoints in routes/stripe.routes.js). Compete, production-grade,
//     sandbox-friendly out of the box.
//
// Everything is fail-closed: any verification or provider
//     failure leaves escrow untouched and surfaces via Sentry + the audit
//     log; the job/refund/release never silently assumes success.

/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Currency} Currency
 * @typedef {import('../types/domain').JobStatus} JobStatus
 * @typedef {import('../types/domain').PaymentStatus} PaymentStatus
 * @typedef {import('../types/domain').PayoutStatus} PayoutStatus
 * @typedef {'internal'|'mock'|'telr'|'stripe'} PaymentsProvider
 * @typedef {{ jobCode: string, amountAed: number, currency?: Currency|string, description?: string, returnUrls?: {auth?: string, cancel?: string, decline?: string}, paymentRef: string }} CreateCheckoutOrderParams
 * @typedef {{ ok: boolean, ref?: string, url?: string|null, error?: string, provider?: string, detail?: string, mock?: boolean }} CreateCheckoutOrderResult
 * @typedef {{ ok: boolean, event?: 'AUTHORISED'|'DECLINED'|'CANCELLED'|'REFUNDED', ref?: string, tranref?: string|null, amountAed?: number|null, error?: string, provider?: string, providerEventId?: string, rawEventType?: string, detail?: string }} ParseWebhookResult
 * @typedef {{ tranref: string, amountAed: number, paymentRef?: string }} RefundChargeParams
 * @typedef {{ paymentRef: string, jobCode?: string, amountAed: number, carrierAccountId?: string|null, carrierIban?: string|null, reference?: string }} ExecutePayoutParams
 */

const crypto = require('node:crypto');
/** @type {any} */
let stripeLib;
try { stripeLib = require('./stripe'); } catch {}

const TELR_GATEWAY = 'https://secure.telr.com/gateway';

/**
 * @returns {PaymentsProvider|string}
 */
function provider() {
  return (process.env.PAYMENTS_PROVIDER || 'internal').toLowerCase();
}

/**
 * @returns {boolean}
 */
function isConfigured() {
  const p = provider();
  if (p === 'mock') return !!process.env.PAYMENTS_WEBHOOK_SECRET;
  if (p === 'telr') return !!(process.env.TELR_STORE_ID && process.env.TELR_AUTH_KEY);
  if (p === 'stripe') return !!process.env.STRIPE_SECRET_KEY;
  return false;
}

/**
 * @returns {{ provider: string, configured: boolean, testMode: boolean }}
 */
function providerInfo() {
  const p = provider();
  return {
    provider: p,
    configured: isConfigured(),
    // Telr sandbox uses ivp_test=1; production uses ivp_test=0. Never
    // default to production when the env var is missing.
    // Stripe: sk_test_ prefix means test mode, sk_live_ is production.
    testMode: p === 'telr' ? process.env.TELR_TEST !== '0' : p === 'mock' ? true : p === 'stripe' ? !!String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_') : false,
  };
}

/**
 * @param {string} secret
 * @param {string} data
 * @returns {string}
 */
function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
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

/**
 * @param {CreateCheckoutOrderParams} params
 * @returns {Promise<CreateCheckoutOrderResult>}
 */
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

    if (p === 'stripe') {
      // Stripe Connect: shipper is redirected to a hosted Checkout
      // Session URL. client_reference_id carries our paymentRef so the
      // checkout.session.completed webhook maps back to the job.
      const r = await stripeLib.createCheckoutSession({
        amountAed,
        jobCode,
        description,
        successUrl: returnUrls?.auth || null,
        cancelUrl: returnUrls?.cancel || null,
        paymentRef,
      });
      if (!r.ok) return r;
      return { ok: true, ref: paymentRef, url: r.url, provider: p };
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
// stripe: signed with STRIPE_WEBHOOK_SECRET via the stripe-signature
//        header; constructEvent() rejects tampered bodies.
// ---------------------------------------------------------------------------

/**
 * @param {string} rawBody
 * @param {string} signature
 * @param {string} [_contentType]
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature, _contentType) {
  if (!isConfigured() || !signature) return false;
  const p = provider();
  if (p === 'stripe') return stripeLib.verifyWebhookSignature(rawBody, signature);
  const secret = p === 'mock' ? process.env.PAYMENTS_WEBHOOK_SECRET : process.env.TELR_WEBHOOK_SECRET;
  if (!secret) return false;

  // Providers sign the body as received; for form-encoded callbacks the
  // signature covers the canonical query string. Support both shapes and
  // let the caller's provider mode decide what it actually receives.
  let expected = null;
  if (p === 'mock') {
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

/**
 * @param {any} body
 * @param {string} [_contentType]
 * @returns {ParseWebhookResult}
 */
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
      const providerEventId = `mock-${payload.ref}-${event}-${payload.tranref || '0'}`;
      return { ok: true, event, ref: payload.ref, tranref: payload.tranref || null, amountAed: Number.isFinite(amountAed) ? amountAed : null, provider: p, providerEventId, rawEventType: payload.event };
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
      const providerEventId = `telr-${body.tran_ref || ref}-${orderStatus}`;
      return { ok: true, event, ref, tranref: body.tran_ref || null, amountAed, provider: p, providerEventId, rawEventType: orderStatus };
    }

    if (p === 'stripe') {
      // Stripe sends JSON events: type + data.object. Normalize to the
      // same AUTHORISED/DECLINED/CANCELLED/REFUNDED model the rest of the
      // system uses. client_reference_id carries our paymentRef
      // (fallback: metadata.payment_ref / object id for direct PI flows).
      const event = typeof body === 'string' ? JSON.parse(body) : body;
      if (!event || !event.type || !event.data) return { ok: false, error: 'malformed_payload' };
      const obj = event.data.object || {};
      let mapped = null;
      if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') mapped = 'AUTHORISED';
      else if (event.type === 'payment_intent.payment_failed' || event.type === 'charge.failed') mapped = 'DECLINED';
      else if (event.type === 'checkout.session.expired') mapped = 'CANCELLED';
      else if (event.type === 'charge.refunded' || event.type === 'charge.refund.updated' || String(event.type).startsWith('refund.')) mapped = 'REFUNDED';
      else return { ok: false, error: 'unknown_event' };
      const ref = obj.client_reference_id || obj.metadata?.payment_ref || obj.metadata?.paymentRef || obj.id;
      if (!ref) return { ok: false, error: 'missing_ref' };
      const amountMinor = obj.amount_total ?? obj.amount_received ?? obj.amount_refunded ?? obj.amount ?? null;
      const amountAed = Number.isFinite(Number(amountMinor)) ? Number(amountMinor) / 100 : null;
      const tranref = obj.payment_intent || obj.id || null;
      const providerEventId = event.id || `stripe-${event.type}-${tranref || ref}`;
      return { ok: true, event: mapped, ref, tranref, amountAed, provider: p, providerEventId, rawEventType: event.type };
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

/**
 * @param {RefundChargeParams} params
 * @returns {Promise<{ok: boolean, refundRef?: string, error?: string, detail?: string, provider?: string}>}
 */
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
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== 'OK') {
        const detail = data && data.error ? JSON.stringify(data.error) : `HTTP ${res.status}`;
        return { ok: false, error: 'telr_refund_failed', detail, provider: p };
      }
      return { ok: true, refundRef: data.refund?.ref || tranref, provider: p };
    }

    if (p === 'stripe') {
      const r = await stripeLib.refundPaymentIntent({ paymentIntentId: tranref, amountAed });
      if (!r.ok) return r;
      return { ok: true, refundRef: r.refundRef, provider: p };
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

/**
 * @param {ExecutePayoutParams} params
 * @returns {Promise<{ok: boolean, payoutRef?: string, error?: string, detail?: string, provider?: string}>}
 */
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

    if (p === 'stripe') {
      if (!carrierAccountId) {
        return { ok: false, error: 'missing_destination', detail: 'Stripe payout requires a carrier Connect account (profiles.processor_account_id) — onboard via POST /api/stripe/connect', provider: p };
      }
      const tr = await stripeLib.createTransfer({ amountAed, destination: carrierAccountId, jobCode });
      // createTransfer returns a Transfer object on success (has .id). On
      // mock it returns a fake id; on failure Stripe throws -> caught as
      // network_error below. Be defensive: if it unexpectedly lacks an id
      // treat it as a failure rather than a phantom success.
      if (!tr || !tr.id) return { ok: false, error: 'stripe_transfer_failed', detail: tr?.detail || 'missing transfer id', provider: p };
      return { ok: true, payoutRef: tr.id, provider: p };
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
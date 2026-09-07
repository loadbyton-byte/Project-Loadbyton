// Stripe Connect — live escrow rails
// Falls back to mock when STRIPE_SECRET_KEY is unset (demo mode preserved).
// Stripe is lazily initialised so that PAYMENTS_PROVIDER=stripe set after
// module load (e.g. per-test env overrides) still picks up the key.
const crypto = require('node:crypto');
let stripe = null;
function getStripe() {
  if (stripe) return stripe;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch {}
  return stripe;
}
function isLive() { return !!getStripe(); }
async function createPaymentIntent({ amountAed, jobCode, shipperEmail }) {
  const s = getStripe();
  if (!s) {
    // mock: return a fake client_secret that webhook can confirm
    const id = `pi_mock_${crypto.randomBytes(8).toString('hex')}`;
    return { id, client_secret: `${id}_secret_mock`, amount: Math.round(amountAed*100), currency: 'aed', status: 'requires_payment_method' };
  }
  return s.paymentIntents.create({
    amount: Math.round(amountAed * 100),
    currency: 'aed',
    metadata: { job_code: jobCode, shipper: shipperEmail },
    capture_method: 'automatic',
  });
}
async function createTransfer({ amountAed, destination, jobCode }) {
  const s = getStripe();
  if (!s) {
    return { id: `tr_mock_${crypto.randomBytes(8).toString('hex')}`, amount: Math.round(amountAed*100), destination, status: 'paid' };
  }
  return s.transfers.create({ amount: Math.round(amountAed*100), currency: 'aed', destination, metadata: { job_code: jobCode } });
}
async function constructWebhookEvent(rawBody, sig) {
  const s = getStripe();
  // Fail closed. This used to fall back to `JSON.parse(rawBody)` with no
  // signature check at all whenever Stripe isn't configured (mock/internal/
  // telr payment mode) — since POST /api/webhooks/stripe is mounted
  // unconditionally regardless of PAYMENTS_PROVIDER, that meant anyone on
  // the internet could POST an arbitrary payload and have it processed as
  // a trusted, signed Stripe event (e.g. forging escrow into HELD). Mock
  // payment confirmation has its own dedicated, ADMIN-gated,
  // testMode-only route (POST /api/webhooks/stripe/mock-confirm) — this
  // function has no legitimate reason to ever accept an unverified body.
  if (!s) throw new Error('Stripe is not configured — this webhook cannot verify a signature and will not process the event');
  return s.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
}
// Hosted Checkout Session — the Stripe Connect marketplace flow. The
// shipper is redirected to session.url, completes card payment on
// Stripe's domain (card data never touches our servers), and the
// checkout.session.completed webhook funds escrow. client_reference_id
// carries our processor_payment_ref so the webhook always finds the job.
async function createCheckoutSession({ amountAed, jobCode, description, successUrl, cancelUrl, paymentRef }) {
  const s = getStripe();
  if (!s) return { ok: false, error: 'not_configured' };
  try {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(amountAed * 100),
          product_data: { name: description || `Loadbyton escrow — ${jobCode}` },
        },
        quantity: 1,
      }],
      client_reference_id: paymentRef,
      metadata: { job_code: jobCode, payment_ref: paymentRef },
      success_url: successUrl || null,
      cancel_url: cancelUrl || null,
    });
    return { ok: true, id: session.id, url: session.url, provider: 'stripe' };
  } catch (e) {
    return { ok: false, error: 'stripe_checkout_failed', detail: e.message, provider: 'stripe' };
  }
}

// Refund a completed PaymentIntent (full or partial, in fils).
async function refundPaymentIntent({ paymentIntentId, amountAed }) {
  const s = getStripe();
  if (!s) return { ok: false, error: 'not_configured' };
  try {
    const refund = await s.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amountAed * 100),
    });
    return { ok: true, refundRef: refund.id, provider: 'stripe' };
  } catch (e) {
    return { ok: false, error: 'stripe_refund_failed', detail: e.message, provider: 'stripe' };
  }
}

// Verify a Stripe webhook signature (constructEvent throws on mismatch).
function verifyWebhookSignature(rawBody, sig) {
  const s = getStripe();
  if (!s || !process.env.STRIPE_WEBHOOK_SECRET || !sig) return false;
  try {
    s.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    return true;
  } catch {
    return false;
  }
}

// Stripe Connect account lifecycle (Express, UAE-capable). Transfer
// capability is requested so the platform can push carrier payouts via
// createTransfer(destination = connected account id). Falls back to mock
// ids when STRIPE_SECRET_KEY is unset — carrier onboarding UX stays
// testable without credentials.
async function createConnectAccount({ email, country = 'AE' }) {
  const s = getStripe();
  if (!s) {
    const id = `acct_mock_${crypto.randomBytes(8).toString('hex')}`;
    return { id, mock: true };
  }
  return s.accounts.create({
    type: 'express',
    country,
    email,
    capabilities: { transfers: { requested: true } },
  });
}

async function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  const s = getStripe();
  if (!s || String(accountId).startsWith('acct_mock_')) {
    return { url: `${refreshUrl}${refreshUrl.includes('?') ? '&' : '?'}mock_account=${encodeURIComponent(accountId)}`, mock: true };
  }
  return s.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

async function retrieveAccount(accountId) {
  const s = getStripe();
  if (!s || String(accountId).startsWith('acct_mock_')) {
    return { id: accountId, charges_enabled: false, payouts_enabled: false, details_submitted: false, mock: true };
  }
  return s.accounts.retrieve(accountId);
}

module.exports = {
  isLive,
  createPaymentIntent,
  createTransfer,
  createCheckoutSession,
  refundPaymentIntent,
  constructWebhookEvent,
  verifyWebhookSignature,
  createConnectAccount,
  createAccountLink,
  retrieveAccount,
  getStripe,
};

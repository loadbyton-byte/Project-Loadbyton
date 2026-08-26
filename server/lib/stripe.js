// Stripe Connect — live escrow rails
// Falls back to mock when STRIPE_SECRET_KEY is unset (demo mode preserved)
const crypto = require('node:crypto');
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch {}
}
function isLive() { return !!stripe; }
async function createPaymentIntent({ amountAed, jobCode, shipperEmail }) {
  if (!stripe) {
    // mock: return a fake client_secret that webhook can confirm
    const id = `pi_mock_${crypto.randomBytes(8).toString('hex')}`;
    return { id, client_secret: `${id}_secret_mock`, amount: Math.round(amountAed*100), currency: 'aed', status: 'requires_payment_method' };
  }
  return stripe.paymentIntents.create({
    amount: Math.round(amountAed * 100),
    currency: 'aed',
    metadata: { job_code: jobCode, shipper: shipperEmail },
    capture_method: 'automatic',
  });
}
async function createTransfer({ amountAed, destination, jobCode }) {
  if (!stripe) {
    return { id: `tr_mock_${crypto.randomBytes(8).toString('hex')}`, amount: Math.round(amountAed*100), destination, status: 'paid' };
  }
  return stripe.transfers.create({ amount: Math.round(amountAed*100), currency: 'aed', destination, metadata: { job_code: jobCode } });
}
async function constructWebhookEvent(rawBody, sig) {
  if (!stripe) return JSON.parse(rawBody || '{}');
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
}
module.exports = { isLive, createPaymentIntent, createTransfer, constructWebhookEvent, getStripe: () => stripe };

// Payment processing — escrow charges, refunds, and carrier payouts.
// Strict TypeScript wrapper: same runtime as payments.js, with explicit types.
// `require('./payments')` continues to resolve to payments.js at runtime.
// This .ts file is the strict-checked source for `npx tsc --noEmit`.

import * as crypto from 'node:crypto';
import type { Currency, PaymentStatus } from '../types/domain';

// Stripe adapter is loaded dynamically so PAYMENTS_PROVIDER set after module load still works.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stripeLib: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  stripeLib = require('./stripe');
} catch {
  stripeLib = undefined;
}

const TELR_GATEWAY: string = 'https://secure.telr.com/gateway';

export type PaymentsProvider = 'internal' | 'mock' | 'telr' | 'stripe';

export type ProviderInfo = {
  provider: string;
  configured: boolean;
  testMode: boolean;
};

export type CreateCheckoutOrderParams = {
  jobCode: string;
  amountAed: number;
  currency?: Currency | string;
  description?: string;
  returnUrls?: { auth?: string; cancel?: string; decline?: string } | null;
  paymentRef: string;
};

export type CreateCheckoutOrderResult =
  | { ok: true; ref: string; url: string | null; provider: string; mock?: boolean }
  | { ok: false; error: string; provider?: string; detail?: string };

export type RefundChargeParams = {
  tranref: string;
  amountAed: number;
  paymentRef?: string;
};

export type RefundChargeResult =
  | { ok: true; refundRef: string; provider: string }
  | { ok: false; error: string; detail?: string; provider?: string };

export type ExecutePayoutParams = {
  paymentRef: string;
  jobCode?: string;
  amountAed: number;
  carrierAccountId?: string | null;
  carrierIban?: string | null;
  reference?: string;
};

export type ExecutePayoutResult =
  | { ok: true; payoutRef: string; provider: string }
  | { ok: false; error: string; detail?: string; provider?: string };

export type WebhookEvent = 'AUTHORISED' | 'DECLINED' | 'CANCELLED' | 'REFUNDED';

export type ParseWebhookResult =
  | {
      ok: true;
      event: WebhookEvent;
      ref: string;
      tranref: string | null;
      amountAed: number | null;
      provider: string;
      providerEventId: string;
      rawEventType: string;
    }
  | { ok: false; error: string; detail?: string };

export function provider(): string {
  return (process.env.PAYMENTS_PROVIDER || 'internal').toLowerCase();
}

export function isConfigured(): boolean {
  const p: string = provider();
  if (p === 'mock') return !!process.env.PAYMENTS_WEBHOOK_SECRET;
  if (p === 'telr') return !!(process.env.TELR_STORE_ID && process.env.TELR_AUTH_KEY);
  if (p === 'stripe') return !!process.env.STRIPE_SECRET_KEY;
  return false;
}

export function providerInfo(): ProviderInfo {
  const p: string = provider();
  return {
    provider: p,
    configured: isConfigured(),
    testMode:
      p === 'telr'
        ? process.env.TELR_TEST !== '0'
        : p === 'mock'
          ? true
          : p === 'stripe'
            ? !!String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
            : false,
  };
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab: Buffer = Buffer.from(String(a));
  const bb: Buffer = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Mock provider ledger — in-process only, resets on restart.
// ---------------------------------------------------------------------------

type MockLedgerEntry = {
  type: 'CHARGE' | 'PAYOUT';
  status: string;
  amountAed: number;
  jobCode?: string;
  telrRef?: string;
  carrierAccountId?: string | null;
  carrierIban?: string | null;
  createdAt: number;
};

const mockLedger: Map<string, MockLedgerEntry> = new Map();

function mockEntry(ref: string): MockLedgerEntry | undefined {
  return mockLedger.get(ref);
}

// ---------------------------------------------------------------------------
// createCheckoutOrder
// ---------------------------------------------------------------------------

export async function createCheckoutOrder({
  jobCode,
  amountAed,
  currency = 'AED',
  description,
  returnUrls,
  paymentRef,
}: CreateCheckoutOrderParams): Promise<CreateCheckoutOrderResult> {
  const p: string = provider();
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
      return { ok: true, ref: paymentRef, url: null, provider: p, mock: true };
    }

    if (p === 'telr') {
      const body = new URLSearchParams({
        ivp_method: 'create',
        ivp_store: String(process.env.TELR_STORE_ID || ''),
        ivp_authkey: String(process.env.TELR_AUTH_KEY || ''),
        ivp_test: providerInfo().testMode ? '1' : '0',
        ivp_amount: String(amountAed),
        ivp_currency: String(currency),
        ivp_cart: String(jobCode),
        ivp_desc: description || `Loadbyton escrow — ${jobCode}`,
        order_ref: String(paymentRef),
        return_auth_url: String(returnUrls?.auth || ''),
        return_cancel_url: String(returnUrls?.cancel || ''),
        return_decline_url: String(returnUrls?.decline || ''),
      });
      const res: Response = await fetch(`${TELR_GATEWAY}/order.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data: unknown = await res.json().catch(() => null);
      const d = data as { order?: { ref?: string; url?: string }; error?: unknown } | null;
      if (!res.ok || !d || !d.order || !d.order.ref) {
        const detail: string = d && d.error ? JSON.stringify(d.error) : `HTTP ${res.status}`;
        return { ok: false, error: 'telr_create_failed', detail, provider: p };
      }
      mockLedger.set(paymentRef, {
        type: 'CHARGE',
        status: 'CREATED',
        telrRef: d.order.ref,
        amountAed,
        jobCode,
        createdAt: Date.now(),
      });
      return { ok: true, ref: paymentRef, url: d.order.url || null, provider: p };
    }

    if (p === 'stripe') {
      const r: { ok: boolean; url?: string; error?: string; detail?: string } = await stripeLib.createCheckoutSession({
        amountAed,
        jobCode,
        description,
        successUrl: returnUrls?.auth || null,
        cancelUrl: returnUrls?.cancel || null,
        paymentRef,
      });
      if (!r.ok) return r as CreateCheckoutOrderResult;
      return { ok: true, ref: paymentRef, url: r.url ?? null, provider: p };
    }

    return { ok: false, error: 'unknown_provider', provider: p };
  } catch (e) {
    const detail: string = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'network_error', detail, provider: p };
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: string, signature: string, _contentType?: string): boolean {
  if (!isConfigured() || !signature) return false;
  const p: string = provider();
  if (p === 'stripe') return stripeLib.verifyWebhookSignature(rawBody, signature) as boolean;
  const secret: string | undefined = p === 'mock' ? process.env.PAYMENTS_WEBHOOK_SECRET : process.env.TELR_WEBHOOK_SECRET;
  if (!secret) return false;

  let expected: string | null = null;
  if (p === 'mock') {
    expected = hmac(secret, rawBody);
  } else {
    expected = hmac(secret, rawBody);
  }
  return timingSafeEqualStr(expected, String(signature).toLowerCase());
}

// ---------------------------------------------------------------------------
// parseWebhook — normalizes a processor callback into our event model.
// ---------------------------------------------------------------------------

export function parseWebhook(body: unknown, _contentType?: string): ParseWebhookResult {
  const p: string = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };

  try {
    if (p === 'mock') {
      const payload: Record<string, unknown> =
        typeof body === 'string' ? (JSON.parse(body as string) as Record<string, unknown>) : (body as Record<string, unknown>);
      if (!payload || !payload.ref || !payload.event) return { ok: false, error: 'malformed_payload' };
      const ref: string = String(payload.ref);
      const entry: MockLedgerEntry | undefined = mockEntry(ref);
      if (!entry) return { ok: false, error: 'unknown_ref' };
      const event: string = String(payload.event).toUpperCase();
      if (!['AUTHORISED', 'DECLINED', 'CANCELLED', 'REFUNDED'].includes(event)) {
        return { ok: false, error: 'unknown_event' };
      }
      const amountAed: number = Number((payload as { amount_aed?: unknown }).amount_aed ?? entry.amountAed);
      if (event === 'AUTHORISED') entry.status = 'PAID';
      if (event === 'REFUNDED') entry.status = 'REFUNDED';
      if (event === 'DECLINED' || event === 'CANCELLED') entry.status = event;
      const tranref: string | null = (payload.tranref as string) || null;
      const providerEventId: string = `mock-${ref}-${event}-${tranref || '0'}`;
      return {
        ok: true,
        event: event as WebhookEvent,
        ref,
        tranref,
        amountAed: Number.isFinite(amountAed) ? amountAed : null,
        provider: p,
        providerEventId,
        rawEventType: String(payload.event),
      };
    }

    if (p === 'telr') {
      const b = body as Record<string, unknown>;
      const orderStatus: string = String((b.order_status as string) || '').toUpperCase();
      const eventMap: Record<string, WebhookEvent> = {
        AUTHORISED: 'AUTHORISED',
        DECLINED: 'DECLINED',
        CANCELLED: 'CANCELLED',
        REFUNDED: 'REFUNDED',
      };
      const event: WebhookEvent | undefined = eventMap[orderStatus];
      if (!event) return { ok: false, error: 'unknown_event' };
      const ref: string | undefined = (b.order_ref as string) || (b.ref as string);
      if (!ref) return { ok: false, error: 'missing_ref' };
      const amountFils: number = Number(b.amount);
      const amountAed: number | null = Number.isFinite(amountFils) ? amountFils / 100 : null;
      const tranRef: string = String(b.tran_ref || ref);
      const providerEventId: string = `telr-${tranRef}-${orderStatus}`;
      return {
        ok: true,
        event,
        ref,
        tranref: (b.tran_ref as string) || null,
        amountAed,
        provider: p,
        providerEventId,
        rawEventType: orderStatus,
      };
    }

    if (p === 'stripe') {
      const event: Record<string, unknown> =
        typeof body === 'string' ? (JSON.parse(body as string) as Record<string, unknown>) : (body as Record<string, unknown>);
      if (!event || !event.type || !event.data) return { ok: false, error: 'malformed_payload' };
      const dataObj = event.data as Record<string, unknown>;
      const obj: Record<string, unknown> = (dataObj.object as Record<string, unknown>) || {};
      let mapped: WebhookEvent | null = null;
      const typeStr: string = String(event.type);
      if (typeStr === 'checkout.session.completed' || typeStr === 'payment_intent.succeeded') mapped = 'AUTHORISED';
      else if (typeStr === 'payment_intent.payment_failed' || typeStr === 'charge.failed') mapped = 'DECLINED';
      else if (typeStr === 'checkout.session.expired') mapped = 'CANCELLED';
      else if (typeStr === 'charge.refunded' || typeStr === 'charge.refund.updated' || typeStr.startsWith('refund.')) mapped = 'REFUNDED';
      else return { ok: false, error: 'unknown_event' };
      const metadata = (obj.metadata as Record<string, unknown>) || {};
      const ref: string | undefined =
        (obj.client_reference_id as string) ||
        (metadata.payment_ref as string) ||
        (metadata.paymentRef as string) ||
        (obj.id as string);
      if (!ref) return { ok: false, error: 'missing_ref' };
      const amountMinorRaw: unknown = obj.amount_total ?? obj.amount_received ?? obj.amount_refunded ?? obj.amount ?? null;
      const amountAed: number | null =
        amountMinorRaw != null && Number.isFinite(Number(amountMinorRaw)) ? Number(amountMinorRaw) / 100 : null;
      const tranref: string | null = (obj.payment_intent as string) || (obj.id as string) || null;
      const providerEventId: string = (event.id as string) || `stripe-${typeStr}-${tranref || ref}`;
      return {
        ok: true,
        event: mapped,
        ref,
        tranref,
        amountAed,
        provider: p,
        providerEventId,
        rawEventType: typeStr,
      };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    const detail: string = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'parse_error', detail };
  }
}

// ---------------------------------------------------------------------------
// refundCharge
// ---------------------------------------------------------------------------

export async function refundCharge({ tranref, amountAed, paymentRef }: RefundChargeParams): Promise<RefundChargeResult> {
  const p: string = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!tranref || !Number.isFinite(amountAed) || amountAed <= 0) return { ok: false, error: 'invalid_args' };

  try {
    if (p === 'mock') {
      const entry: MockLedgerEntry | undefined = paymentRef ? mockEntry(paymentRef) : undefined;
      if (!entry) return { ok: false, error: 'unknown_ref' };
      entry.status = 'REFUNDED';
      return { ok: true, refundRef: `mckrefund-${crypto.randomUUID()}`, provider: p };
    }

    if (p === 'telr') {
      const body = new URLSearchParams({
        ivp_method: 'refund',
        ivp_store: String(process.env.TELR_STORE_ID || ''),
        ivp_authkey: String(process.env.TELR_AUTH_KEY || ''),
        ivp_test: providerInfo().testMode ? '1' : '0',
        order_ref: String(paymentRef || ''),
        ivp_tranref: String(tranref),
        ivp_amount: String(amountAed),
        ivp_currency: 'AED',
      });
      const res: Response = await fetch(`${TELR_GATEWAY}/refund.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data: unknown = await res.json().catch(() => null);
      const d = data as { status?: string; error?: unknown; refund?: { ref?: string } } | null;
      if (!res.ok || !d || d.status !== 'OK') {
        const detail: string = d && d.error ? JSON.stringify(d.error) : `HTTP ${res.status}`;
        return { ok: false, error: 'telr_refund_failed', detail, provider: p };
      }
      return { ok: true, refundRef: d.refund?.ref || String(tranref), provider: p };
    }

    if (p === 'stripe') {
      const r: RefundChargeResult = await stripeLib.refundPaymentIntent({ paymentIntentId: tranref, amountAed });
      if (!r.ok) return r;
      return { ok: true, refundRef: (r as { refundRef: string }).refundRef, provider: p };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    const detail: string = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'network_error', detail, provider: p };
  }
}

// ---------------------------------------------------------------------------
// executePayout
// ---------------------------------------------------------------------------

export async function executePayout({
  paymentRef,
  jobCode,
  amountAed,
  carrierAccountId,
  carrierIban,
  reference,
}: ExecutePayoutParams): Promise<ExecutePayoutResult> {
  const p: string = provider();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!Number.isFinite(amountAed) || amountAed <= 0) return { ok: false, error: 'invalid_args' };

  try {
    if (p === 'mock') {
      mockLedger.set(`payout-${paymentRef}-${reference}`, {
        type: 'PAYOUT',
        status: 'SENT',
        amountAed,
        jobCode: jobCode || '',
        carrierAccountId: carrierAccountId || null,
        carrierIban: carrierIban || null,
        createdAt: Date.now(),
      });
      return { ok: true, payoutRef: `mckpayout-${crypto.randomUUID()}`, provider: p };
    }

    if (p === 'telr') {
      return {
        ok: false,
        error: 'not_implemented',
        detail: 'TELR payout API shape pending verification — see docs/PAYMENTS.md',
        provider: p,
      };
    }

    if (p === 'stripe') {
      if (!carrierAccountId) {
        return {
          ok: false,
          error: 'missing_destination',
          detail: 'Stripe payout requires a carrier Connect account (profiles.processor_account_id) — onboard via POST /api/stripe/connect',
          provider: p,
        };
      }
      const tr: { id?: string; detail?: string } = await stripeLib.createTransfer({
        amountAed,
        destination: carrierAccountId,
        jobCode: jobCode || '',
      });
      if (!tr || !tr.id) return { ok: false, error: 'stripe_transfer_failed', detail: tr?.detail || 'missing transfer id', provider: p };
      return { ok: true, payoutRef: tr.id, provider: p };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    const detail: string = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'network_error', detail, provider: p };
  }
}

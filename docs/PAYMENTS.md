# Loadbyton — Payments: business setup (Phase B) and integration guide (Phase C)

This is the operating manual for turning Loadbyton's internal escrow
bookkeeping into real money movement. Two distinct halves:

1. **Phase B — business/licensing work that only the founders can do**
   (merchant onboarding, KYB, legal review). Nothing in this repo can
   complete it; this document is the checklist.
2. **Phase C — the code integration**, which is already built for two
   real processors: a provider-agnostic payment layer
   (`server/lib/payments.js`), signature-verified webhooks, schema, UI,
   and a fully-testable mock processor. **Stripe Connect is the more
   complete of the two today** — checkout, webhook-funded escrow,
   refunds, and carrier payouts via Connect transfer are all live
   (`server/lib/stripe.js`, `server/routes/stripe.routes.js`). Telr's
   checkout/callback side is built, but its payout leg is not yet
   implemented (`server/lib/payments.js` — Telr payout returns
   `not_implemented`). Enabling either is a matter of credentials + the
   VERIFY points in §6.4.

---

## 1. The mode matrix

| `PAYMENTS_PROVIDER` | What escrow means | Who confirms payment | Who moves the money to carriers |
|---|---|---|---|
| `internal` (default) | Pure bookkeeping (today's behavior, unchanged) | Admin via `POST /api/admin/confirm-receipt` | Admin via `/api/admin/payouts-sla` → `mark-transferred` |
| `mock` | Simulated processor, real code paths | Webhook with HMAC signature | Auto-executed "payout", recorded like a real one |
| `stripe` | Real card charges via Stripe Checkout + Connect onboarding (`country: 'AE'`) | Stripe's signature-verified webhook (`/api/webhooks/stripe`) | **Live** — Connect transfer to the carrier's connected account (`server/lib/stripe.js`'s `createTransfer`) |
| `telr` | Real card charges via Telr hosted checkout | Telr's verified callback to `/api/webhooks/payments` | **PENDING VERIFY** — see §6.4; until then the admin SLA flow |

Everything is fail-closed: a webhook with a bad signature, an unknown
ref, or a provider error never moves state. Every money event lands in
the append-only audit log.

---

## 2. Phase B — the founders' checklist (do this first)

### 2.1 Choose the processor

This is a licensing/business decision, not just a technical one — the
code already supports both **Stripe** and **Telr** end-to-end (the mode
matrix above), so the choice comes down to onboarding terms, not which
one "works."

- **Stripe** — global processor, onboards UAE-based merchants via
  Stripe Connect Express with `country: 'AE'` (`server/lib/stripe.js`).
  This is the more complete integration today: checkout, webhook-funded
  escrow, refunds, *and* carrier payouts via Connect transfer all work.
  Verify current Stripe UAE merchant-of-record/settlement terms directly
  with Stripe before committing — cross-border settlement details change
  over time and are a business call, not something this repo can decide.
- **Telr** — CBUAE-licensed PSP, UAE-registered, supports AED card
  acquiring and hosted checkout (no card data on our servers). Checkout
  and the verified callback are built; the payout leg to carriers is not
  implemented yet (would need `server/lib/payments.js`'s Telr payout
  branch finished before it can replace the admin SLA flow for payouts).
- **PayTabs** — also CBUAE-licensed, similar products; no code
  integration exists yet, would need a `server/lib/payments.js` provider
  branch built the same way Stripe/Telr's were.

Compare on (in this order):

1. **Licensing**: CBUAE-licensed PSP with AED merchant accounts.
2. **Hosted checkout**: buyer pays on Telr's page (PCI scope stays
   with them) — Loadbyton never touches card data, which keeps
   `server/lib/payments.js` free of a PCI dependency.
3. **Payouts / split payments**: how the platform moves net amounts to
   carrier bank accounts (Telr Payouts, or Split Payments if you want
   each carrier to receive directly).
4. **Refunds**: API refund support (needed for `REFUND_SHIPPER`).
5. **Fees**: per-transaction + payout fees, settlement cadence (T+1 vs
   T+3 changes the "48h payout promise" in the SLA view).
6. **Sandbox**: quality of the test environment — this gates Phase C's
   VERIFY points.

### 2.2 Merchant onboarding / KYB — document checklist

Telr (and every UAE PSP) will require, per merchant entity:

- [ ] Trade licence (UAE mainland or free-zone) — company must exist and
      match the business registry
- [ ] Passports + Emirates IDs of the owners/authorized signatories
- [ ] TRN certificate (VAT registration) — also required for the
      commission invoices `server/lib/invoice.js` already issues
- [ ] Bank statements (3–6 months) for the settlement account (UAE IBAN)
- [ ] Website/app URL and business description (Loadbyton's own domain —
      see §7 below, Phase A item)
- [ ] Shareholder structure for UBO checks (KYB)
- [ ] Contact details + the operator email that will receive processor
      alerts (wire this to the ops inbox, not a personal inbox)

> Expect 1–4 weeks. Do NOT wait for this to finish to complete §3 — the
> whole flow is testable today in `mock` mode.

### 2.3 Legal review (MENA payments lawyer — do not skip)

The critical question is **aggregation licensing**: Loadbyton takes
payment from a shipper and later distributes part of it to a carrier.
Depending on the structure (marketplace vs. regulated payment
intermediary) and on the chosen processor's split/payout product, this
may need:

- [ ] A UAE payments lawyer to confirm whether the split/payout model
      requires a Stored Value Facility (SVF) or payment aggregator
      license under CBUAE regulations
- [ ] Review of the ToS/Privacy pages (`web/src/pages/Terms.jsx`,
      `Privacy.jsx`) for the payment sections (they currently describe
      escrow; adjust the wording once the legal structure is confirmed)
- [ ] Confirmation that funds are never held by Loadbyton as a
      "float" (prefer: charge comes in → payout goes out on release;
      the platform fee is the only retained amount, and it's earned)

### 2.4 Get sandbox credentials

From the processor's merchant portal:

- [ ] `TELR_STORE_ID` (sandbox store)
- [ ] `TELR_AUTH_KEY` (sandbox API key)
- [ ] `TELR_WEBHOOK_SECRET` (the secret used to verify callbacks)
- [ ] Set the callback URL to `https://<your-domain>/api/webhooks/payments`
- [ ] Note the sandbox test cards the processor provides

---

## 3. Phase C — what's already built

### 3.1 Flow (once configured)

```
award        -> job AWARDED, escrow HELD, processor_payment_status=REQUIRES_PAYMENT
shipper      -> POST /api/jobs/:id/payment-checkout
                 (creates hosted checkout; returns paymentUrl — shipper
                  is redirected; the "Payment" panel on JobDetail does this)
processor    -> shipper pays on Telr's page
callback     -> POST /api/webhooks/payments (HMAC-verified, idempotent)
AUTHORISED   -> escrow HELD -> FUNDED, processor_payment_status=PAID
                 (stores processor_tranref for refunds)
...job runs...
release      -> COMPLETED / auto-release / dispute RELEASE_TO_CARRIER
                 -> escrow RELEASED, payout RELEASED, then
                    executePayoutAsync() moves the net to the carrier
                 -> payout.transfer_executed_at + transfer_reference set
refund       -> dispute REFUND_SHIPPER / CANCELLED-after-FUNDED
                 -> refundCharge() on the processor tranref
                 -> processor_payment_status=REFUNDED
```

### 3.2 Schema (additive; `server/db.js` migrations)

- `jobs.processor_payment_ref` — OUR ref (`lb_<job_code>_<rand>`),
  echoed to the processor as the order reference; the webhook's lookup key
- `jobs.processor_tranref` — the processor's transaction ref (refunds)
- `jobs.processor_payment_status` — `PENDING → REQUIRES_PAYMENT → PAID` ;
  `DECLINED/CANCELLED → FAILED` ; refund → `REFUNDED`
- `jobs.processor_amount_aed`, `jobs.processor_last_error`
- `payouts.processor_payout_status` (`PENDING → SENT | FAILED`),
  `payouts.processor_payout_ref`
- `profiles.processor_account_id` — the carrier's payout/split account id
  at the processor (set it from the admin/user profile once known)

### 3.3 Idempotency & safety guarantees

- Checkout is idempotent per job (same `processor_payment_ref` re-used).
- Webhook replays are acknowledged (`idempotent: true`) without
  double-applying; a `DECLINED` arriving after `PAID` never un-funds.
- A payout executes only if `transfer_executed_at` is null (DB guard).
- Any failure is audited (`PAYOUT_PROCESSOR_FAILED`,
  `REFUND_SHIPPER_FAILED`, `PAYMENT_WEBHOOK_REJECTED`) and, for payouts,
  keeps the payout visible in `/api/admin/payouts-sla` until resolved.
- In `internal` mode every one of these paths is a no-op — the existing
  admin flows and core-loop tests are unchanged (verified by CI).

---

## 4. Local dev / CI with the mock provider

```bash
cd server
PAYMENTS_PROVIDER=mock PAYMENTS_WEBHOOK_SECRET=dev-secret npm start
```

- Award a job, then call `POST /api/jobs/:id/payment-checkout` — it
  returns `ref` and `paymentUrl: null` (mock has no hosted page).
- Simulate the processor callback:

```bash
curl -X POST http://localhost:4000/api/webhooks/payments \
  -H 'Content-Type: application/json' \
  -H "x-payments-signature: $(printf '{"event":"AUTHORISED","ref":"<REF>","tranref":"t1","amount_aed":650}' | openssl dgst -sha256 -hmac 'dev-secret' | awk '{print $2}')" \
  -d '{"event":"AUTHORISED","ref":"<REF>","tranref":"t1","amount_aed":650}'
```

Escrow flips to `FUNDED`; run the job to delivery; completing it
auto-executes the mock payout (visible in `/api/earnings` with
`transfer_executed_at` set, and gone from `/api/admin/payouts-sla`).

The CI suite (`server/test/payments.test.js`) does exactly this
end-to-end, including bad-signature rejection and webhook replay
idempotency.

---

## 5. Enabling real payments (Telr) — step by step

1. Complete §2 (onboarding + credentials).
2. Set env vars (Render dashboard or `render.yaml`):
   `PAYMENTS_PROVIDER=telr`, `TELR_STORE_ID`, `TELR_AUTH_KEY`,
   `TELR_WEBHOOK_SECRET`, and leave `TELR_TEST=1` until go-live.
3. Point the processor's callback URL at
   `https://<domain>/api/webhooks/payments`.
4. **VERIFY the four integration points** in `server/lib/payments.js`
   against the Telr sandbox docs (each is marked `VERIFY` in the code):
   - `createCheckoutOrder` — hosted checkout order creation
     (`ivp_method=create`; field names; response `order.ref`/`order.url`)
   - webhook signature canonicalization — what exactly the HMAC covers
     (sorted params? raw body? which secret?) — this is the single most
     security-critical line to confirm
   - `parseWebhook` (telr branch) — callback field names
     (`order_status`, `tran_ref`, amount in fils?) and status vocabulary
   - `executePayout` (telr branch) — the Payouts/split API shape; until
     verified it returns `not_implemented` and the admin SLA flow remains
     the payout mechanism (safe fallback, no money is stranded)
5. Run the payment tests against the sandbox: create a real test job in
   the sandbox env, pay with a sandbox test card, and watch the webhook
   flip escrow. Keep the mock suite green too — both must pass.
6. Only after all four VERIFY points are confirmed: set `TELR_TEST=0`.

---

## 6. Operations

### 6.1 Money-event ledger (for reconciliation)

Every movement is in the append-only audit log:

| Action | When |
|---|---|
| `PAYMENT_CHECKOUT` | checkout created |
| `ESCROW_FUND` | AUTHORISED webhook applied |
| `PAYOUT_PROCESSOR` | payout executed by the processor |
| `PAYOUT_PROCESSOR_FAILED` | payout rejected/errored |
| `REFUND_SHIPPER_EXECUTED` / `REFUND_SHIPPER_FAILED` | dispute refunds |
| `PAYMENT_REFUND` | processor-initiated refund callback |
| `PAYMENT_WEBHOOK_REJECTED` / `PAYMENT_WEBHOOK_ERROR` | callback problems |

Reconcile weekly: `SUM(jobs.agreed_price_aed WHERE escrow_status
IN ('HELD','FUNDED'))` must equal what the processor says is
authorized/collected; `SUM(payouts.net_aed WHERE status='RELEASED')`
must equal what the processor has paid out or what the SLA view shows
as outstanding.

### 6.2 Failure runbook

- **Charge declined** → job stays HELD/REQUIRES_PAYMENT, shipper sees
  "Payment failed" on JobDetail and can retry (new checkout reuses the
  same ref; Telr returns the same order).
- **Webhook missed / signature mismatch** → audit entry + Sentry; the
  job stays HELD. Contact the processor to re-push the callback (most
  retry a few times automatically). Never manually flip escrow to FUNDED
  without the processor's confirmation of the charge.
- **Payout failed** → `processor_payout_status=FAILED`; the payout stays
  in `/api/admin/payouts-sla` as outstanding. Re-run the transfer
  manually (Telr portal) and use the existing `mark-transferred`
  endpoint to record it.
- **Refund failed** → `REFUND_SHIPPER_FAILED` audited; process the
  refund manually in the processor portal and confirm the shipper.
- **Disputes while money is in flight** → escrow DISPUTED freezes
  everything; the dispute resolution routes handle the rest.

### 6.3 Carrier payout details

- Set `profiles.processor_account_id` (and ensure `profiles.iban` is
  correct — it is already AES-encrypted at rest) before release so the
  payout addresses the right account.
- `payouts.sla_deadline` (released_at + 48h) still drives the overdue
  view — processor payouts set `transfer_executed_at` immediately, so
  only genuinely-unmoved money shows up there.

### 6.4 VERIFY log (track these until done)

| # | Item | Status |
|---|---|---|
| 1 | Telr hosted checkout: order creation fields + response shape | pending sandbox |
| 2 | Telr callback signature canonicalization + secret | pending sandbox |
| 3 | Telr callback fields + status vocabulary + amount units | pending sandbox |
| 4 | Telr Payouts / split API for carrier transfers | pending sandbox |
| 5 | Test cards in sandbox, end-to-end (see §5 step 5) | pending sandbox |

---

## 7. Related Phase A items that gate payments

- **Custom domain + TLS** (§A8): the processor callback URL must be a
  stable, public HTTPS endpoint — `https://<domain>/api/webhooks/payments`.
  Register the domain, point DNS at Render, set `FRONTEND_URL` to it.
- **Fixed `ENCRYPTION_KEY`** (§A9): carrier IBANs are what payouts
  address — set a fixed secret in Render's env (not
  `generateValue: true`, which can rotate and orphan encrypted fields on
  environment re-creation) and document its rotation.
- **Sentry DSN** (`SENTRY_DSN` / `VITE_SENTRY_DSN`): payment failures
  are surfaced in Sentry with `job_id` tags — configure before go-live.
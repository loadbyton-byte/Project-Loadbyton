# Loadbyton ecosystem: loadbyton.com ↔ loadbyton.store

How the freight marketplace (this repo) and Business OS (`Loadbyton-OS`) work as one account, one company and one entitlement, and how to run, test and switch it on. Implements phases A–D and the Store side of F of the master plan (v1.0, 18 Oct 2026).

> **Status.** Built and tested. The interface flags now default to **on** (owner decisions of 18 Oct 2026, see `docs/MASTER_PLAN_v1.1.md`), but the OIDC issuer and event delivery do nothing until configured, and Premium cannot be bought until `PREMIUM_CHECKOUT_ENABLED=true` with a live payment provider. Section 9 lists what remains outside the code.

## 1. What exists

```
loadbyton.com (this repo)                                     loadbyton.store (Loadbyton-OS)
─────────────────────────                                     ───────────────────────────────
organisations / org_memberships  ── one per company
users.subject_id                 ── immutable person id
store_activations                ── admin accepted terms + sector
org_subscriptions (premium)      ── recorded by staff after payment
decide()  ── pure rules ──► entitlement_grants (versioned)
                                  └► ecosystem_events ──► POST /webhooks/loadbyton ─► ecosystem_inbox
                                       (signed, retried)                               ecosystem_orgs ─► subscriptions + entitlements
GET /api/ecosystem/grants  ◄── signed read, nightly ──────  reconcileFromCom()
OIDC issuer  /api/oidc/*   ◄── "Continue with Loadbyton" ── oidc-client.ts ─► identity_links, workspace
```

| Piece | .com | .store |
|---|---|---|
| Company identity | `server/lib/ecosystem/orgs.js` | `ecosystem_orgs`, `tenants.external_org_sub` |
| Eligibility rules | `server/lib/ecosystem/entitlements.js` (`decide`) | applies only; never decides |
| Event delivery | `server/lib/ecosystem/delivery.js` | `src/platform/ecosystem.ts`, `src/web/ecosystem.tsx` |
| Sign-in | `server/lib/ecosystem/oidc.js`, `server/routes/oidc.routes.js` | `src/platform/oidc-client.ts` |
| Screens | `/business-os`, `/account/benefits`, `/account/organisation`, `/go/:key` | "Continue with Loadbyton" on `/login` |

## 2. Identity

* A **company** is the root account of an owner/seat tree (`users.org_owner_id`). `organisations` gives it a stable `subject_id`; `org_memberships` mirrors the seats. The legacy columns stay authoritative until cut-over (dual read). Rows are created lazily and by `backfillOrganisations()` at boot, both idempotent.
* A **person** has `users.subject_id`. Integer user ids never leave this service. A person, a company, a workspace and a subscription are four different records.
* The Store links people through `identity_links(subject_id → user)`. **Accounts are never joined on email alone**: an existing Store account must prove control with its password (`/auth/loadbyton/link`).
* Only the **company administrator** (the account owner, not a seat) activates Business OS, and only the administrator creates the workspace on first sign-in. Other people join through the Store's normal invitations.
* Platform staff and driver seats never get company single sign-on.

## 3. Entitlement rules (the product decision, in one place)

| Situation | Store plan | Status |
|---|---|---|
| Not activated by the administrator | nothing granted | – |
| Activated, company **not verified** | none | `suspended` (workspace read-only) |
| Activated, verified | `starter_included` | `active` |
| …and an active premium subscription | `enterprise_included` | `active` |
| Premium cancelled | `enterprise_included` until period end, then Starter | `active` |
| Payment failed, or a period ran out unrenewed | `enterprise_included` for `ECOSYSTEM_GRACE_DAYS` (default **14**, proposed), then Starter | `grace` |
| Workspace already pays for an equal or higher plan | **left alone** | – |

Included plans cost nothing and are never offered for sale. Loyalty tiers (`users.tier`) and completed freight volume never count. Nothing is deleted when a plan lowers: over-limit records stay readable and exportable, new records of the affected type are blocked. The numbers are the Store's published plan ceilings (hypotheses, not guaranteed provider-funded usage); they are mirrored for display in `server/lib/ecosystem/constants.js`.

## 4. Event contract

`POST {STORE}/webhooks/loadbyton`, `content-type: application/json`, headers `LBT-Signature: t=<unix>,v1=<hex>` and `LBT-Event-Id`. `v1 = HMAC-SHA256(ECOSYSTEM_SHARED_SECRET, "<t>.<raw body>")`.

```json
{
  "id": "6b0f…", "type": "entitlement.updated", "created": "2026-11-01T09:00:00.000Z", "version": 4,
  "organisation": { "subject_id": "…", "name": "Gulf Cargo LLC", "verified": true, "verified_by": "loadbyton.com" },
  "entitlement": { "product": "store", "plan_code": "enterprise_included", "status": "grace",
                   "starts_at": "…", "ends_at": null, "grace_until": "2026-11-15T…", "reason": "premium_payment_grace" },
  "activation": { "sector": "road-transport", "accepted_by_subject": "…", "accepted_at": "…", "terms_version": "…" }
}
```

* Events are **state snapshots with a per-organisation `version`**. The receiver applies the highest version it has seen; replays and out-of-order deliveries are harmless (`duplicate` / `stale`).
* The receiver verifies the signature over the **raw body**, rejects a timestamp more than 5 minutes off, de-duplicates on `id`, and answers 2xx within 10 s. A `410` stops delivery. Anything else is retried (30 s doubling to 1 h, 12 attempts) and then parked as `DEAD`.
* **Reconciliation.** `GET /api/ecosystem/grants` (signature over `GET <path+query>`) returns the latest grant per activated company. The Store calls it every 15 minutes and applies anything it has not seen, so a lost webhook self-heals.
* **Fail-safe.** If .com is unreachable at a boundary, the Store itself ends Enterprise Included at its own `ends_at` / `grace_until`. The next authoritative event still wins.

## 5. Sign-in (OIDC)

Authorization-code flow with **PKCE S256 only**, `state` required, `nonce`, exact `redirect_uri` match against a per-client allowlist, confidential clients (`client_secret_post|basic`), RS256 ID and access tokens, no refresh tokens. The authorization code is single-use, hashed at rest, valid 5 minutes, and **burned on first presentation** even when the other checks fail. Endpoints (issuer `${FRONTEND_URL}/api/oidc`, same origin as the session cookie): `/.well-known/openid-configuration`, `/jwks.json`, `/authorize`, `/token`, `/userinfo`.

ID token claims: `sub` (person), `email`, `email_verified`, `name`, `org_sub`, `org_name`, `org_role`, `org_verified`.

The login page accepts `?return_to=` **only** when it is exactly a relative `/api/oidc/authorize?…` path (`web/src/lib/returnTo.js`); anything else is ignored.

## 6. Configuration

| Variable | Where | Meaning |
|---|---|---|
| `ECOSYSTEM_SHARED_SECRET` | both | HMAC secret (≥32 random bytes) for events and the reconciliation read |
| `STORE_WEBHOOK_URL` | .com | `https://<store>/webhooks/loadbyton`. Unset = events queue, nothing is sent |
| `STORE_BASE_URL` | .com | Store origin; enables the "Open Business OS" link |
| `ECOSYSTEM_GRACE_DAYS` / `ECOSYSTEM_TERMS_VERSION` | .com | grace window; terms version recorded at activation |
| `OIDC_CLIENTS` | .com | JSON `[{"client_id","client_secret","redirect_uris":["https://<store>/auth/loadbyton/callback"]}]` |
| `OIDC_SIGNING_KEY_PEM` | .com | RSA private key. **Required in production** (without it the issuer answers 503). `openssl genrsa 2048` |
| `OIDC_ISSUER` | .com | defaults to `${FRONTEND_URL}/api/oidc` |
| `COM_BASE_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Store | where to sign in and reconcile; the redirect URI is `${PUBLIC_BASE_URL}/auth/loadbyton/callback` |
| `VITE_ECOSYSTEM_UI` | web build | default on; `false` hides the network menu, footer directory, Business OS, benefits, organisation |
| `VITE_BRAND_V2` | web build | default on (red BY is canonical); `false` uses the legacy wordmark |
| `VITE_LEGAL_REVIEWED=true` | web build | hides the draft notice on `/premium-terms`, `/business-os-terms`, `/data-sharing` after legal review |
| `PREMIUM_CHECKOUT_ENABLED=true` | .com | opens Premium checkout; also needs `PAYMENTS_PROVIDER=stripe|telr` with credentials (mock never opens it in production) |
| `VAT_BPS` | .com | UAE VAT in basis points, default 500 (5%) |
| `VITE_STORE_URL` | web build | overrides `https://loadbyton.store` |

## 7. Operating it

* **Overview:** `GET /api/admin/ecosystem/overview` (staff): organisations, activations, queue depth (`pending` / `delivered` / `dead`).
* **Force a sweep** (grace expiry + re-queue + delivery): `POST /api/system/ecosystem-sweep` with `x-internal-key`. It also runs every 15 minutes in the worker.
* **Dead event:** fix the cause, then `POST /api/admin/ecosystem/events/:id/retry`. The Store de-duplicates, so a retry is safe.
* **Premium:** two plan versions are seeded on first start (Premium Monthly AED 199, Premium Annual AED 1,990, excluding VAT). A company administrator buys through hosted checkout (`POST /api/ecosystem/premium/checkout`); the provider webhook (`/api/webhooks/payments`, `PREM-` references) confirms the order, extends or creates the subscription once and issues a receipt number. Staff can still record a subscription manually (`/api/admin/ecosystem/subscriptions`, idempotent on `sourceRef`) and use `payment-failed`, `payment-recovered`, `cancel`, `renew`. Published plan versions are immutable; a price change is a new version.
* **Rotate the shared secret:** change it on both sides in one deploy window; events signed with the old secret fail with 401 and are retried, then land.
* **Rotate the signing key:** deploy the new PEM; relying parties re-fetch the JWKS when they see an unknown `kid`. Tokens are 10 minutes.

## 8. Tests

* `.com`: `server/test/ecosystem-entitlements.test.js` (rules, signing, back-off), `ecosystem-flow.test.js` (HTTP: identity, activation, premium lifecycle, signed delivery to a fake Store, reconciliation, OIDC incl. replay/PKCE/redirect/staff), `ecosystem-grace.test.js` (grace expiry, seat permissions), `ecosystem-premium.test.js` (pricing, VAT, gating, idempotent confirmation, renewal, amount mismatch); `web/e2e/ecosystem.spec.js` (UI, axe, OIDC round trip; skipped only when built with `VITE_ECOSYSTEM_UI=false`).
* Store: `tests/ecosystem.test.ts` (signature, ordering, no-downgrade, grace/suspension, fail-safe, reconciliation, full OIDC callback with tampered tokens, account linking).
* The two sides were also checked against each other: real events from a running .com were fed, with their real signatures, into the Store's receiver.

## 9. Before this goes live (outside the code)

Decided on 18 Oct 2026 (see `docs/MASTER_PLAN_v1.1.md`): one UAE entity operates both sites; Premium is AED 199 per month or AED 1,990 per year excluding 5% VAT; the 14-day grace is approved; red BY is canonical; all 18 sectors are released by operator declaration; legal documents are written as drafts.

Still open:

1. **Entity details.** Legal name, trade licence, licence authority, TRN and address, entered through `SELLER_*` on the Store and used on receipts and legal pages.
2. **Payment account.** A Stripe (UAE) or Telr merchant account for the entity, live keys and webhook secret, then `PREMIUM_CHECKOUT_ENABLED=true`. Verify the Telr callback signature canonicalisation against Telr's current documentation (marked VERIFY in `server/lib/payments.js`) before using Telr live.
3. **Legal review.** A qualified UAE lawyer reviews every document, then `LEGAL_REVIEWED` (Store) and `VITE_LEGAL_REVIEWED` (.com) are set. The iubenda connector was not authorised, so the texts are hand-written.
4. **Business OS operating mode.** The Store ships in brochure mode (`BROCHURE_MODE` defaults to true). Activation is only meaningful once the Store runs with `BROCHURE_MODE=false`. All 18 sectors then show live with `SECTOR_RELEASE=all`; that is a declaration, not independent acceptance evidence, and the specialist warnings stay.
5. **Contact.** Replace the Store's default contact phone (`CONTACT_PHONE`).
6. **Arabic.** The new screens are English only.
7. **Trademark** clearance and domain registrant proof.
8. **Other four domains** (`.shop`, `.net`, `.me`, `.xyz`) are listed as "Coming soon" and never linked.

## 10. Switching it on (staging first)

1. Generate the shared secret and the signing key; set the variables in §6 on both services; register the Store as an OIDC client.
2. Deploy .com to staging (the ecosystem UI is on by default); deploy the Store with the `COM_BASE_URL` / `OIDC_*` variables.
3. With a pilot company: verify it, activate Business OS, confirm the event arrives (`overview` shows `delivered`), sign in on the Store with "Continue with Loadbyton", confirm one workspace on `starter_included`.
4. Record a test premium subscription, confirm `enterprise_included`; mark payment failed, confirm grace; let the window pass (or set `ECOSYSTEM_GRACE_DAYS=0`), confirm the return to Starter with data intact.
5. Restore a backup of both databases into isolation and repeat step 3.

# Loadbyton ecosystem: loadbyton.com ↔ loadbyton.store

How the freight marketplace (this repo) and Business OS (`Loadbyton-OS`) work as one account, one company and one entitlement, and how to run, test and switch it on. Implements phases A–D and the Store side of F of the master plan (v1.0, 18 Oct 2026).

> **Status.** Built and tested. **Nothing is switched on in production.** Interface flags default to off, the OIDC issuer and the event delivery do nothing until configured, and Premium cannot be bought. Section 9 lists what must be decided before launch.

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
| `VITE_ECOSYSTEM_UI=true` | web build | network menu, footer directory, Business OS, benefits, organisation |
| `VITE_BRAND_V2=true` | web build | outlined SVG wordmark from the shared kit |
| `VITE_STORE_URL` | web build | overrides `https://loadbyton.store` |

## 7. Operating it

* **Overview:** `GET /api/admin/ecosystem/overview` (staff): organisations, activations, queue depth (`pending` / `delivered` / `dead`).
* **Force a sweep** (grace expiry + re-queue + delivery): `POST /api/system/ecosystem-sweep` with `x-internal-key`. It also runs every 15 minutes in the worker.
* **Dead event:** fix the cause, then `POST /api/admin/ecosystem/events/:id/retry`. The Store de-duplicates, so a retry is safe.
* **Premium (no checkout yet):** staff create and publish a plan version (`/api/admin/ecosystem/premium-plans`), then record a subscription after payment is confirmed (`/subscriptions`, idempotent on `sourceRef`), and use `payment-failed`, `payment-recovered`, `cancel`, `renew`. Published plan versions are immutable.
* **Rotate the shared secret:** change it on both sides in one deploy window; events signed with the old secret fail with 401 and are retried, then land.
* **Rotate the signing key:** deploy the new PEM; relying parties re-fetch the JWKS when they see an unknown `kid`. Tokens are 10 minutes.

## 8. Tests

* `.com`: `server/test/ecosystem-entitlements.test.js` (rules, signing, back-off), `ecosystem-flow.test.js` (HTTP: identity, activation, premium lifecycle, signed delivery to a fake Store, reconciliation, OIDC incl. replay/PKCE/redirect/staff), `ecosystem-grace.test.js` (grace expiry, seat permissions); `web/e2e/ecosystem.spec.js` (UI, axe, OIDC round trip; needs `VITE_ECOSYSTEM_UI=true`).
* Store: `tests/ecosystem.test.ts` (signature, ordering, no-downgrade, grace/suspension, fail-safe, reconciliation, full OIDC callback with tampered tokens, account linking).
* The two sides were also checked against each other: real events from a running .com were fed, with their real signatures, into the Store's receiver.

## 9. Before this goes live (not decided by the code)

1. **Billing entity and payment provider for Premium.** The Store's decision register (#2) names an India-based GST-registered freelancer with Stripe/Razorpay; this marketplace runs Stripe Connect/Telr escrow. Which entity invoices Premium, and its tax treatment, is open. Until then checkout stays closed (`checkout: "not_open"`).
2. **Premium price, period, tax and cancellation terms** (the plan-version fields exist; no price is seeded). When Premium launches, `/pricing` must change: it currently says "no subscription".
3. **Business OS scope.** The Store ships in brochure mode (`BROCHURE_MODE` defaults to true); the operating application is fenced and all 18 sectors are still `pilot`. Activation is only meaningful once the Store runs with `BROCHURE_MODE=false` for named pilot companies and the sector gates for what is exposed are accepted.
4. **Legal.** Terms/privacy/DPA for the data shared between the sites (company name, verified status, contact), the Business OS terms text (`ECOSYSTEM_TERMS_VERSION` is a draft marker), and a decision on the 14-day grace.
5. **Brand approval** (logo variant, red vs white/navy "BY"): `VITE_BRAND_V2` stays off until then. See `docs/brand/ECOSYSTEM_BRAND.md`.
6. **Arabic.** The new screens are English only.
7. **Other four domains** (`.shop`, `.net`, `.me`, `.xyz`) are listed as "Coming soon" and never linked.

## 10. Switching it on (staging first)

1. Generate the shared secret and the signing key; set the variables in §6 on both services; register the Store as an OIDC client.
2. Deploy .com with `VITE_ECOSYSTEM_UI=true` to staging; deploy the Store with the `COM_BASE_URL` / `OIDC_*` variables.
3. With a pilot company: verify it, activate Business OS, confirm the event arrives (`overview` shows `delivered`), sign in on the Store with "Continue with Loadbyton", confirm one workspace on `starter_included`.
4. Record a test premium subscription, confirm `enterprise_included`; mark payment failed, confirm grace; let the window pass (or set `ECOSYSTEM_GRACE_DAYS=0`), confirm the return to Starter with data intact.
5. Restore a backup of both databases into isolation and repeat step 3.

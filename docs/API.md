# Loadbyton — API Reference

Base URL: **`http://localhost:4000/api`** (dev: proxied at `/api` on `:5173`).

- Auth: **cookie session**. Login once (`POST /api/auth/login`) — the `lb_session` HttpOnly cookie is sent automatically. No `Authorization` header. All fetches from the SPA use `credentials: 'include'`.
- Content type: `application/json`. Every JSON body is `express.json()` parsed.
- Errors: non-2xx responses carry a structured envelope, not a bare string:
  ```json
  {
    "success": false,
    "error": "message",
    "code": "VALIDATION_FAILED",
    "message": "message",
    "_legacy": { "error": "message" },
    "errorDetails": { "code": "VALIDATION_FAILED", "message": "message" },
    "requestId": "..."
  }
  ```
  A client should check `success`/`code` (stable, machine-readable) rather than treating `error` as the only field — `error` is kept as a plain string for backwards compat (older clients read it directly), and `_legacy`/`errorDetails` are transitional duplicates from the envelope migration. See `server/lib/http.js` (`sendError`) and `server/lib/apiResponse.js` (`apiResponse.error`).
- Roles referenced below: `SHIPPER`, `CARRIER`, `ADMIN`.
- The public endpoints (`/api/health`, `/api/public/*`) need no auth.

---

## 1. System

### `GET /api/health`
- **Auth:** none
- **200** `{ "ok": true, "service": "loadbyton-api", "time": "<iso>", "pid": "<pid>", "port": 4000 }`

### `POST /api/system/auto-release`
- **Auth:** `ADMIN` (or `x-internal-key` header matching `INTERNAL_KEY`)
- **200** `{ "ok": true, "released": <n>, "message": "..." }` — forces a pass of the auto-release sweep (releases any `DELIVERED` job past its `auto_release_hours` window).

---

## 2. Auth

### `POST /api/auth/register`
- **Auth:** none
- **Body:**
  ```json
  {
    "email": "new@company.ae",
    "password": "secret",
    "role": "SHIPPER",              // SHIPPER | CARRIER
    "companyName": "Company LLC",
    "phone": "+971 4 000 0000",     // UAE mobile: +971 5x xxx xxxx (or landline +971 4/6/9)
    "trnNumber": "100234567800003", // exactly 15 digits
    "tradeLicenseNumber": "CN-12345", // 5–15 chars, at least one digit
    "referralCode": "CAR-EMIRATES"  // optional
  }
  ```
- **201** `{ user: {...} }` — creates `users` + `profiles` rows (bcrypt hash, role enforced to shipper/carrier), applies the referral link if valid, logs the user in (session cookie set). The account starts with `account_approval_status = 'PENDING'` and is **read-only until an admin approves it** — see §6 `GET /api/admin/approvals` (seeded demo accounts are pre-approved).
- **400** missing/duplicate email, or non-UAE phone / malformed TRN / malformed trade licence; **422** invalid role.

### `POST /api/auth/login`
- **Auth:** none
- **Body:** `{ "email", "password", "totpCode?" }` (`totpCode` required if MFA enabled).
- **200** `{ user: {...} }` — sets the `lb_session` cookie (7-day TTL). **429** if throttled (8 failed attempts / 15 min per email). **403** wrong password or MFA code.

### `GET /api/auth/me`
- **Auth:** session
- **200** `{ user: {...} }` — current user incl. nested profile. Shape:
  ```json
  {
    "user": {
      "id": 1, "email": "shipper@...", "role": "SHIPPER",
      "is_verified": 1, "mfa_enabled": 0, "tier": "SILVER",
      "referral_code": "SHP-ALMAJID", "referred_by": null,
      "created_at": "...",
      "profile": { "company_name": "...", "trn_number": "...", "trade_license_number": "...",
                   "phone": "...", "iban": "...", "coverage_zones": "...", "fleet_size": 42,
                   "owned_chassis": 30, "insurance_uploaded": 1, "rating_avg": 4.85,
                   "completed_jobs": 320, "verified_at": "..." },
      "impersonating": false, "impersonatedBy": null
    }
  }
  ```
  `impersonating`/`impersonatedBy` reflect the *current session*, not the user row — see `POST /api/admin/impersonate/:userId` in §6.

### `POST /api/auth/logout`
- **Auth:** session
- **200** `{ "ok": true }` — deletes the session row, clears the cookie.

### `POST /api/auth/mfa/setup`
- **Auth:** session
- **200** `{ "ok": true, "secret", "otpauthUrl" }` — generates/stores `mfa_secret`, returns the provisioning URL for authenticator apps.

### `POST /api/auth/mfa/disable`
- **Auth:** session
- **200** `{ "ok": true }` — clears `mfa_enabled`/`mfa_secret`.

### `POST /api/auth/resend-verification`
- **Auth:** session
- **200** `{ "ok": true }` — regenerates the email-verify token (24h expiry) and re-sends the verification link. **400** if the account is already verified.

### `PATCH /api/profile`
- **Auth:** session (any role)
- **Body:** any subset of `{ companyName, trnNumber, tradeLicenseNumber, phone, iban, coverageZones, fleetSize, ownedChassis, insuranceUploaded }`
- **200** `{ user }` with updated `profile`.

---

## 3. Public (no auth)

### `GET /api/public/lanes`
- **200** `{ lanes: [...] }` — the unified lane index. Each lane:
  ```json
  { "laneId": "JEBEL_ALI_T1:AL_QUOZ", "terminal": "JEBEL_ALI_T1", "area": "AL_QUOZ",
    "distanceKm": 21, "basePriceAed": 850, "pricePerKm": 12, "baseMinutes": 45,
    "onTimePct": 94, "monthlyLoads": 120 }
  ```

### `GET /api/public/carriers`
- **200** `{ carriers: [...] }` — verified-carrier directory (PII stripped — no phone/email/TRN).

### `GET /api/public/market`
- **200** `{ market: { teu2024, containersPerDay, avgDrayageAED, takeRate, annualSpend } }` — market pulse for the landing page.

---

## 4. Jobs & the marketplace

### `GET /api/jobs`
- **Auth:** session (role-scoped)
- **Query:** `?status=OPEN&limit=&offset=`
- **200** `{ jobs: [...] }`
  - SHIPPER → own jobs. CARRIER → `OPEN` jobs plus their own awarded/history. ADMIN → all.

### `POST /api/jobs`
- **Auth:** `SHIPPER`
- **Body:**
  ```json
  {
    "equipmentType": "CONTAINER_CHASSIS",
    "containerSize": "40HC", "containerType": "DRY", "containerNumber": "MSKU9281745",
    "pickupTerminal": "JEBEL_ALI_T2", "deliveryArea": "JAFZA_SOUTH",
    "deliveryAddress": "Street 14, Warehouse 8B, JAFZA South, Dubai",
    "readyAt": "<iso>", "deadline": "<iso>", "targetPriceAed": 1400,
    "requiresReefer": false, "requiresHazmat": false,
    "containerCount": 1, "truckCount": 1, "cargoWeightTons": 24.5,
    "freeTimeDays": 5, "demurrageRateAed": 400,
    "templateId": null, "contractLaneId": null, "notes": "...",
    "pickupLat": 25.0092, "pickupLng": 55.0617, "pickupAddressDetail": "Jebel Ali Port Gate 4",
    "deliveryLat": 25.1288, "deliveryLng": 55.2115, "deliveryAddressDetail": "Al Quoz Industrial 3, Warehouse 12"
  }
  ```
  `equipmentType` defaults to `CONTAINER_CHASSIS` if omitted/invalid — one of the 13 values in `DATA_MODEL.md`'s `jobs.equipment_type` (incl. `CUSTOM`). `containerSize`/`containerType` are only validated (and required) when `equipmentType` is a container-carrying type (`CONTAINER_CHASSIS` or `TRAILER_WITH_GENSET`); for every other equipment type the server stores `'N/A'`/`'GENERAL'` regardless of what's sent, and `notes` becomes the required cargo description instead. `CUSTOM` requires `customRequirement` (or `notes`) — a written truck/requirement, merged into `notes` server-side. `targetPriceAed` maps to `max_budget_aed` (the legacy field name `maxBudgetAed` is still accepted). `containerCount`/`truckCount` default to `1` — raise either for a volume inquiry (one job, one award, covering the stated batch).
  `pickupLat`/`pickupLng`/`deliveryLat`/`deliveryLng` are optional precise coordinates stored on top of the required `pickupTerminal`/`deliveryArea` enums (which drive lane rate lookups). The client UI no longer offers a map picker, so these arrive only from programmatic callers — **400** if only one of a lat/lng pair is sent, or the pair falls outside a loose UAE bounding box. `cargoWeightTons` is an optional positive number (max 500) recording the cargo's gross weight in metric tons.
- **201** `{ job }` with generated `job_code` (e.g. `LBT-DXB-2608-4921`), status `OPEN`.

### `POST /api/jobs/import`
- **Auth:** `SHIPPER`
- **Body:** `{ jobs: [...] }` — array (max 200) of objects in the same shape as `POST /api/jobs`'s body. CSV parsing happens client-side (`web/src/lib/csv.js`); this route only ever sees JSON.
- **201** `{ results: [{ row, ok, jobCode?, jobId?, error? }], created, failed }` — each row is validated/inserted independently (same `createJobFromBody` logic as the single-job route), so one bad row doesn't sink the batch.

### `GET /api/jobs/:id`
- **Auth:** session (job participant, or admin; `OPEN` jobs visible to carriers)
- **200** `{ job }` — job plus `bids[]`, `documents[]`, `messages[]`, `payout`. For a non-awarded `OPEN` job, competitor bids are masked (no amounts) until award — contact gating.

### `PATCH /api/jobs/:id`
- **Auth:** `SHIPPER`, job owner, seat `OPS`, job `OPEN` **and no pending bid on it yet**
- **Body:** any subset of `{ shipmentType, importPickupTerminal, importUnloadingLocation, importEmptyReturnLocation, exportEmptyPickupLocation, exportLoadingLocation, exportDepositTerminal, pickupTerminal, deliveryArea, deliveryAddress, containerNumber, readyAt, deadline, targetPriceAed, notes, containerCount, truckCount, cargoWeightTons, pickupLat, pickupLng, pickupAddressDetail, deliveryLat, deliveryLng, deliveryAddressDetail, loadingLocation, deliveryLocation }` — `shipmentType`, if sent, is re-validated against `IMPORT`\|`EXPORT`\|`LOCAL`; a lat/lng pair, if sent, must be valid UAE coordinates.
- **200** `{ job }` — edits an already-posted job in place rather than requiring cancel-and-repost. **403** if not the owner, not `OPEN`, or a carrier already has a `PENDING` bid on it (withdraw/reject bids first, or cancel and repost). **400** invalid `shipmentType` or lat/lng.

### `POST /api/jobs/:id/bids`
- **Auth:** `CARRIER` **+ verified profile** + job `OPEN`
- **Body:** `{ amountAed, etaAt, truckType, notes }` — `etaAt` is an ISO date/time (not a minute count): it can't be more than an hour in the past (`etaAt cannot be more than an hour in the past`) or more than 90 days out (`etaAt cannot be more than 90 days out`). `truckType` is free text (stored as-is); the client UI offers the equipment values as a picklist defaulting to the job's own requirement, but the field isn't server-validated against that enum. Driver name/phone are **not** collected at bid time — they're only ever captured post-award via `PATCH /api/jobs/:id/driver` (contact-sharing follows the confirmed business relationship).
- **201** `{ bid }`
- **403** unverified carrier or job not open (`{ "error": "Carrier verification required to bid." }`). **409** if the carrier already has a `PENDING` bid on this job.

### `GET /api/bids/mine`
- **Auth:** `CARRIER`
- **200** `{ bids: [{ ...bid, job_code, pickup_terminal, delivery_area, job_status }] }` — every bid the carrier has ever placed, newest first, pre-joined with the job's lane so the "My bids" page doesn't have to N+1 `GET /api/jobs/:id` per row.

### `POST /api/bids/:id/withdraw`
- **Auth:** `CARRIER`, own bid, bid `status = PENDING`
- **200** `{ ok: true, bid }` — sets `bids.status = 'WITHDRAWN'`. **400** if the bid isn't pending (already accepted/rejected). **403** if it isn't the caller's bid.

### `POST /api/jobs/:id/award`
- **Auth:** `SHIPPER`, job owner, job `OPEN`
- **Body:** `{ bidId }`
- **200** `{ ok: true, job }` — transactional award: job → `AWARDED` (legal from `OPEN`/`BIDDING`/`DRAFT`), bid → `ACCEPTED`, others → `REJECTED`, escrow → `HELD`, payout row created (gross/fee/net, `release_type=MANUAL`), audit entries, notifications.
- With a payment processor configured (`PAYMENTS_PROVIDER`, see `docs/PAYMENTS.md`) the job is also marked `processor_payment_status=REQUIRES_PAYMENT` — the shipper must pay before the carrier picks up.
- **409** awarded concurrently; **404** bad bid.

### `POST /api/jobs/:id/payment-checkout`
- **Auth:** `SHIPPER` (owner), seat `OPS`
- Creates (or re-returns, idempotent per job) the processor-hosted checkout for an `AWARDED` job with escrow `HELD`.
- **200** `{ ok: true, paymentUrl, ref, provider, testMode }` — redirect the shipper to `paymentUrl` (`paymentUrl` is `null` in `mock` mode; confirmation arrives via webhook). **409** not AWARDED/HELD or already paid. **400** processor not configured (internal escrow — the admin confirm-receipt path applies). **502** provider unavailable.

### `POST /api/webhooks/payments`
- **No auth** — the processor's callback endpoint (`https://<host>/api/webhooks/payments`). Signature-verified (fail-closed: `401` on mismatch) and idempotent (`200 { ok: true, idempotent: true }` on replays).
- Accepts JSON (mock provider) and form-encoded (Telr) bodies. Events: `AUTHORISED` (escrow `HELD → FUNDED`, `processor_payment_status → PAID`, stores `processor_tranref`), `DECLINED`/`CANCELLED` (`FAILED`), `REFUNDED` (`REFUNDED`). Every application is audited (`ESCROW_FUND`, `PAYMENT_REFUND`, `PAYMENT_WEBHOOK_REJECTED`, ...).

### `PATCH /api/jobs/:id/status`
- **Auth:** job participant (role rules) — see state machine in `ARCHITECTURE.md` §3.4
- **Body:** `{ status: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "COMPLETED" | "CANCELLED" }`
- **200** `{ job }` — enforces forward-only progression per role; audits every transition. **400** if `PICKED_UP` is attempted before the carrier has filed the driver via `PATCH /api/jobs/:id/driver` (driver contact is a hard prerequisite for pickup).

### `PATCH /api/jobs/:id/driver`
- **Auth:** `CARRIER`, own award, seat `OPS`, job status one of `AWARDED`\|`PICKED_UP`\|`IN_TRANSIT`
- **Body:** `{ driverName, driverPhone }` — `driverPhone` must normalize to a valid UAE mobile number.
- **200** `{ job }` — the sole driver-capture path: the driver's details are shared with the shipper only after the bid is confirmed (award), never before. Fires the `job_awarded_pickup_details` notification to the shipper. Corrects the driver on file if the actual driver changes before delivery. **403** once the job reaches `DELIVERED`.

### `POST /api/jobs/:id/pod`
- **Auth:** `CARRIER` (awarded), job `IN_TRANSIT`
- **Body:** `{ document?: { docType, title, fileUrl } | { docType, title, fileBase64, mimeType } }` — either an external `fileUrl`, or a real upload as base64 (`fileBase64`) with `mimeType` one of `image/jpeg`\|`image/png`\|`image/webp`\|`application/pdf`, up to 5MB.
- **200** `{ job }` — sets `delivered_at`, status `DELIVERED`, starts the auto-release clock (`auto_release_hours`, default 24 h). A POD document is recorded in `job_documents`; an uploaded file is validated and written to disk before the job status changes, so a bad upload 400s without leaving the job DELIVERED.

### `GET /api/jobs/:id/track`
- **Auth:** session (participant)
- **200** `{ job, shipperName, carrierName, statusIndex, canProgress, demurrageExposure, hoursSinceDelivered, autoReleaseAt, geofence: { pickup, delivery, atPickup, atDelivery } }` — live tracking view for the detail page (`demurrageExposure` = free-time days exceeded × rate; `autoReleaseAt` = `delivered_at + auto_release_hours`).

### `GET /api/jobs/:id/backload-matches`
- **Auth:** `CARRIER`, must be this job's own `carrier_id`, job status one of `AWARDED`\|`PICKED_UP`\|`IN_TRANSIT`\|`DELIVERED`\|`COMPLETED`
- **200** `{ matches: [{ ...job, matchType: "coords"|"area", distanceKm }] }` — up to 10 `OPEN` jobs that make a good return leg after this one, ranked by real haversine distance (`matchType: "coords"`) when both this job's `delivery_lat/lng` and a candidate's `pickup_lat/lng` are set, falling back to `matchType: "area"` (same emirate, via a real `TERMINALS`/`AREAS` → emirate mapping — not a distance) when a pin is missing on either side. Coordinate matches always sort ahead of area matches.
- **403** if the job isn't the caller's own award, or isn't in an eligible status yet.

### `POST /api/jobs/:id/documents`
- **Auth:** participant
- **Body:** `{ docType: "CUSTOMS"|"RECEIPT"|"POD"|"LICENCE"|"INSURANCE"|"OTHER", title, fileUrl }` or `{ docType, title, fileBase64, mimeType }` for a real upload (same constraints as `/pod` above).
- **201** `{ ok: true }` — appended to `job_documents` (the persistent per-job document/customs thread). **403** unless the caller is the job's shipper, the awarded carrier, or an admin — a bidding (non-awarded) carrier cannot upload.

### `GET /api/jobs/:id/documents/:docId/file`
- **Auth:** participant or bidder (`isParticipantOrBidder`)
- **200** the file bytes (`Content-Type` from the stored `mime_type`) for an uploaded document, or a `302` redirect to `file_url` for a legacy external link.

> **Document privacy:** documents are shared only after the business relationship is confirmed. While a job is `OPEN`, the documents list is empty for every carrier — the shipper's customs docs stay private until the award. After the award, the shipper and the awarded carrier see each other's documents; losing bidders still see nothing. The file-serve route enforces the same rule (files themselves are gated, not just metadata).

### `POST /api/jobs/:id/rating`
- **Auth:** participant, terminal job
- **Body:** `{ score: 1–5, comment? }`
- **201** `{ ok: true }` — writes `ratings`; updates `profiles.rating_avg` and `completed_jobs` for the ratee. **409** if the rater already rated this job.

### `POST /api/jobs/:id/dispute`
- **Auth:** `SHIPPER`\|`CARRIER`, own job, seat `OPS`, job status one of `AWARDED`\|`PICKED_UP`\|`IN_TRANSIT`\|`DELIVERED`\|`COMPLETED`
- **Body:** `{ reason }`
- **201** `{ dispute }` — self-serve dispute filing (job + escrow → `DISPUTED`, frozen). Previously only an admin could open a dispute (`POST /api/admin/disputes` in §6) — a party with an actual problem had no in-app way to raise it. Notifies the counterparty and all admins.

### `GET /api/jobs/:id/dispute`
- **Auth:** session (job's shipper/carrier, or admin)
- **200** `{ dispute, job: { id, job_code, status, escrow_status } }` — party-facing view of the job's most recent dispute (status/determination/decision). **404** if the job has no dispute. Replies go through the job's existing messages thread below — once a job is `DISPUTED`, that thread is restricted to the shipper/carrier/admin only (no bidder fallback), since it doubles as the dispute correspondence.

### `GET /api/jobs/:id/messages`
- **Auth:** participant (or bidder, pre-award) — once the job is `DISPUTED`, restricted to the shipper/carrier/admin only
- **200** `{ messages: [{ ...message, sender_role }] }` — `sender_role` (`SHIPPER`\|`CARRIER`\|`ADMIN`) lets the client render an admin's reply as a distinct bubble.

### `POST /api/jobs/:id/messages`
- **Auth:** participant (or bidder, pre-award) — once the job is `DISPUTED`, restricted to the shipper/carrier/admin only
- **Body:** `{ content }`
- **201** `{ message }` — in-app thread; the only place parties talk before award (contact gating keeps phone numbers hidden until then). Notifies the other party; if the sender is an admin (neither the job's shipper nor carrier), notifies both.

---

## 5. Retention: templates, contracts, analytics, earnings, notifications

### `GET /api/templates` · `POST /api/templates`
- **Auth:** `SHIPPER`
- List saved lanes; create with `{ name, pickupTerminal, deliveryArea, deliveryAddress, containerSize, containerType, cadence: "ONCE"|"WEEKLY"|"BIWEEKLY"|"MONTHLY", notes }`.

### `POST /api/templates/:id/rerun`
- **Auth:** `SHIPPER` (owner)
- **201** `{ job }` — clones the template into a fresh `OPEN` job in one call.

### `GET /api/contracts` · `POST /api/contracts`
- **Auth:** `SHIPPER`
- List/create committed-volume lanes (`monthlyLoads`, `targetPriceAed`, status `ACTIVE|PAUSED`).

### `GET /api/analytics/mine`
- **Auth:** session (role-aware)
- **200** `{ analytics: { ... } }`
  - CARRIER: `{ totalBids, jobsWon, paidOutAED, pendingAED, rating, onTime, tier }`
  - SHIPPER: `{ jobsPosted, jobsCompleted, totalSpentAED, activeJobs, savingsPercent, tier, rating }` (savings = per-lane platform median vs a market average)

### `GET /api/earnings`
- **Auth:** `CARRIER`
- **200** `{ payouts: [{ job_code, status, agreed_price_aed, job_created, gross_aed, platform_fee_aed, net_aed, payout_status, release_type, released_at }], totals: { paid, pending } }` — the carrier ledger; `totals` are sums of `net_aed` (paid = released, pending = everything not released/cancelled). Note payout rows are keyed by `job_code`, not `job_id`.

### `GET /api/notifications`
- **Auth:** session
- **200** `{ notifications: [...] }` — unread first.

### `POST /api/notifications/read`
- **Auth:** session
- **200** `{ ok: true }` — marks **all** of the current user's notifications read (bulk, no id).

### `GET /api/notifications/preferences` · `PATCH /api/notifications/preferences`
- **Auth:** session
- **200 (GET)** `{ types: [...all notification types], disabled: [...] }`
- **Body (PATCH):** `{ disabled: string[] }` — must be a subset of `types`.
- **200 (PATCH)** `{ types, disabled }` — opts the current user out of specific notification types (e.g. `message`). System-critical types still fire regardless (see `notify()`'s `type !== 'system'` gate in `server/index.js`).

### `GET /api/org/members` · `POST /api/org/members` · `PATCH /api/org/members/:id`
- **Auth:** `SHIPPER`\|`CARRIER`. `POST`/`PATCH` require the org **root** — no seat role can add, re-role, or deactivate another seat.
- **200 (GET)** `{ root: { id, email, displayName }, seats: [{ id, email, display_name, seat_role, is_active, created_at }] }`
- **Body (POST):** `{ email, password, seatRole: "OPS"|"FINANCE"|"VIEWER", displayName }` — creates a seat (own `users` row, `org_owner_id` pointing at the caller) sharing the org's role/tier/verification status.
- **201 (POST)** `{ seat }`.
- **Body (PATCH):** any subset of `{ seatRole, isActive }` — deactivating a seat (`isActive: false`) also kills any of its live sessions immediately.
- **200 (PATCH)** `{ seat }`.

### `GET /api/invoices`
- **Auth:** `CARRIER`\|`ADMIN`
- **200** `{ invoices: [...] }` — CARRIER sees their own; ADMIN sees all (max 200, newest first).

### `GET /api/invoices/:id`
- **Auth:** `CARRIER` (own invoice only) \| `ADMIN`
- **200** an HTML invoice (add `?format=json` for `{ invoice, job }` instead). **403** if it isn't the caller's own invoice.

### `GET /api/invoices/print.js`
- **Auth:** none
- Same-origin JS for the invoice page's print button (works under the strict `script-src 'self'` CSP, which would silently block an inline `onclick`).

---

## 6. Admin

All routes below require `auth(['ADMIN'])`.

### `GET /api/admin/health`
- **200** `{ health: { openJobs, totalBids, avgBidsPerJob, completionRate, escrowHeld, disputesOpen, lanes } }` — ops dashboard with live lane health.

### `GET /api/admin/approvals`
- **200** `{ queue: [pending-approval accounts with profile] }` — every account with `account_approval_status = 'PENDING'`, including the decrypted TRN for review. This is the queue behind the first business-day onboarding step: **a newly registered account is read-only (browse only) until an admin approves it here.**

### `POST /api/admin/approve/:id`
- **Body:** `{ action: "approve" | "reject" }`
- **200** `{ ok, user }` — sets `account_approval_status` to `APPROVED` (account fully unlocked) or `REJECTED`; audited (`ACCOUNT_APPROVE` / `ACCOUNT_REJECT`) and notifies the account owner by email.

### `GET /api/admin/verification`
- **200** `{ queue: [unverified carriers with profile] }`

### `POST /api/admin/verify/:id`
- **Body:** `{ action: "approve" | "reject", iban?: string }` — approve requires an IBAN.
- **200** `{ ok, user }` — marks verified, stores IBAN (payout destination), sets `verified_at`, audits + notifies the carrier.

### `POST /api/admin/verify-bulk`
- **Body:** `{ ids: number[] (max 100), action: "approve" | "reject" }` — no per-carrier IBAN input; a bulk `approve` only succeeds for a carrier that already has one on file.
- **200** `{ results: [{ id, ok, error? }], succeeded, failed }` — each id is processed independently through the same logic as the single-carrier route, so one failure (usually a missing IBAN) doesn't block the rest of the batch.

### `POST /api/admin/confirm-receipt`
- **Body:** `{ jobId }` — moves escrow `HELD → FUNDED` once funds are actually received (audited).

### `GET /api/admin/users`
- **200** `{ users: [{ id, email, role, is_verified, tier, created_at, profile: { company_name, completed_jobs, rating_avg } }] }` — every user on the platform (not just the unverified queue). The Members tab filters this list client-side by role/verified/search.

### `GET /api/admin/referrals`
- **200** `{ referrals: [{ referredUserId, referredEmail, referredAt, referralCode, referrerId, referrerEmail, referrerCompany, fleetSize, status }] }` — every account that signed up with a referral code, joined to the referrer. `status` is `PENDING` or `CREDITED` (`CREDITED` once the referred account has a `COMPLETED` job) — it's derived, not a stored/toggleable flag.

### `POST /api/admin/impersonate/:userId`
- **200** `{ ok: true, user }` — starts impersonating the target (not another admin — **400** if it is). Issues a new, separate session for the target user tagged with the admin's id and capped at 30 minutes, and swaps the caller's cookie to it. Audited as `IMPERSONATE_START`.

### `POST /api/admin/impersonate/end`
- **Auth:** any session currently impersonating (i.e. `impersonating_admin_id` set on the current session row)
- **200** `{ ok: true, user }` — restores the original admin's session. **400** if the current session isn't an impersonation. Audited as `IMPERSONATE_END`.

### `GET /api/admin/audit`
- **200** `{ entries: [last 100 audit rows] }`

### `GET /api/admin/disputes`
- **200** `{ disputes: [...] }`

### `POST /api/admin/disputes`
- **Body:** `{ jobId, reason }`
- **201** `{ dispute }` — opens a dispute: job + escrow → `DISPUTED` (frozen).

### `POST /api/admin/disputes/:id/resolve`
- **Body:** `{ determination, decision: "RELEASE_TO_CARRIER" | "REFUND_SHIPPER" | "SPLIT" }`
- **200** `{ ok }` — releases the payout (marking escrow `RELEASED` with `release_type='DISPUTE_RESOLUTION'`) or refunds, audits + notifies both parties.

### `GET /api/admin/evidence/:jobId`
- **200** `{ evidence: { job, bids, documents, messages, ratings, auditTrail } }` — the dispute dossier for that job. (A dispute-id-keyed alias, `GET /api/admin/disputes/:id/evidence`, existed briefly but was removed as a redundant duplicate — the Disputes admin UI and `docs/TUTORIAL.md` both use this job-id-keyed form.)

### `GET /api/admin/revenue`
- **200** `{ revenue: { gmvAED, platformFeesAED, escrowHeldAED, avgTakeRate } }` (`avgTakeRate` is a `%` string).

### `GET /api/admin/payouts-sla`
- **200** `{ pending: [{ id, job_id, job_code, carrier_id, net_aed, release_type, released_at, sla_deadline, transfer_executed_at, transfer_reference, overdue }], overdueCount }` — every `RELEASED` payout whose actual bank transfer hasn't been confirmed yet, `overdue` flagging any past `sla_deadline`.

### `POST /api/admin/payouts/:id/mark-transferred`
- **Body:** `{ reference? }` — optional bank transfer reference.
- **200** `{ payout }` — confirms the real off-platform transfer happened (`transfer_executed_at`), closing out the SLA row above. **400** if the payout isn't `RELEASED` yet; **409** if already confirmed.

### `GET /api/admin/settings` · `PATCH /api/admin/settings`
- **Body (PATCH):** `{ commission_rate_bps?: 0–10000, auto_release_hours?: 1–168 }`
- **200** `{ settings: { commission_rate_bps, auto_release_hours } }` — drives the platform fee and the auto-release window platform-wide.

---

## 7. Compliance (customs declarations)

### `POST /api/jobs/:id/compliance`
- **Auth:** `SHIPPER`\|`ADMIN`, job's own shipper (or admin)
- **Body:** `{ hsCode | hs_code, manifest? }` — `hsCode` must be a 6–10 digit HS classification code. `manifest` defaults to `{ job: job_code, hs, origin: pickup_terminal, dest: delivery_area }` if omitted.
- **201** `{ declaration, manifest }` — files a customs declaration; commits a simulated ZKP hash (`manifestHash`/`zkProof`) and fires an async webhook to `TAX_CLEARING_WEBHOOK` if configured. **403** if not the job's shipper. **400** invalid HS code.

### `POST /api/compliance/:id/clear`
- **Auth:** `ADMIN`
- **200** `{ declaration }` — marks a declaration `CLEARED`. **404** if not found.

### `GET /api/jobs/:id/compliance`
- **Auth:** session, job's shipper/carrier or admin
- **200** `{ declarations: [...] }` — every declaration filed against the job. **403** if not a party to the job.

---

## 8. EDI / consignment ingestion

### `POST /api/edi/ingest`
- **Auth:** `SHIPPER`\|`ADMIN`
- **Body:** `{ source: "EDI_304"|"EDI_310"|"CARGO_XML", data, mode?, linkedJobId? }` — `data` is mapped into a `global_consignments` row keyed by an id derived from the payload (BOL/invoice/AWB, or a generated fallback). `linkedJobId`, if sent by a non-admin, must be one of the caller's own jobs.
- **201** `{ consignment }` — upserted (insert-or-update) by id. **400** missing/invalid `source`/`data`. **403** `linkedJobId` isn't the caller's own job.

### `GET /api/edi/consignments`
- **Auth:** `SHIPPER`\|`ADMIN`
- **200** `{ consignments: [...] }` (max 100, newest first) — SHIPPER sees only consignments linked to one of their own jobs; ADMIN sees everything.

### `GET /api/edi/consignments/:id`
- **Auth:** `SHIPPER`\|`ADMIN`
- **200** `{ consignment, linkedJob: { job_code, status } | null }` — **403** unless the caller is admin or the consignment is linked to one of their own jobs. **404** unknown id.

### `POST /api/edi/consignments/:id/transition`
- **Auth:** `SHIPPER`\|`ADMIN`, must own the linked job (or be admin)
- **Body:** `{ status: "CREATED"|"IN_TRANSIT"|"DELIVERED"|"COMPLETED"|"CANCELLED" }`
- **200** `{ consignment }` — advances the consignment's state machine. **400** invalid status. **403**/**404** as above.

---

## 9. RFP / contract-lane bidding

### `POST /api/rfps`
- **Auth:** `SHIPPER`, seat `OPS`
- **Body:** `{ title, description?, origin, destination, totalContainers, durationMonths (1–60), budgetAed }`
- **201** `{ rfp }` — creates an enterprise contract-lane RFP and auto-generates one `rfp_milestones` row per month, splitting `budgetAed` evenly (remainder on the last milestone). **400** missing/invalid fields.

### `GET /api/rfps`
- **Auth:** session
- **200** `{ rfps: [...] }` — SHIPPER sees only their own; ADMIN sees all; CARRIER sees demo-or-real RFPs matching their own demo status.

### `GET /api/rfps/:id`
- **Auth:** session
- **200** `{ rfp, bids, milestones }` — the owning shipper and admin see every bid on the RFP; any other carrier sees only their own bid, never a competitor's pricing/proposal. **403** a non-owning shipper. **404** unknown id.

### `POST /api/rfps/:id/bids`
- **Auth:** `CARRIER`, RFP `status = OPEN`
- **Body:** `{ amountAed, etaDays?, proposal? }` (`etaDays` defaults to 30)
- **201** `{ ok: true }` — notifies the RFP's shipper. **400** RFP not open, or invalid `amountAed`.

### `POST /api/rfps/:id/award`
- **Auth:** `SHIPPER`, RFP owner
- **Body:** `{ bidId }`
- **200** `{ ok: true }` — awards the RFP to a bid (RFP → `AWARDED`, winning bid → `ACCEPTED`, others → `REJECTED`). **403** not the RFP's owner. **404** unknown bid.

---

## 10. Telematics (hardware ingestion)

### `POST /api/telematics/ingest`
- **Auth:** none (device-keyed) — requires `x-device-token`, `x-internal-key`, or `x-api-key` matching `TELEMATICS_DEVICE_KEY` or `INTERNAL_KEY`; rate-limited to 120 requests/min/IP. **401** if neither env var is configured (fail-closed) or the key doesn't match.
- **Body:** `{ deviceId, jobId?, latitude|lat, longitude|lng, speed?, temperature?, fuelLevel? }`
- **200** `{ ok: true, logged: deviceId }` — appends to `telematics_logs`; if `jobId` resolves to an `IN_TRANSIT` job, also mirrors the ping into `location_logs` for the unified map view.

### `GET /api/telematics/logs`
- **Auth:** session, or `x-internal-key`/`ADMIN` for unfiltered access
- **Query:** `?jobId=&deviceId=&limit=` (max 200)
- **200** `{ logs: [...] }` — a non-privileged shipper/carrier **must** pass `jobId` for a job they're a party to (**400**/**403** otherwise); `deviceId` filtering is admin/internal-key only.

---

## 11. Predictive ETA (ML)

### `POST /api/ml/predict-eta`
- **Auth:** session
- **Body:** `{ jobId? }` or `{ origin, destination }`, plus optional `vesselLat`, `vesselLng`, `weatherSeverity`
- **200** `{ prediction: { baseHours, weatherPenalty, congestion, predictedHours, alternatives, inputs } }` — a deterministic mock pipeline standing in for real AIS/NOAA/port-delay feeds. **400** neither `jobId` nor `origin`+`destination` given.

### `POST /api/ml/ingest/ais`
- **Auth:** `ADMIN`
- **Body:** `{ positions: [{ mmsi, lat, lng, speed, course }] }`
- **200** `{ ingested, status }` — stub ingestion (no persistence yet; real version would feed TimescaleDB/PostGIS).

### `POST /api/ml/ingest/noaa`
- **Auth:** `ADMIN`
- **Body:** `{ feeds }`
- **200** `{ ingested, status }` — stub ingestion.

---

## 12. Branded documents (generated PDFs/HTML)

Five printable, job-scoped documents beyond the tax invoice (`GET /api/invoices/:id` in §5). All are `GET`, `auth()`-gated to the job's shipper/carrier/admin, and return `text/html` (browser print-to-PDF).

### `GET /api/jobs/:id/documents/settlement`
- **200** rendered settlement statement. **404** if no payout exists yet for the job.

### `GET /api/jobs/:id/documents/load-confirmation`
- **200** rendered load confirmation. **404** if the job hasn't been awarded yet.

### `GET /api/jobs/:id/documents/pod-certificate`
- **200** rendered POD certificate (uses the most recent `POD`-type `job_documents` row, if any).

### `GET /api/jobs/:id/documents/eir-summary`
- **200** rendered EIR (Equipment Interchange Receipt) summary from every `EIR`-type document on the job.

### `GET /api/jobs/:id/documents/dispute-notice`
- **200** rendered dispute notice. **404** if the job has no `RESOLVED` dispute on file.

---

## 13. Fleet: driver roster, seats, driver documents

### `GET /api/fleet/overview`
- **Auth:** `CARRIER`
- **200** `{ jobs: [{ job_code, status, driver, delivered_at }] }` — thin summary of the carrier's last 50 jobs.

### `GET /api/fleet/drivers`
- **Auth:** `CARRIER`
- **200** `{ drivers: [...] }` — active roster drivers, own carrier only.

### `POST /api/fleet/drivers`
- **Auth:** `CARRIER`, seat `OPS`
- **Body:** `{ name, phone, licenseNumber?, licenseExpiry? }` — `phone` must normalize to a UAE mobile; `licenseNumber` (if given) is 5–15 letters/digits/dashes with at least one digit.
- **201** `{ driver }` — registers a driver once, to be picked (not retyped) at award time via `PATCH /api/jobs/:id/driver`.

### `PATCH /api/fleet/drivers/:id`
- **Auth:** `CARRIER`, seat `OPS`, own driver
- **Body:** any subset of `{ name, phone, licenseNumber, licenseExpiry }`
- **200** `{ driver }`. **404** not the caller's driver.

### `DELETE /api/fleet/drivers/:id`
- **Auth:** `CARRIER`, seat `OPS`, own driver
- **200** `{ ok: true }` — soft delete (`is_active=0`); a past job's `assigned_driver_id` may still reference the row, so it's deactivated, never removed.

### `POST /api/fleet/drivers/:id/seat`
- **Auth:** `CARRIER`, **org root only** (no seat role can call this)
- **Body:** `{ password? }` (min 8 chars if given; otherwise a random one is generated)
- **201** `{ email, password }` — provisions a `DRIVER` seat login for a roster driver (email is a synthetic `<phone>@drivers.loadbyton.internal` address, never shown to the driver). The password is returned exactly once and never stored/retrievable again. **400** the driver already has a login.

### `POST /api/fleet/drivers/:id/documents/upload-url`
- **Auth:** `CARRIER`, seat `OPS`, own driver
- **Body:** `{ mimeType }`
- **200** a presigned S3 PUT URL, or `{ useBase64: true }` if S3 isn't configured.

### `POST /api/fleet/drivers/:id/documents`
- **Auth:** `CARRIER`, seat `OPS`, own driver
- **Body:** `{ docType: "LICENSE"|"VEHICLE", mimeType, fileBase64|storageKey }`
- **200** `{ driver }` (updated with the new document's storage path).

### `GET /api/fleet/drivers/:id/documents/:docType`
- **Auth:** session — the driver's own carrier, a shipper whose job that driver is assigned to, or admin
- **200** the file bytes for `docType` (`license`\|`vehicle`). **403** not permitted. **404** no document uploaded.

---

## 14. Driver (seat) job view

### `GET /api/driver/job`
- **Auth:** `CARRIER` session **acting as a `DRIVER` seat**
- **200** `{ job: { id, job_code, status, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, cargo_type, equipment_type, pickup_lat, pickup_lng, delivery_lat, delivery_lng, updated_at } | null }` — the single job currently assigned to this driver (a deliberately small payload — a driver seat sees nothing else, per `middleware/auth.js`'s `DRIVER_SEAT_ALLOWED_ROUTES`). **403** if the acting seat isn't a `DRIVER`.

---

## 15. Enterprise: e-token, EIR photos, detention, fuel advance

### `POST /api/jobs/:id/etoken`
- **Auth:** `CARRIER`, own job
- **Body:** `{ token }` (min 6 chars)
- **200** `{ ok: true }` — records the DP World E-Token gate slot and notifies the shipper.

### `POST /api/jobs/:id/eir`
- **Auth:** `CARRIER`, own job
- **Body:** `{ photos: [ {title?, fileBase64|storageKey, mimeType}, ... ] }` — exactly 3, in order Seal / Right Side / Left Side.
- **200** `{ ok: true, photos: [storagePath, storagePath, storagePath] }` — stores each as an `EIR`-type `job_documents` row and on `jobs.eir_photos`.

### `GET /api/jobs/:id/detention`
- **Auth:** session, job participant or admin
- **200** `{ jobId, freeDays, rateAed, daysSinceDelivery, daysLeft, status: "OK"|"DUE_TOMORROW"|"DUE_TODAY"|"OVERDUE", alarm }` — demurrage/detention exposure check.

### `POST /api/system/detention-alarms`
- **Auth:** `x-internal-key` header matching `INTERNAL_KEY`, or `ADMIN` session
- **200** `{ alerted }` — scans delivered/in-flight jobs one day before their free-time window ends and notifies the carrier (WhatsApp/SMS stub + in-app).

### `POST /api/jobs/:id/fuel-advance`
- **Auth:** `CARRIER`, own job
- **Body:** `{ type: "FUEL"|"SALIK" }`
- **200** `{ ok: true, amount, type }` — one advance per job, 20% of the agreed freight price. **400** already taken, or no agreed price to advance against.

### `GET /api/jobs/:id/fuel-advances`
- **Auth:** session, job's own carrier or admin
- **200** `{ advances: [...] }`.

### `GET /api/carrier/fleet`
- **Auth:** `CARRIER`
- **200** `{ fleet: [{ driver, jobs, completed, completionRate, podClean, avgHours }] }` — per-driver performance rollup from the carrier's last 100 jobs.

---

## 16. Ledger: debt-instrument tokenization

### `POST /api/jobs/:id/tokenize`
- **Auth:** `SHIPPER`\|`ADMIN`, job's own shipper (or admin)
- **Body:** `{ blNumber, faceValueAed? }` (defaults to the job's agreed/target price)
- **201** `{ instrument, risk: { score, rateBps, lane } }` — creates a `debt_instruments` row with a computed risk score (rating, completed-jobs, lane stability, country risk) and interest rate. **400** missing `blNumber`/face value.

### `GET /api/ledger/instruments`
- **Auth:** `ADMIN`
- **200** `{ instruments: [...] }` (max 100, unfiltered platform-wide).

### `GET /api/jobs/:id/instruments`
- **Auth:** session, job's shipper/carrier or admin
- **200** `{ instruments: [...] }` for that job.

---

## 17. Verification: TRN & carrier gate

### `GET /api/verify/trn/:trn`
- **Auth:** session
- **200** external TRN registry lookup result (`trn` must be 15 digits — **400** otherwise).

### `POST /api/verify/check`
- **Auth:** session
- **Body:** `{ trnNumber, tradeLicenseNumber? }`
- **200** `{ trn, licenceValid, overall, canAccessOpenLoads }` — checks TRN against the external registry and the trade licence format; caches a success so the carrier can access OpenLoads.

### `GET /api/verify/gate`
- **Auth:** `CARRIER`
- **200** `{ allowed, reason? }` or `{ allowed, verification }` — the server-side gate behind carrier bidding: already-verified carriers pass automatically; otherwise the carrier's on-file TRN is checked externally (an encrypted TRN on file that hasn't been separately verified via `POST /api/verify/check` reports `allowed: false`).

---

## 18. Cross-job message threads

Distinct from the job-scoped `GET`/`POST /api/jobs/:id/messages` in §4 — this is the account-wide inbox across every job the caller is a party to.

### `GET /api/messages/threads`
- **Auth:** session (not reachable by a `DRIVER` seat — one job, no cross-job history)
- **200** `{ threads: [{ id, jobId, jobCode, jobStatus, otherRole, lastMessage, unreadCount }] }` — every thread the caller is a party to, across all their jobs, newest-activity first.

### `POST /api/messages/threads/:id/read`
- **Auth:** session, thread participant
- **200** `{ ok: true }` — marks every message in the thread read for the caller. **403** not a participant. **404** unknown thread.

---

## 19. Profile documents (company registration docs)

### `POST /api/profile/documents/upload-url`
- **Auth:** `SHIPPER`\|`CARRIER`, seat `OPS`
- **Body:** `{ docType: "TRADE_LICENSE"|"INSURANCE", mimeType }`
- **200** a presigned S3 PUT URL, or `{ useBase64: true }`.

### `POST /api/profile/documents`
- **Auth:** `SHIPPER`\|`CARRIER`, seat `OPS`
- **Body:** `{ docType, mimeType, fileBase64|storageKey }`
- **200** `{ profile }` — uploading an `INSURANCE` doc also flips `profiles.insurance_uploaded=1`.

### `GET /api/profile/documents/:docType` · `GET /api/profile/documents/:docType/:userId`
- **Auth:** session — own document (no `:userId`), or any user's as admin (`:userId` form)
- **200** the file bytes. **403** not permitted. **404** no document uploaded.

### `GET /api/documents/my-jobs`
- **Auth:** `SHIPPER`\|`CARRIER`
- **200** `{ jobs: [{ id, jobCode, status, docCount }] }` — every job the caller is a party to that has **at least one** attached document (inner join — a full job list with a zero count isn't the point of this rollup).

---

## 20. Currency & per-job tax

### `GET /api/currency/rates`
- **Auth:** none
- **200** `{ table }` — the country → VAT-rate/currency table.

### `POST /api/jobs/:id/currency`
- **Auth:** `SHIPPER`, job owner, job `OPEN`\|`DRAFT`
- **Body:** `{ countryCode?, currency? }` (`countryCode` defaults to `AE`; `currency` derived from country if omitted)
- **200** `{ ok: true, currency, countryCode, tax }` — recomputes and stores the job's country/currency/VAT. **400** job not editable in this regard.

---

## 21. Stripe payments (Connect, checkout, webhooks)

Beyond the processor-agnostic `POST /api/jobs/:id/payment-checkout` and `POST /api/webhooks/payments` in §4 (`docs/PAYMENTS.md`), Stripe has its own dedicated routes:

### `POST /api/stripe/connect/onboard`
- **Auth:** `CARRIER`
- **200** `{ accountId, url, mock }` — provisions (or reuses) a Stripe Express Connect account and returns a hosted onboarding link. **502** Stripe error.

### `GET /api/stripe/connect/status`
- **Auth:** `CARRIER`
- **200** `{ accountId, charges_enabled, payouts_enabled, details_submitted, mock, onboarded }` (or `{ accountId: null, onboarded: false }` if never onboarded).

### `POST /api/jobs/:id/pay`
- **Auth:** `SHIPPER`, job owner, job `AWARDED`\|`PICKED_UP`\|`IN_TRANSIT`
- **200** `{ paymentIntent, amount, buffer, total }` — creates a Stripe PaymentIntent for the agreed price plus a 10% incidentals buffer held automatically.

### `POST /api/webhooks/stripe`
- **No auth** — Stripe's callback, raw body + `stripe-signature` verified; idempotent via `payment_webhook_events` (unique on provider + event id).
- On `payment_intent.succeeded`: escrow `HELD → HELD` confirmation path, updates the matching job/payout atomically and audits `ESCROW_HELD`. **200** `{ received: true }` always (Stripe must not retry on our application errors — malformed events just don't act).

### `POST /api/webhooks/stripe/mock-confirm`
- **Auth:** `ADMIN`, only when the active payment provider is in test/mock mode
- **Body:** `{ processorPaymentRef }`
- **200** `{ ok: true, escrow: "HELD", hash }` — manually simulates a successful Stripe payment for demos/tests without a real webhook. **403** outside test mode.

### `POST /api/jobs/:id/release-payout`
- **Auth:** `SHIPPER`\|`ADMIN`, job owner (shipper) or admin, job `DELIVERED`\|`COMPLETED`, escrow not `DISPUTED`
- **200** `{ ok: true, transfer, net, hash }` — executes the real Stripe transfer to the carrier's Connect account. Requires 2-of-3 HSM multi-signatures via the `x-hsm-sigs` header when HSM keys are configured. **403** missing/invalid multi-sig. **409** a release for this payout is already in progress.

---

## 22. Live location (GPS pings)

### `POST /api/jobs/:id/location`
- **Auth:** `CARRIER`, own job, job `IN_TRANSIT`
- **Body:** `{ lat, lng, speed?, heading? }`
- **200** `{ ok: true }` — the carrier posts a live GPS ping (client polls the browser Geolocation API every ~3 min while in transit). **400** invalid/missing `lat`/`lng`.

### `GET /api/jobs/:id/locations`
- **Auth:** session, job participant or admin
- **200** `{ locations: [...] }` — the job's last 100 GPS pings, newest first.

---

## 23. Auth: verification, password reset, data rights

### `GET /api/auth/verify-email`
- **Auth:** none
- **Query:** `?token=`
- **200** `{ ok: true }` — confirms the account's email. **400** invalid/expired token.

### `POST /api/auth/forgot-password`
- **Auth:** none (IP rate-limited)
- **Body:** `{ email }`
- **200** `{ ok: true, message }` — always the same generic response regardless of whether the email exists (no account-enumeration signal); a real account gets a 1-hour reset-link email.

### `POST /api/auth/reset-password`
- **Auth:** none
- **Body:** `{ token, password }`
- **200** `{ ok: true }` — sets the new password and invalidates every existing session for that user. **400** invalid/expired token or weak password.

### `GET /api/me/export`
- **Auth:** session
- **200** `{ user, jobs, bids, payouts, notifications, audit }` — full personal-data export (PDPL data-portability right); decrypts `trn_number`/`iban` in the response.

### `DELETE /api/me`
- **Auth:** session
- **200** `{ ok: true, message }` — self-service account deletion: anonymizes the user/profile row (email → `deleted-<id>@loadbyton.invalid`, PII cleared) rather than hard-deleting, so existing jobs/bids keep referential integrity; kills all sessions.

---

## 24. System: scheduling, admin bootstrap, key rotation

### `POST /api/system/publish-scheduled`
- **Auth:** `x-internal-key` header matching `INTERNAL_KEY`, or `ADMIN` session
- **200** `{ ok: true, published }` — forces a pass of the scheduled-job publisher (also runs automatically every 60s).

### `POST /api/system/setup-admin`
- **Auth:** `x-setup-key` header matching `ADMIN_SETUP_KEY`; only works while **no** admin account exists yet
- **Body:** `{ email, password, companyName? }`
- **201** `{ ok: true, message }` — provisions the platform's first admin account; permanently a no-op (403) once any admin exists.

### `POST /api/system/rotate-key`
- **Auth:** `ADMIN`
- **Body:** `{ keyId? }`
- **200** `{ ok: true, message }` — audits an encryption-key-rotation intent; the actual re-encryption of at-rest fields is a manual runbook step (`docs/operations-runbook.md`), not performed by this route.

---

## 25. Admin additions: live ops board, document visibility, reconciliation

### `GET /api/admin/live`
- **Auth:** `ADMIN`
- **200** `{ openJobs: [{ ...job, bids: [...] }], activeJobs: [...], recentActivity: [...] }` — a single real-time snapshot: every `OPEN` job with its live pending bids nested in, every `AWARDED`\|`PICKED_UP`\|`IN_TRANSIT` job (last 50), and the last 50 audit-log entries.

### `GET /api/admin/documents`
- **Auth:** `ADMIN`
- **200** `{ companies: [{ id, role, companyName, verified, tradeLicenseDocPresent, insuranceDocPresent }] }` — presence flags only; the actual files are served by the existing owner/admin-gated file routes, not a parallel path here.

### `GET /api/admin/documents/:userId`
- **Auth:** `ADMIN`
- **200** `{ company, drivers: [...], jobs: [...] }` — one company's full document picture: registration docs, every active driver's licence/vehicle doc presence (carriers only), and which jobs have attachments. **404** unknown/non-shipper-or-carrier user.

### `GET /api/admin/reconciliation`
- **Auth:** `ADMIN`
- **200** ledger reconciliation run result (envelope via `apiResponse.success`) — audited as `RECONCILIATION_RUN`.

---

## 26. Job extras: cross-party thread view

### `GET /api/jobs/:id/threads`
- **Auth:** session, job participant
- **200** `{ threads: [{ id, partyARole, partyBRole, otherRole, messages: [...] }], availableRecipientRoles }` — one entry per thread the caller is actually a party to on this job (multi-party: shipper/carrier/admin/driver), separate from the flat `GET /api/jobs/:id/messages` in §4, which stays unthreaded for `DISPUTED`-job correspondence.

---

## 27. Status codes cheat sheet

| Code | Meaning |
|---|---|
| 200/201 | OK / created |
| 400 | Missing/invalid fields |
| 401 | No/invalid session |
| 403 | Role not allowed, unverified carrier bidding, job not open, illegal state transition |
| 404 | Unknown job/bid/etc. |
| 409 | Double-award / already awarded |
| 422 | Invalid role value on register |
| 429 | Login throttled |

---

## 28. Demo API flow (quick curl)

```bash
BASE=http://localhost:4000/api

# 1. Login (sets lb_session cookie in cookie jar)
curl -c /tmp/jar -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"shipper@jebelalilogistics.ae","password":"demo1234"}'

# 2. List my jobs
curl -b /tmp/jar $BASE/jobs

# 3. Live tracking for an awarded job
curl -b /tmp/jar $BASE/jobs/2/track
```

See `TUTORIAL.md` for the full demo walkthrough.

---

## 29. Endpoints added beyond the original spec

Several routes exist beyond this document's original scope; the notable ones the
Industrial Trust redesign pass newly wired into the UI (they were built and
tested server-side but had no caller anywhere in the app before that):
`PATCH /api/jobs/:id/driver`,
`POST /api/admin/confirm-receipt`, `GET /api/admin/evidence/:jobId`, and
`GET /api/public/lanes`. (The rate estimator `POST /api/jobs/:id/rate` and
route optimizer `POST /api/jobs/:id/optimize-route` were removed entirely in
the same pass — the landing page replaced them with a live lane-index table.)

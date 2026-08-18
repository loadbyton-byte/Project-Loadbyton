# Loadbyton — API Reference

Base URL: **`http://localhost:4000/api`** (dev: proxied at `/api` on `:5173`).

- Auth: **cookie session**. Login once (`POST /api/auth/login`) — the `lb_session` HttpOnly cookie is sent automatically. No `Authorization` header. All fetches from the SPA use `credentials: 'include'`.
- Content type: `application/json`. Every JSON body is `express.json()` parsed.
- Errors: non-2xx responses carry `{ "error": "message" }`.
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
    "containerCount": 1, "truckCount": 1,
    "freeTimeDays": 5, "demurrageRateAed": 400,
    "templateId": null, "contractLaneId": null, "notes": "...",
    "pickupLat": 25.0092, "pickupLng": 55.0617, "pickupAddressDetail": "Jebel Ali Port Gate 4",
    "deliveryLat": 25.1288, "deliveryLng": 55.2115, "deliveryAddressDetail": "Al Quoz Industrial 3, Warehouse 12"
  }
  ```
  `equipmentType` defaults to `CONTAINER_CHASSIS` if omitted/invalid — one of the 13 values in `DATA_MODEL.md`'s `jobs.equipment_type` (incl. `CUSTOM`). `containerSize`/`containerType` are only validated (and required) when `equipmentType` is a container-carrying type (`CONTAINER_CHASSIS` or `TRAILER_WITH_GENSET`); for every other equipment type the server stores `'N/A'`/`'GENERAL'` regardless of what's sent, and `notes` becomes the required cargo description instead. `CUSTOM` requires `customRequirement` (or `notes`) — a written truck/requirement, merged into `notes` server-side. `targetPriceAed` maps to `max_budget_aed` (the legacy field name `maxBudgetAed` is still accepted). `containerCount`/`truckCount` default to `1` — raise either for a volume inquiry (one job, one award, covering the stated batch).
  `pickupLat`/`pickupLng`/`deliveryLat`/`deliveryLng` are an optional precise pin from the free OpenStreetMap+Nominatim picker (`web/src/components/LocationPicker.jsx`) on top of the required `pickupTerminal`/`deliveryArea` enums, which still drive lane rate lookups — **400** if only one of a lat/lng pair is sent, or the pair falls outside a loose UAE bounding box.
- **201** `{ job }` with generated `job_code` (e.g. `LBT-DXB-2608-4921`), status `OPEN`.

### `POST /api/jobs/import`
- **Auth:** `SHIPPER`
- **Body:** `{ jobs: [...] }` — array (max 200) of objects in the same shape as `POST /api/jobs`'s body. CSV parsing happens client-side (`web/src/lib/csv.js`); this route only ever sees JSON.
- **201** `{ results: [{ row, ok, jobCode?, jobId?, error? }], created, failed }` — each row is validated/inserted independently (same `createJobFromBody` logic as the single-job route), so one bad row doesn't sink the batch.

### `GET /api/jobs/:id`
- **Auth:** session (job participant, or admin; `OPEN` jobs visible to carriers)
- **200** `{ job }` — job plus `bids[]`, `documents[]`, `messages[]`, `payout`. For a non-awarded `OPEN` job, competitor bids are masked (no amounts) until award — contact gating.

### `POST /api/jobs/:id/bids`
- **Auth:** `CARRIER` **+ verified profile** + job `OPEN`
- **Body:** `{ amountAed, etaMinutes (1–600), truckType, notes }` — `truckType` is free text (stored as-is); the client UI offers the equipment values as a picklist defaulting to the job's own requirement, but the field isn't server-validated against that enum. Driver name/phone are **not** collected at bid time — they're only ever captured post-award via `PATCH /api/jobs/:id/driver` (contact-sharing follows the confirmed business relationship).
- **201** `{ bid }`
- **403** unverified carrier or job not open (`{ "error": "Carrier verification required to bid." }`).

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

## 7. Status codes cheat sheet

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

## 8. Demo API flow (quick curl)

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

## 9. Endpoints added beyond the original spec

Several routes exist beyond this document's original scope; the notable ones the
Industrial Trust redesign pass newly wired into the UI (they were built and
tested server-side but had no caller anywhere in the app before that):
`PATCH /api/jobs/:id/driver`,
`POST /api/admin/confirm-receipt`, `GET /api/admin/evidence/:jobId`, and
`GET /api/public/lanes`. (The rate estimator `POST /api/jobs/:id/rate` and
route optimizer `POST /api/jobs/:id/optimize-route` were removed entirely in
the same pass — the landing page replaced them with a live lane-index table.)

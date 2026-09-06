# Loadbyton — Data Model

Engine: **SQLite by default**, via Node's built-in `node:sqlite` (`DatabaseSync`, synchronous driver). File: `server/data/loadbyton.db` (env `DB_PATH` override). Pragmas: `journal_mode = WAL`, `foreign_keys = ON`. Setting `USE_POSTGRES=true` + a `postgres://` `DATABASE_URL` switches the whole app to an async `pg.Pool` instead — this is what production runs (Supabase-managed Postgres). See `docs/ARCHITECTURE.md` §1.1 for how the dual backend works.

Schema lives in **`server/schema.js`** (`module.exports = function initSchema(db) {...}`) — idempotent `CREATE TABLE IF NOT EXISTS` for the base tables, plus a long tail of `addColumn()` calls further down the same file that backfill columns added after the initial release (this doc's table descriptions below fold those in; don't assume a table's shape stops at its first `CREATE TABLE` block). `server/db.js` is just the connection/abstraction layer — it requires `./schema` to initialize a fresh SQLite file, but owns none of the DDL itself. `server/migrations/postgres_init.sql` is the hand-maintained parallel schema for the Postgres path, mirroring `schema.js` table-for-table. Seed data in `server/seed.js` (idempotent — skips if users already exist).

---

## Entity-relationship sketch

```
users 1─1 profiles
users 1─N sessions          (cookie sessions)
users 1─N notifications
users 1─N templates         (shipper)
users 1─N contract_lanes    (shipper)
users 1─N jobs   (shipper_id, carrier_id)
users 1─N drivers           (carrier's roster; drivers 0─1 seat_user_id → users)
jobs 1─N bids              (carrier; bids.eta_at is the current ETA field)
jobs 1─N job_documents     (uploader)
jobs 1─N messages          (sender)
jobs 1─N message_threads   (per job×role-pair thread; messages 0─1 thread_id)
jobs 1─N ratings           (rater → ratee)
jobs 1─1 payouts           (carrier)        — one per awarded job (unique on job_id)
jobs 1─N invoices          (via payouts)    — one per job (unique on job_id)
jobs 0─1 disputes          (opened_by, resolved_by)
jobs 1─N location_logs     (carrier GPS pings)
jobs 1─N telematics_logs   (device-fed telemetry; job_id optional)
jobs 1─N compliance_declarations
jobs 1─N debt_instruments  (invoice-financing tokens against a BL)
jobs 1─N fuel_advances
jobs 0─1 global_consignments (linked_job_id)
users 1─N contract_rfps    (shipper)
contract_rfps 1─N rfp_bids       (carrier)
contract_rfps 1─N rfp_milestones (0─1 invoice_id → invoices)
payouts 1─N payout_attempts      (one row per real transfer attempt)
ledger_transactions 1─N ledger_entries  (double-entry; account_code → ledger_accounts)
audit_log                  (append-only, hash-chained; references any entity loosely)
payment_webhook_events     (processor webhook idempotency ledger)
outbox_events              (reliable-delivery event log for async side effects)
idempotency_keys           (generic request idempotency cache)
settings                   (key/value platform knobs)
```

---

## Tables

### `users`
Identity + account attributes.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `email` | TEXT UNIQUE NOT NULL | login handle |
| `password_hash` | TEXT NOT NULL | bcrypt (bcryptjs, cost 10) |
| `role` | TEXT NOT NULL | `SHIPPER` \| `CARRIER` \| `ADMIN` \| `DRIVER`(unused) |
| `is_verified` | INTEGER | 0/1; carrier verification gate |
| `account_approval_status` | TEXT | `APPROVED` (default) \| `PENDING` \| `REJECTED` (migration-added) — new registrations start `PENDING` and are read-only until an admin approves them (`GET /api/admin/approvals`); seeded demo accounts are `APPROVED` |
| `account_approved_at` | TEXT | set when an admin approves (migration-added) |
| `mfa_enabled` | INTEGER | 0/1 |
| `mfa_secret` | TEXT | TOTP secret (migration-added column) |
| `tier` | TEXT NOT NULL | loyalty: `BRONZE` \| `SILVER` \| `GOLD` |
| `referral_code` | TEXT UNIQUE | shareable referral |
| `referred_by` | TEXT | code of the referrer |
| `org_owner_id` | INTEGER | FK → users (migration-added) — set when this row is a sub-**seat** under another account's org, rather than a standalone shipper/carrier |
| `seat_role` | TEXT | `OPS` \| `FINANCE` \| `VIEWER` \| `DRIVER` (migration-added; `server/lib/constants.js` `SEAT_ROLES`) — permission role for a seat login, resolved per-session via `resolveActingSeat()`; unrelated to the top-level `role` column above |
| `is_active` | INTEGER | 0/1, default 1 (migration-added) — deactivated accounts fail `auth()`'s user lookup |
| `display_name` | TEXT | (migration-added) — shown for a seat instead of the org owner's identity |
| `email_verified_at` | TEXT | (migration-added) |
| `email_verify_token_hash` / `email_verify_expires` | TEXT / TEXT | (migration-added) — hashed verification token, never stored raw |
| `password_reset_token_hash` / `password_reset_expires` | TEXT / TEXT | (migration-added) — same pattern for password reset |
| `notification_prefs_disabled` | TEXT | default `''` (migration-added) — comma-separated notification types this user opted out of |
| `is_demo` | INTEGER | 0/1, default 0 (migration-added) — flags investor-showcase/demo accounts so they can be filtered out of real analytics |
| `created_at` | TEXT | `datetime('now')` |

Session rows can also carry `impersonating_admin_id` and `acting_seat_id` (both migration-added on `sessions`) — the latter is how a seat login resolves to `req.user.actingSeatId`/`actingSeatRole` in `auth()`, and is what a `DRIVER` seat's route allowlist (`server/middleware/auth.js`) is keyed on.

### `profiles`
One per user (the `user.profile.*` nested object in the API).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER UNIQUE NOT NULL | FK → users, `ON DELETE CASCADE` |
| `company_name` | TEXT NOT NULL | |
| `trn_number` | TEXT | UAE TRN (tax registration) |
| `trade_license_number` | TEXT | |
| `phone` | TEXT | gated until award |
| `iban` | TEXT | payout destination; required at carrier verification |
| `coverage_zones` | TEXT | e.g. `JAFZA, Al Quoz, DIP` |
| `fleet_size` | INTEGER | default 0 |
| `owned_chassis` | INTEGER | G3: chassis capacity (owned vs hired) |
| `insurance_uploaded` | INTEGER | 0/1 (G5 verification factor) |
| `rating_avg` | REAL | default 5.0, recomputed on ratings |
| `completed_jobs` | INTEGER | default 0 |
| `verified_at` | TEXT | set on admin approval |
| `processor_account_id` | TEXT | (migration-added) — Stripe Connect account id for a carrier, provisioned via `POST /api/stripe/connect/onboard`; the transfer destination `executePayout()` uses in stripe mode |
| `trade_license_doc_storage_path` / `trade_license_doc_mime_type` | TEXT / TEXT | (migration-added) — the actual uploaded trade licence file (see `server/lib/storage.js`), backing what `trade_license_number` used to be a bare unverified string |
| `insurance_doc_storage_path` / `insurance_doc_mime_type` | TEXT / TEXT | (migration-added) — the actual uploaded insurance document; `insurance_uploaded` above was previously just a self-reported boolean with no file behind it |

### `jobs`
The core entity.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_code` | TEXT UNIQUE NOT NULL | human-readable, e.g. `LBT-DXB-2608-4921` |
| `shipper_id` | INTEGER NOT NULL | FK → users |
| `carrier_id` | INTEGER | FK → users (set on award) |
| `contract_lane_id` | INTEGER | G6 link to a committed lane |
| `template_id` | INTEGER | recurrence source |
| `container_size` | TEXT NOT NULL | `20FT` \| `40FT` \| `40HC` \| `REEFER` |
| `container_type` | TEXT NOT NULL | `DRY` \| `REEFER` \| `HAZMAT` \| `OPEN_TOP` \| `FLAT_RACK` |
| `container_number` | TEXT | e.g. `MSKU9281745` |
| `pickup_terminal` | TEXT NOT NULL | e.g. `JEBEL_ALI_T2` |
| `delivery_area` | TEXT NOT NULL | e.g. `JAFZA_SOUTH` |
| `delivery_address` | TEXT NOT NULL | |
| `pickup_lat` / `pickup_lng` / `pickup_address_detail` | REAL / REAL / TEXT | Optional precise coordinates (the UI no longer offers a map picker — programmatic callers only), on top of `pickup_terminal` (which still drives lane rate lookups) |
| `delivery_lat` / `delivery_lng` / `delivery_address_detail` | REAL / REAL / TEXT | Same, for the delivery point, on top of `delivery_address` |
| `cargo_weight_tons` | REAL | Optional gross cargo weight in metric tons (positive, ≤ 500) — sent/edited as `cargoWeightTons` |
| `ready_at` | TEXT NOT NULL | ready-for-pickup time |
| `deadline` | TEXT NOT NULL | |
| `max_budget_aed` | REAL | shipper ceiling — exposed in the API/UI as `targetPriceAed` (per-trip target price) |
| `agreed_price_aed` | REAL | winning bid amount, set at award |
| `status` | TEXT NOT NULL | `DRAFT`\|`OPEN`\|`AWARDED`\|`PICKED_UP`\|`IN_TRANSIT`\|`DELIVERED`\|`COMPLETED`\|`CANCELLED`\|`DISPUTED` |
| `awarded_bid_id` | INTEGER | single-writer award reference |
| `assigned_driver_name` / `assigned_driver_phone` | TEXT / TEXT | set post-award via `PATCH /api/jobs/:id/driver` (the only driver-capture path); required before `PICKED_UP` |
| `assigned_driver_id` | INTEGER | FK → `drivers` (migration-added) — links to a roster row when the carrier picks a registered driver instead of (or alongside) typing a name/phone freehand |
| `notes` | TEXT | |
| `escrow_status` | TEXT | `PENDING`\|`HELD`\|`FUNDED`\|`RELEASED`\|`DISPUTED` |
| `delivered_at` | TEXT | set by POD; starts auto-release window |
| `auto_release_processed` | INTEGER | default 0 (migration-added) — present but **not read by the current auto-release sweep** (`server/services/escrow.service.js` matches on `delivered_at` age instead); effectively vestigial today |
| `payout_released_at` | TEXT | |
| `container_count` | INTEGER | default 1 (migration-added) — "no. of containers" for a volume inquiry |
| `truck_count` | INTEGER | default 1 (migration-added) — "no. of trucks" for a volume inquiry |
| `equipment_type` | TEXT | default `CONTAINER_CHASSIS` (migration-added) — one of `CONTAINER_CHASSIS`, `TRAILER_WITH_GENSET`, `LOWBED_TRAILER`, `FLATBED_TRAILER`, `BOX_TRUCK`, `CURTAIN_TRUCK`, `PICKUP_3T`, `PICKUP_5T`, `PICKUP_7T`, `PICKUP_10T`, `SIDE_LOADER_TRAILER`, `TRIPPER`, `CUSTOM`. (`REEFER_TRUCK` was replaced by `TRAILER_WITH_GENSET`; unknown values fall back to `CONTAINER_CHASSIS`.) `container_size`/`container_type` only apply when this is `CONTAINER_CHASSIS` or `TRAILER_WITH_GENSET` — otherwise the server sets them to `'N/A'`/`'GENERAL'` and the cargo is described in `notes` instead. `CUSTOM` additionally requires a written requirement (`customRequirement`, merged into `notes`). |
| `cargo_type` | TEXT | default `'GENERAL_GOODS'` (migration-added) — one of `GENERAL_GOODS`, `ELECTRONICS`, `FOODSTUFF_PERISHABLES`, `MACHINERY_EQUIPMENT`, `CHEMICALS_HAZMAT`, `TEXTILES_GARMENTS`, `AUTOMOTIVE_PARTS`, `CONSTRUCTION_MATERIALS`, `FURNITURE_FIXTURES`, `OTHER` (`server/lib/constants.js` `CARGO_TYPES`). Note: there is no boolean `requires_reefer`/`requires_hazmat` column in the current schema — reefer/hazmat cargo is expressed via `container_type`/`cargo_type` instead. |
| `shipment_type` | TEXT | default `'IMPORT'` (migration-added) — `IMPORT`\|`EXPORT`\|`LOCAL`; drives which of the leg-specific location columns below apply |
| `loading_location` / `delivery_location` | TEXT / TEXT | (migration-added) — used for `LOCAL` shipments, where they stand in for `pickup_terminal`/`delivery_area` |
| `import_pickup_terminal` / `import_unloading_location` / `import_empty_return_location` | TEXT | (migration-added) — the three-leg IMPORT flow: terminal pickup → unloading → empty container return |
| `export_empty_pickup_location` / `export_loading_location` / `export_deposit_terminal` | TEXT | (migration-added) — the mirror three-leg flow for EXPORT |
| `leg_extra_lat` / `leg_extra_lng` | REAL | (migration-added) — coordinates for whichever intermediate leg location applies |
| `scheduled_post_at` | TEXT | (migration-added) — future publish time; a job created with this in the future starts life as `DRAFT` and is flipped to `OPEN` by the scheduled-post publisher (see `docs/ARCHITECTURE.md` §3.8) |
| `currency` | TEXT | default `'AED'` (migration-added) |
| `country_code` | TEXT | default `'AE'` (migration-added) |
| `tax_rate_bps` | INTEGER | default 500 (migration-added) — 5% VAT in basis points |
| `tax_amount` | REAL | (migration-added) |
| `dp_world_e_token` | TEXT | (migration-added) — DP World terminal e-token for gate access |
| `eir_photos` | TEXT | (migration-added) — JSON array of stored Equipment Interchange Receipt photo keys |
| `detention_free_days` | INTEGER | default 5 (migration-added) — the current demurrage/detention free-time clock (replaces the older, now-nonexistent `free_time_days` column some code still defensively falls back to) |
| `incidentals_buffer_aed` | REAL | (migration-added) — a 10% buffer charged on top of `agreed_price_aed` at checkout (`POST /api/jobs/:id/pay`), held until release |
| `buffer_released` | INTEGER | default 0 (migration-added) — flips to 1 once the buffer has been included in a payout release, so it's never paid out twice |
| `ledger_hash` / `prev_ledger_hash` | TEXT / TEXT | (migration-added) — the job's own link in the hash-chained payment ledger (`sha256(prevHash|jobId|action|amount|timestamp)`, written on HELD/RELEASED transitions in `server/routes/stripe.routes.js`); see also `audit_log.hash` below |
| `processor_payment_ref` / `processor_tranref` | TEXT / TEXT | (migration-added) — our lookup key and the processor's own transaction reference for the escrow charge |
| `processor_payment_status` | TEXT | default `'PENDING'` (migration-added) — `PENDING`\|`REQUIRES_PAYMENT`\|`PAID`\|`FAILED`\|`REFUNDED` |
| `processor_amount_aed` | REAL | (migration-added) — amount actually charged (may include the incidentals buffer) |
| `processor_last_error` | TEXT | (migration-added) |
| `is_demo` | INTEGER | default 0 (migration-added) — flags investor-showcase jobs so they stay partitioned from real carrier/shipper traffic |
| `created_at` / `updated_at` | TEXT | |

### `bids`
Carrier offers on a job.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, `ON DELETE CASCADE` |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `amount_aed` | REAL NOT NULL | |
| `eta_minutes` | INTEGER NOT NULL default 0 | **Legacy.** Still written on every insert (derived as `round((etaAt - now) / 60000)`, clamped ≥ 0) for backward compatibility, but the carrier-facing bid form and validation now work in `eta_at`; treat `eta_minutes` as a computed echo of it, not the source of truth. |
| `eta_at` | TEXT | (migration-added) — the actual ETA the route validates: a real date/time, no more than 1h in the past or 90 days out. This is the current field; `POST /api/jobs/:id/bids` takes `etaAt` in the request body. |
| `truck_type` | TEXT | free text |
| `driver_name` | TEXT | always NULL in current flow — driver details are captured post-award via `PATCH /api/jobs/:id/driver` (which stores them on the job row), never at bid time |
| `driver_phone` | TEXT | (migration-added) always NULL — same as above |
| `notes` | TEXT | |
| `status` | TEXT NOT NULL | `PENDING`\|`ACCEPTED`\|`REJECTED`\|`EXPIRED` |
| `created_at` / `updated_at` | TEXT | |

A unique index (`idx_bids_one_pending_per_carrier`) enforces at most one `PENDING` bid per `(job_id, carrier_id)` — a carrier must withdraw before re-bidding.

### `job_documents`
The persistent per-job document/customs thread.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, CASCADE |
| `uploader_id` | INTEGER NOT NULL | FK → users |
| `doc_type` | TEXT NOT NULL | `CUSTOMS`\|`RECEIPT`\|`POD`\|`LICENCE`\|`INSURANCE`\|`OTHER` |
| `title` | TEXT NOT NULL | |
| `file_url` | TEXT NOT NULL | External URL (legacy/manual entry), or the local `storage_path` when uploaded through the app |
| `storage_path` | TEXT | Set when the file was uploaded via `POST /api/jobs/:id/documents` or `/pod` (base64 body, decoded to `UPLOADS_DIR/<jobId>/<uuid>.<ext>`); NULL for a manually-entered external link |
| `mime_type` | TEXT | Set alongside `storage_path`; one of the `ALLOWED_UPLOAD_MIME_TYPES` in `server/lib/storage.js` |
| `created_at` | TEXT | |

Uploaded files are served back through `GET /api/jobs/:id/documents/:docId/file`, which
re-checks `isParticipantOrBidder` on every read — the same access rule every other
job-scoped route uses — so a document is never reachable by a bare guessable URL.

### `messages`
Per-job chat (contact gating lives in the API — PII stays hidden until award).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, CASCADE |
| `sender_id` | INTEGER NOT NULL | FK → users |
| `content` | TEXT NOT NULL | |
| `is_read` | INTEGER | 0/1 |
| `created_at` | TEXT | |

### `ratings`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, CASCADE |
| `rater_id` | INTEGER NOT NULL | FK → users |
| `ratee_id` | INTEGER NOT NULL | FK → users |
| `score` | INTEGER NOT NULL | 1–5 |
| `comment` | TEXT | |
| `created_at` | TEXT | |

### `templates`
Recurring lanes for shippers (retention).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `shipper_id` | INTEGER NOT NULL | FK → users |
| `name` | TEXT NOT NULL | |
| `pickup_terminal` / `delivery_area` / `delivery_address` | TEXT NOT NULL | |
| `container_size` | TEXT NOT NULL | |
| `container_type` | TEXT | default `DRY` |
| `cadence` | TEXT | `ONCE`\|`WEEKLY`\|`BIWEEKLY`\|`MONTHLY` |
| `notes` | TEXT | |
| `created_at` | TEXT | |

### `contract_lanes`
Committed monthly volume (G6).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `shipper_id` | INTEGER NOT NULL | FK → users |
| `pickup_terminal` / `delivery_area` / `delivery_address` | TEXT NOT NULL | |
| `monthly_loads` | INTEGER NOT NULL | committed volume |
| `target_price_aed` | REAL | |
| `status` | TEXT | `ACTIVE`\|`PAUSED` |
| `created_at` | TEXT | |

### `payouts`
One row per awarded job; the carrier ledger.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `gross_aed` | REAL NOT NULL | agreed price |
| `platform_fee_aed` | REAL NOT NULL | commission bps applied |
| `net_aed` | REAL NOT NULL | gross − fee |
| `status` | TEXT | `PENDING`\|`RELEASED`\|`HELD`\|`CANCELLED` |
| `release_type` | TEXT | `MANUAL` (shipper/admin confirms) \|`AUTO` (the auto-release sweep) \|`DISPUTE_RESOLUTION` (migration-added) |
| `released_at` | TEXT | |
| `sla_deadline` | TEXT | (migration-added) — set to `released_at + 48h` whenever a payout is marked `RELEASED`; what `GET /api/admin/payouts-sla` tracks against |
| `transfer_executed_at` / `transfer_reference` | TEXT / TEXT | (migration-added) — when/what the real-world transfer was, for providers/flows where the transfer isn't itself a Stripe Connect call |
| `processor_payout_status` | TEXT | default `'PENDING'` (migration-added) — processor-side payout status (e.g. `SENT`) once a real transfer is attempted |
| `processor_payout_ref` | TEXT | (migration-added) — the processor's transfer id |
| `idempotency_key` | TEXT | (migration-added) — a deterministic per-payout key preventing duplicate external transfers; unique-indexed (`idx_payouts_idempotency_key`) where not null |
| `created_at` | TEXT | |

A unique index (`idx_payouts_job_unique`) enforces exactly one payout row per `job_id`. Each real transfer *attempt* against a payout is separately recorded in `payout_attempts` (below) — `payouts` holds the current state, `payout_attempts` holds the history.

### `disputes`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs |
| `opened_by` | INTEGER NOT NULL | FK → users (admin) |
| `reason` | TEXT NOT NULL | |
| `status` | TEXT | `OPEN`\|`UNDER_REVIEW`\|`RESOLVED` |
| `determination` | TEXT | admin finding |
| `decision` | TEXT | `RELEASE_TO_CARRIER`\|`REFUND_SHIPPER`\|`SPLIT` |
| `resolved_by` | INTEGER | FK → users |
| `resolved_at` | TEXT | |
| `created_at` | TEXT | |

### `audit_log`
**Append-only.** Database triggers (`audit_log_no_update`, `audit_log_no_delete`) `RAISE(ABORT)` on any `UPDATE`/`DELETE` — the table can only ever grow.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER | who acted |
| `action` | TEXT NOT NULL | e.g. `AWARD`, `STATUS`, `ESCROW_RELEASE`, `VERIFY`… |
| `details` | TEXT | human-readable |
| `entity_type` | TEXT | `job`\|`user`\|`dispute`\|`payout` (migration-added) |
| `entity_id` | INTEGER | (migration-added) |
| `before_state` / `after_state` | TEXT | state-transition trace (migration-added) |
| `request_id` | TEXT | `x-request-id` for cross-write traceability (migration-added) |
| `prev_hash` / `hash` | TEXT / TEXT | (migration-added) — **hash chain on top of the append-only triggers.** `hash = sha256(prevHash|action|entity_type|entity_id|created_at)`, `prev_hash` is the previous row's `hash` (or the literal string `GENESIS` for the first row). This makes the log not just un-editable but *tamper-evident*: rewriting any historical row (even via a direct DB edit that bypasses the triggers) breaks the chain from that point forward. Exposed via `GET /api/audit/chain` (last 100 entries, admin-only) and `GET /api/audit/chain/verify` (admin-only — recomputes the chain from row 1 and reports `{ ok, brokenAt, length, head }`), both in `server/routes/audit.routes.js`. |
| `created_at` | TEXT | |

### `sessions`
One row per active login; the cookie holds the token. No JWTs.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `session_token` | TEXT UNIQUE NOT NULL | random opaque token |
| `user_id` | INTEGER NOT NULL | FK → users, `ON DELETE CASCADE` |
| `impersonating_admin_id` | INTEGER | (migration-added) — set when an admin is impersonating this user's session |
| `acting_seat_id` | INTEGER | FK → users (migration-added) — set when the session is logged in *as* an org seat (see `users.seat_role`); `auth()` resolves this into `req.user.actingSeatId`/`actingSeatRole` on every request |
| `created_at` | TEXT | |
| `expires_at` | TEXT NOT NULL | 7 days |

Indexes: `idx_sessions_token`, `idx_sessions_user`. Expired sessions are purged on server startup.

### `notifications`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL | FK → users |
| `title` | TEXT NOT NULL | |
| `body` | TEXT | |
| `job_id` | INTEGER | optional link |
| `is_read` | INTEGER | 0/1 |
| `type` | TEXT | default `'system'` (migration-added) — category used for per-user notification muting via `users.notification_prefs_disabled` |
| `created_at` | TEXT | |

### `invoices`
VAT invoice generated per released payout.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `invoice_number` | TEXT UNIQUE NOT NULL | |
| `payout_id` | INTEGER NOT NULL | FK → payouts |
| `job_id` | INTEGER NOT NULL | FK → jobs, unique-indexed — one invoice per job |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `supplier_trn` / `customer_trn` | TEXT / TEXT | UAE TRNs of carrier and shipper at issue time |
| `gross_aed` | REAL NOT NULL | |
| `commission_aed` | REAL NOT NULL | platform fee portion |
| `vat_rate_bps` | INTEGER NOT NULL | VAT rate applied, in basis points |
| `taxable_aed` | REAL NOT NULL | |
| `vat_aed` | REAL NOT NULL | |
| `total_aed` | REAL NOT NULL | |
| `issued_at` | TEXT | |

### `drivers`
A carrier's registered driver roster — added once per driver, then picked from (not retyped) when assigning to a job.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `carrier_id` | INTEGER NOT NULL | FK → users, `ON DELETE CASCADE` |
| `name` | TEXT NOT NULL | |
| `phone` | TEXT NOT NULL | |
| `license_number` / `license_expiry` | TEXT / TEXT | |
| `license_doc_storage_path` / `license_doc_mime_type` | TEXT / TEXT | uploaded licence document (`server/lib/storage.js`) |
| `vehicle_doc_storage_path` / `vehicle_doc_mime_type` | TEXT / TEXT | uploaded vehicle document |
| `seat_user_id` | INTEGER | FK → users (migration-added) — links this roster row to the driver's own login identity, a `DRIVER` seat under the carrier's account provisioned via `POST /api/fleet/:id/seat` |
| `is_active` | INTEGER | 0/1, default 1 |
| `created_at` / `updated_at` | TEXT | |

`jobs.assigned_driver_id` points here once a carrier assigns a roster driver to a job.

### `message_threads`
One row per `(job, role-pair)` that has ever exchanged a message — created on demand, not pre-created for every job (most jobs never talk to admin).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, CASCADE |
| `party_a_role` / `party_b_role` | TEXT NOT NULL / TEXT NOT NULL | Always stored in canonical order (`server/lib/messaging.js`'s `ROLE_ORDER`) so `SHIPPER+ADMIN` and `ADMIN+SHIPPER` can never become two different rows for the same thread |
| `created_at` | TEXT | |

Unique on `(job_id, party_a_role, party_b_role)`. `messages.thread_id` (migration-added FK) links individual messages back to their thread.

### `location_logs`
Carrier-reported GPS pings for a job in transit.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs, CASCADE |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `lat` / `lng` | REAL NOT NULL / REAL NOT NULL | |
| `speed` / `heading` | REAL / REAL | |
| `recorded_at` | TEXT | |

### `telematics_logs`
Device-fed telemetry (a lower-level, higher-volume feed than `location_logs`), from `server/routes/telematics.routes.js`.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER | FK → jobs, CASCADE — optional, a device can report before/without a linked job |
| `device_id` | TEXT NOT NULL | |
| `lat` / `lng` | REAL NOT NULL / REAL NOT NULL | |
| `speed` / `temperature` / `fuel_level` | REAL / REAL / REAL | temperature matters for reefer loads |
| `raw_payload` | TEXT | the raw device payload, kept for replay/debugging |
| `recorded_at` | TEXT | |

### `global_consignments`
Cross-border/multi-mode consignments ingested from an external source (EDI or similar) and optionally linked to a local job.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | external id, not autoincrement |
| `source` | TEXT NOT NULL | origin system |
| `mode` | TEXT NOT NULL | transport mode |
| `status` | TEXT | default `'CREATED'` |
| `origin` / `destination` | TEXT NOT NULL | |
| `payload` | TEXT NOT NULL | raw ingested payload (JSON) |
| `linked_job_id` | INTEGER | FK → jobs, optional |
| `updated_at` | TEXT | |

### `compliance_declarations`
Customs/HS-code declarations per job (`server/routes/compliance.routes.js`).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs |
| `hs_code` | TEXT NOT NULL | |
| `manifest_hash` | TEXT NOT NULL | integrity hash of the declared manifest |
| `zk_proof` | TEXT | optional zero-knowledge proof artifact |
| `status` | TEXT | default `'PENDING'` |
| `cleared_at` | TEXT | |
| `created_at` | TEXT | |

### `debt_instruments`
Invoice-financing tokens issued against a job's bill of lading (a receivables-financing feature).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs |
| `bl_number` | TEXT NOT NULL | bill-of-lading number |
| `face_value_aed` | REAL NOT NULL | |
| `interest_rate_bps` | INTEGER NOT NULL | |
| `risk_score` | REAL NOT NULL | |
| `token_id` | TEXT UNIQUE NOT NULL | |
| `status` | TEXT | default `'ACTIVE'` |
| `created_at` | TEXT | |

### `contract_rfps`, `rfp_bids`, `rfp_milestones`
A heavier-weight alternative to `contract_lanes` for shippers who want a formal RFP with milestone-based invoicing (`server/routes/rfp.routes.js`).

**`contract_rfps`** — the RFP itself:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `shipper_id` | INTEGER NOT NULL | FK → users |
| `title` / `description` | TEXT NOT NULL / TEXT | |
| `origin` / `destination` | TEXT NOT NULL | |
| `total_containers` | INTEGER NOT NULL | |
| `duration_months` | INTEGER NOT NULL | |
| `budget_aed` | REAL NOT NULL | |
| `status` | TEXT | default `'OPEN'` |
| `awarded_carrier_id` | INTEGER | FK → users |
| `is_demo` | INTEGER | 0/1, default 0 (migration-added) |
| `created_at` | TEXT | |

**`rfp_bids`** — a carrier's proposal against an RFP:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `rfp_id` | INTEGER NOT NULL | FK → contract_rfps, CASCADE |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `amount_aed` | REAL NOT NULL | |
| `eta_days` | INTEGER NOT NULL | |
| `proposal` | TEXT | free-text proposal |
| `status` | TEXT | default `'PENDING'` |
| `created_at` | TEXT | |

**`rfp_milestones`** — billing milestones on an awarded RFP:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `rfp_id` | INTEGER NOT NULL | FK → contract_rfps, CASCADE |
| `title` | TEXT NOT NULL | |
| `due_at` | TEXT NOT NULL | |
| `amount_aed` | REAL NOT NULL | |
| `status` | TEXT | default `'PENDING'` |
| `invoice_id` | INTEGER | FK → invoices, once billed |

### `fuel_advances`
Fuel/Salik (toll) cash advances to a carrier against an active job.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER NOT NULL | FK → jobs |
| `carrier_id` | INTEGER NOT NULL | FK → users |
| `amount_aed` | REAL NOT NULL | |
| `type` | TEXT NOT NULL | `FUEL` \| `SALIK` |
| `status` | TEXT | default `'APPROVED'` |
| `created_at` | TEXT | |

### Financial core v2: `ledger_accounts`, `ledger_transactions`, `ledger_entries`
A double-entry ledger layered on top of the simpler `payouts` bookkeeping, for auditable financial reporting.

**`ledger_accounts`** — the chart of accounts, seeded on boot (`processor_clearing`, `escrow_liability`, `carrier_payable`, `platform_revenue`, `refund_liability`):

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `code` | TEXT UNIQUE NOT NULL | e.g. `escrow_liability` |
| `name` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `ASSET`\|`LIABILITY`\|`REVENUE`\|`EXPENSE` |
| `created_at` | TEXT | |

**`ledger_transactions`** — one per financial event, idempotency-keyed:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `idempotency_key` | TEXT UNIQUE NOT NULL | |
| `job_id` / `payout_id` | INTEGER / INTEGER | FK → jobs / payouts, both optional |
| `description` | TEXT | |
| `created_at` | TEXT | |

**`ledger_entries`** — the debit/credit lines of a transaction (must balance per transaction, enforced in application code, not a DB constraint):

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `transaction_id` | INTEGER NOT NULL | FK → ledger_transactions, CASCADE |
| `account_code` | TEXT NOT NULL | FK → ledger_accounts(code) |
| `amount_minor` | INTEGER NOT NULL | > 0, in minor currency units (fils) |
| `currency` | TEXT | default `'AED'` |
| `side` | TEXT NOT NULL | `DEBIT`\|`CREDIT` |
| `created_at` | TEXT | |

### `payment_webhook_events`
Durable idempotency ledger for processor webhooks — every inbound webhook (mock/Telr/Stripe) is inserted here first; a `UNIQUE(provider, provider_event_id)` violation is how a replayed delivery is detected and short-circuited before any state change.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `provider` | TEXT NOT NULL | `mock`\|`telr`\|`stripe` |
| `provider_event_id` | TEXT UNIQUE NOT NULL | the processor's own event id (or a payload hash fallback) |
| `event_type` | TEXT NOT NULL | |
| `payload_hash` | TEXT | |
| `raw_payload` | TEXT | truncated raw body, for debugging |
| `status` | TEXT | default `'PENDING'` → `'PROCESSED'` |
| `attempt_count` | INTEGER | default 0 |
| `error` | TEXT | |
| `received_at` / `processed_at` | TEXT / TEXT | |

### `payout_attempts`
One row per real transfer attempt against a payout — the history `payouts` itself doesn't keep.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `payout_id` | INTEGER NOT NULL | FK → payouts, CASCADE |
| `attempt_number` | INTEGER NOT NULL | 1, 2, 3… per payout |
| `provider` | TEXT NOT NULL | e.g. `stripe-manual` |
| `amount_aed` | REAL NOT NULL | |
| `destination` | TEXT | processor account id / IBAN |
| `idempotency_key` | TEXT UNIQUE NOT NULL | e.g. `manual-release-<payoutId>-attempt<N>` — the actual concurrency-safety boundary on `POST /api/jobs/:id/release-payout` (see `docs/ARCHITECTURE.md` §3.7) |
| `status` | TEXT NOT NULL | `SUBMITTED`\|`SETTLED`\|`FAILED` |
| `provider_response` / `error` | TEXT / TEXT | |
| `created_at` | TEXT | |

### `outbox_events`
Transactional outbox for reliable delivery of post-transaction side effects (notifications, ledger fanout) — written in the same DB transaction as the state change, then drained asynchronously by `server/workers/outbox.worker.js` so a crash between "state changed" and "side effect fired" can't lose the side effect.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `aggregate_type` / `aggregate_id` | TEXT NOT NULL / INTEGER NOT NULL | what this event is about, e.g. `job` / 42 |
| `event_type` | TEXT NOT NULL | |
| `payload` | TEXT NOT NULL | JSON |
| `status` | TEXT | default `'PENDING'` → processed |
| `created_at` / `processed_at` | TEXT / TEXT | |

Indexed on `status` for the worker's poll query.

### `idempotency_keys`
Generic request-idempotency cache — a client-supplied idempotency key on a write endpoint (see the `idempotency` middleware used on bid/POD creation) is looked up here first; a hit replays the original `response_status`/`response_body` instead of re-executing the write.

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | client-supplied idempotency key |
| `user_id` | INTEGER NOT NULL | |
| `response_status` | INTEGER NOT NULL | |
| `response_body` | TEXT NOT NULL | |
| `created_at` | TEXT | |

### `settings`
Key/value platform knobs (P1). Seeded:

| Key | Default | Meaning |
|---|---|---|
| `commission_rate_bps` | `600` | platform fee in basis points (6%) |
| `auto_release_hours` | `24` | silent-assent window after POD |

Both editable by admin (`PATCH /api/admin/settings`); `commission_rate_bps` is clamped 0–10000, `auto_release_hours` 1–168.

---

## Migrations strategy

**`server/schema.js`** (not `server/db.js` — that's just the connection layer that calls it) runs `CREATE TABLE IF NOT EXISTS …` for the base schema, then uses a small `addColumn()` helper (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`, run unconditionally and idempotently on every boot) to backfill dozens of columns added after the initial release. This doc's table descriptions above already fold every `addColumn()` call in, but a non-exhaustive sample of what that migration tail looks like:

- `users.mfa_secret`, `users.org_owner_id`/`seat_role`/`is_active`/`display_name`, `users.email_verify_*`/`password_reset_*`, `users.account_approval_status`/`account_approved_at`, `users.is_demo`
- `jobs.delivered_at`, `auto_release_processed`, `container_count`/`truck_count`/`equipment_type`/`cargo_type`, `shipment_type` + the import/export leg columns, `currency`/`tax_rate_bps`/`tax_amount`, `ledger_hash`/`prev_ledger_hash`, `processor_payment_*`, `is_demo`
- `bids.eta_at`, `bids.driver_phone`
- `payouts.release_type`, `sla_deadline`, `transfer_executed_at`/`transfer_reference`, `processor_payout_*`, `idempotency_key`
- `profiles.processor_account_id`, the trade-licence/insurance document path columns
- `audit_log.entity_type/entity_id/before_state/after_state/request_id`, `audit_log.prev_hash`/`hash` (the tamper-evident chain)
- `drivers.seat_user_id`
- `notifications.type`

The whole enterprise/financial-core table set (`location_logs` through `idempotency_keys` above) is created via one further `CREATE TABLE IF NOT EXISTS` block later in the same file, plus a handful of `addColumn()` calls after it (e.g. `contract_rfps.is_demo`) — same idempotent pattern, just added later chronologically.

`server/migrations/postgres_init.sql` is the equivalent DDL for the Postgres backend, run once (checked via the presence of the `outbox_events` table) when `USE_POSTGRES=true`; it mirrors `schema.js`'s end state directly rather than replaying the same incremental `ALTER TABLE` history, so the two files must be kept in sync by hand whenever a column is added to one.

Because the SQLite driver is synchronous and startup is the single writer, `schema.js`'s migrations are safe to run on every boot; the Postgres path guards concurrent requests during migration with a promise every `db.prepare()`/`db.query()` call awaits first.

---

## Seed data (`server/seed.js`)

Idempotent: skips when `users` is non-empty. One bcrypt hash (`demo1234`) reused for all accounts.

| Entity | Contents |
|---|---|
| Users | 1 shipper (Al-Majid, SILVER), 3 verified carriers (Emirates/Gold, Falcon/Silver, Gulf Heavy/Gold), 1 **unverified** carrier (Desert Line/Bronze — cannot bid), 1 admin |
| Jobs | 6 jobs spanning the lifecycle: 2 `OPEN` (one 40HC dry, one 40FT hazmat), 1 `PICKED_UP`, 1 `IN_TRANSIT` (reefer), 1 `DELIVERED`, 1 `COMPLETED`; escrow from `PENDING` to `RELEASED`; payouts released for two, pending for two |
| Bids | 7 bids incl. an `ACCEPTED` bid on the in-transit reefer |
| Docs | customs + receipt on an open job, a `POD` on the delivered job |
| Messages | a realistic gate-pass thread on the 40HC job |
| Ratings | 2 ratings on the completed job; rating aggregates seeded directly on `profiles` |
| Templates | "Weekly JAFZA South run", "Monthly reefer to Al Quoz" |
| Contract lanes | JAFZA South (40/month), Al Quoz (20/month) |
| Payouts | 4 — 2 `RELEASED`, 2 `PENDING` |

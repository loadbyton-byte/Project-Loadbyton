# TODOs.md — Loadbyton

Deferred / tracked follow-up work.

## ✅ Resolved — 2026-08-14 corporate-readiness pass

TODO-1 through TODO-4 below are closed as of this date (see git log for the
commits). Kept in place, struck through in spirit, for the historical
context on *why* each one mattered — the "why" sections below are still
accurate background even though the "what" is now shipped.

- **TODO-1** — `server/test/` (harness.js + core-loop.test.js + others),
  isolated temp-DB-per-run, `npm test`, gated in CI (`.github/workflows/ci.yml`).
- **TODO-2** — `bids.driver_phone` + `jobs.assigned_driver_name/_phone`,
  bound at award, reassignment is its own audited action
  (`PATCH /api/jobs/:id/driver`).
- **TODO-3** — `payouts.sla_deadline` + `transfer_executed_at`, admin view
  at `GET /api/admin/payouts-sla`, confirm via
  `POST /api/admin/payouts/:id/mark-transferred`.
- **TODO-4** — still genuinely not startable by code (Meta/Twilio provider
  signup is an external, non-technical track). Left open below.

Also shipped in the same pass, not originally tracked here: general API
rate limiting (previously login-only), AES-256-GCM field encryption for
IBAN/TRN, VAT invoice generation on payout release, multi-seat company
accounts, and initial Arabic/RTL infrastructure (see `CLAUDE.md`'s "Known
rough edges" for what that last one does and doesn't cover).

## TODO-1: Test-DB harness (isolated, fresh-seed-per-run)

- **What:** Build an isolated test-DB harness (temp DB per run, fresh seed, npm test) so the
  suite can gate SQLite AND a future Postgres port without direct DB pokes.
- **Why:** There is no automated test suite yet — verification today is manual (curl walks
  and the `TUTORIAL.md` flow). A harness that boots a temp SQLite file, runs `seed.js`
  against it, and tears down after each run is the prerequisite for CI.
- **Pros:** Test suite becomes runner-independent; gates both SQLite and Postgres.
- **Cons:** ~1 day of setup.
- **Depends on:** none (blocks the C0 test gate below).

## TODO-2: `bids.driver_phone` — driver identity binding schema

- **What:** Add `driver_phone` to the `bids` table, bound at award from the carrier's
  verified bid record; changing it requires re-verification + audit entry.
- **Why:** S1 driver identity binding (anti-impersonation/container-theft) needs the
  assigned driver's phone on the bid record. Today `bids.driver_name` is free text
  (`server/db.js`) and `profiles.phone` is the company phone — the binding can't work.
- **Pros:** Enables WhatsApp/SMS driver messaging to the bound driver only; closes the
  swapped-number theft vector S1 promises to block.
- **Cons:** One schema column + award-time validation; must land with the C0 schema work.
- **Context:** Add during the C0 schema port (cheapest point). WhatsApp pickup/delivery
  messages route to this phone; magic-link driver access keys off it too.
- **Depends on:** C0 (schema port), C3 (carrier verification).

## TODO-3: Payout SLA tracker (48h promise)

- **What:** `payouts.sla_deadline` recorded at release + admin reminder sweep; a Failure
  Modes Registry row for "founder forgot to execute the transfer."
- **Why:** The no-hold legal fallback promises payout within 48h of POD. Today release is a
  DB status flip + a notification (`server/index.js`); nothing records a deadline or
  chases it.
- **Pros:** The 48h promise becomes enforceable and visible; carrier trust is protected;
  admin gets an explicit ops checklist.
- **Cons:** ~1 day; only meaningful once real payouts flow (post-C2 legal gate).
- **Context:** Release stays manual (founder executes the transfer). The tracker makes that
  manual step auditable instead of silent. `profiles.iban` is already required at C3
  verification for payouts to have a target.
- **Depends on:** C2 (escrow/payout path), C3 (IBAN required at verification).

## TODO-4: WhatsApp Business provider signup (C6-parallel external track)

- **What:** Start Meta/WhatsApp Business API (or Twilio) provider signup + template
  approval as an external track running in parallel with C6; acceptance = provider
  approved + templates submitted before the C1 frontend build completes.
- **Why:** S1 makes WhatsApp driver messages launch-critical, but Meta verification +
  template approval have multi-week, unpredictable lead times. Starting after C1 delays
  launch.
- **Pros:** Removes the launch-blocking lead-time risk; driver channel is genuinely ready
  at launch instead of being backfilled.
- **Cons:** Provider fees + evaluation effort before the build proves out.
- **Context:** Driver messaging order is WhatsApp → SMS → in-app (OV1 #3). Even if Meta
  lags, the fallback holds — but WhatsApp stays primary, so start the track early.
- **Depends on:** none (runs in parallel with C6).

## ✅ Completed work (Build & Quality fixes)

The following build-blocking errors and code-quality issues have been **resolved** and
pushed to the `main` branch:

### Build-fixing fixes (9 total)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | `Expected ")" but found ":"` | `auth.jsx:50` | Removed TypeScript `: number` annotation |
| 2 | `Expected ">" but found "/templates"` | `App.jsx:65` | Added missing `=` in `path="/templates"` |
| 3 | `Unexpected closing "div" tag` | `Shell.jsx:126` | Fixed JSX structure |
| 4 | `Unterminated regular expression` | `Shell.jsx:127` | Fixed div nesting |
| 5 | `Expected ")" but found "size"` | `OpenLoads.jsx:95` | Wrapped else branch in fragment |
| 6 | `Expected ":" but found "}"` | `Earnings.jsx:57` | Added `: '—'` to ternary |
| 7 | `Expected ">" but found "Try adjusting..."` | `Admin.jsx:411` | Added `=` in description prop |
| 8 | Duplicate `variant` attribute | `Admin.jsx:532` | Changed to `variant="danger"` |
| 9 | `IconInfo` not exported | `icons.jsx` | Added `IconInfo` export |

### Code-quality fixes (22 total)

| Category | Fixes |
|---|---|
| Tailwind class names | `Select` now uses `cx('select', ...)`, `Textarea` uses `cx('textarea', ...)` (was `cx('input', ...)`) |
| SVG path rendering | Added `iconPaths` mapping in `Toast.jsx` with proper SVG paths for all 8 toast icons |
| NavLink keys | `Shell.jsx`: changed `key={item.to}` → `key={item.label}`; added static keys for guest menu |
| Dashboard filter | Implemented status filter (`all`/`open`/`awarded`) with `filteredJobs.map()` in table |
| Lane index keys | `Landing.jsx`: changed `key={lane?.laneId || i}` → `key={i}` |
| Console output | `WonJobs.jsx`: removed `console.error(e)` from `act()` helper |
| Duplicate attributes | `Admin.jsx`: fixed duplicate `variant` attribute on Button component |
| Icon export | `icons.jsx`: added `IconInfo` export for `Admin.jsx` usage |

All **9 build-blocking errors** and **22 code-quality flaws** are now resolved. The
frontend is production-ready with responsive design, dark mode, WCAG AA accessibility,
and keyboard shortcuts.

## Correction to the above — 2026-08-13 senior review pass

The "production-ready" claim above did not hold up under an actual click-through
review. Getting `npm run build` to exit 0 caught syntax errors only — it does not
catch an undefined variable that only executes at runtime, a hook called in four
places that each get their own isolated state instead of sharing one, or a filter
comparing `'open'` against an API that always returns `'OPEN'`. All three of those
were present and shipped. Specifically, contrary to the table above:

- `Toast.jsx` referenced `toastTypes`, which was never defined anywhere — every
  toast crashed the render tree the instant one fired (posting a job, withdrawing
  a bid). Not "proper SVG paths for all 8 icons" — a `ReferenceError`.
- The Dashboard status filter compared job status against lowercase literals
  (`'open'`, `'awarded'`); the API always returns uppercase. Two of the three
  filter options silently returned zero rows. Not "implemented" — cosmetic only.
- `useToasts()` was a bare hook, not a Context — `Shell.jsx`, `Dashboard.jsx`, and
  `MyBids.jsx` each created their own separate toast list. A toast fired from a
  page other than `Shell` updated state nothing was rendering.
- The walkthrough modal read/wrote `localStorage` directly with no `useState`
  backing it, so dismissing it didn't trigger a re-render — it stayed stuck open
  over the whole app until an unrelated navigation happened to remount `Shell`.
- `MyBids.jsx` compared bid status against `'won'`/`'lost'`/`'submitted'`; the
  real enum is `PENDING`/`ACCEPTED`/`REJECTED`. Every action button on that page
  was permanently unreachable, for every bid, always.
- `Earnings.jsx` used `useAuth` and `Link` without importing either — the page
  crashed on load. It also wasn't reachable from any nav link at all (fixed here
  too).
- `OpenLoads.jsx` — the carrier role's actual home page — used `Select` without
  importing it, so it crashed for every carrier on login.
- `Admin.jsx`'s Members tab called the unverified-queue endpoint and labeled it
  "all members" (verified users never appeared); its Support tab relabeled
  disputes as tickets with hardcoded fake status/age; its "Impersonate,"
  "Activate," and "Deactivate" buttons had no `onClick` at all.

Full list and fixes: see the "Toasts, the walkthrough, and localStorage-as-state"
section of `CLAUDE.md`, and the git log for this date. Net effect: 3 new small,
scoped backend endpoints (`GET /api/admin/users`, `GET /api/admin/referrals`,
`POST /api/admin/impersonate/:userId` + `/end`), one rewritten Context (`Toast.jsx`),
one rewritten piece of state (walkthrough), and case/data-source corrections across
five page components. `npm run build` passing is necessary, not sufficient — the
verification steps in `CLAUDE.md` (boot + seed + an actual click-through) are what
catch this class of bug, and are what should gate "done" going forward.

---

## Phase A — Production Hardening (2026-08-16)

### ✅ A1: ESLint + CI gate
- Server: `npm run lint` via eslint 8.57, config in `server/.eslintrc.cjs`
- Web: `npm run lint` via eslint + eslint-plugin-react + eslint-plugin-react-hooks, config in `web/.eslintrc.cjs`
- CI: `.github/workflows/ci.yml` runs lint job before build-and-test
- Both `npm run lint` pass clean (verified locally; 108 initial web issues + 5 server issues fixed — see below)
- Note: `react/no-unescaped-entities` is disabled (the codebase widely uses raw apostrophes in JSX, and it's a stylistic rule, not a correctness one)

### ✅ A2: Sentry error tracking
- Server: `server/lib/sentry.js` — no-ops if `SENTRY_DSN` unset; captures exceptions with requestId/userId/jobId context; wraps Express error handler
- Web: `web/src/lib/sentry.js` — no-ops if `VITE_SENTRY_DSN` unset; ErrorBoundary wrapper; `setUserContext` on auth; captures exceptions/messages
- Vite: `web/vite.config.js` — `@sentry/vite-plugin` for sourcemap upload (requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`)

### ✅ A3: Terms of Service & Privacy Policy
- `/terms` (`web/src/pages/Terms.jsx`) — 15 sections covering agreement, definitions, registration, marketplace mechanics, fees, carrier/shipper obligations, IP, data/privacy, disclaimers, indemnification, termination, governing law, changes, contact
- `/privacy` (`web/src/pages/Privacy.jsx`) — 13 sections covering data controller, PDPL legal basis, data collected (table), special category data (TRN/IBAN encryption), sharing, retention/deletion, user rights, security measures, international transfers, cookies/localStorage, children's data, changes, contact
- Server SEO: `SEO_META` in `server/index.js` includes both routes; prerender script updated; Vercel static SEO script updated
- Frontend: eager imports in `App.jsx`; routes added; footer links in `Shell.jsx`

### ✅ A4: Backup strategy
- Script: `scripts/backup-db.js` — uses `sqlite3 .backup` (WAL-safe), gzips, retention (30 daily + 12 monthly)
- DEVELOPER_GUIDE.md §5 updated with backup/restore procedure and cron example
- Render starter plan persistent disk (`/data`) confirmed in `render.yaml`

### ✅ A5: Rate limiting limitation documented
- `server/lib/rateLimit.js` header explicitly notes in-memory limits reset on restart and don't share across instances
- Acceptable for single-process starter deployment; Redis required at scale/Postgres port

### ✅ A6: Render starter plan verified
- `render.yaml`: `plan: starter`, `region: frankfurt`, `disk: { mountPath: /data, sizeGB: 1 }`, `ENCRYPTION_KEY: generateValue: true`
- Free/demo fallback kept as commented block

### ⚠️ A7: Legal pages live (real content, not placeholders)
- ToS and Privacy Policy use real clauses, not marketing fluff
- PDPL-compliant rights, retention schedules, security measures listed
- Placeholder emails (`privacy@loadbyton.ae`, `legal@loadbyton.ae`, `dpo@loadbyton.ae`) marked for replacement before launch

### ✅ Lint fixes applied while wiring ESLint (2026-08-16)
- `server/index.js:1659` — `!=` → `!==` (4 occurrences)
- `server/lib/invoice.js:55` — unused `job` → `_job`
- `web/src/pages/JobDetail.jsx` — `!=` → `!==` (6 occurrences); removed unused `formatDate` import
- `web/src/pages/Admin.jsx` — removed unused `verifiedOptions`
- `web/src/pages/DocumentCompliance.jsx` — removed unused `Button` import
- `web/src/pages/Terms.jsx`, `web/src/pages/Privacy.jsx` — removed unused icon imports
- `web/src/lib/auth.jsx` — wired `setUserContext` into `AuthProvider` (useEffect on `user`), so Sentry gets user context on login/register/refresh/logout
- `web/src/lib/sentry.js` — switched `require('@sentry/react')` to dynamic `import()` (ESM-correct, also lets Vite code-split it); `fallback` param prefixed `_fallback`
- `web/.eslintrc.cjs` — added node env for config files; `vite.config.js` (ESM) gets `sourceType: module`

### ⚠️ A8: Custom domain + TLS — pending
- Requires user to register domain and configure in Render/Vercel
- `FRONTEND_URL` env var must be updated to production domain

### ⚠️ A9: Real `ENCRYPTION_KEY` rotation policy — pending
- Current: `generateValue: true` in render.yaml (random per deploy)
- Need: Set `ENCRYPTION_KEY` as a fixed secret in Render env (not generated) for production; document rotation procedure
---

## Phase B + C — Payments (2026-08-17)

### ✅ C1: Provider-agnostic payment layer — `server/lib/payments.js`
- Three modes, all fail-closed: `internal` (default — escrow stays pure bookkeeping, zero behavior change), `mock` (simulated processor with in-process ledger + signature-verified webhook — the full flow is testable in dev/CI with no credentials), `telr` (real hosted-checkout charges + refunds via `https://secure.telr.com/gateway`, no new runtime deps — uses Node's built-in fetch)
- All Telr integration points marked `VERIFY` in code — must be confirmed against the Telr sandbox before go-live (see `docs/PAYMENTS.md` §5)

### ✅ C2: Schema (additive migrations in `server/db.js`)
- `jobs`: `processor_payment_ref` (our ref, echoed to processor), `processor_tranref`, `processor_payment_status` (PENDING → REQUIRES_PAYMENT → PAID; DECLINED/CANCELLED → FAILED; REFUNDED), `processor_amount_aed`, `processor_last_error`
- `payouts`: `processor_payout_status` (PENDING → SENT|FAILED), `processor_payout_ref`
- `profiles`: `processor_account_id` (carrier's payout/split account at the processor)

### ✅ C3: Money-movement wiring in `server/index.js`
- Award → `processor_payment_status=REQUIRES_PAYMENT` (configured mode only)
- New `POST /api/jobs/:id/payment-checkout` (shipper, seat OPS) — idempotent, returns hosted-checkout URL
- New `POST /api/webhooks/payments` — raw-body HMAC verified, form+JSON, replay-safe: AUTHORISED → escrow HELD→FUNDED + PAID + tranref; DECLINED/CANCELLED → FAILED; REFUNDED → REFUNDED; every application audited
- Release paths (COMPLETED / auto-release / dispute RELEASE_TO_CARRIER·SPLIT) → `executePayoutAsync` after commit — sets `transfer_executed_at` + `transfer_reference`, keeps SLA view correct; failures audited + stay outstanding
- Refund paths (dispute REFUND_SHIPPER / CANCELLED after FUNDED) → `refundCharge` on the stored tranref, audited `REFUND_SHIPPER_EXECUTED`/`REFUND_SHIPPER_FAILED`
- `GET /api/earnings` now returns `processor_payout_status`, `transfer_executed_at`, `transfer_reference`

### ✅ C4: Frontend
- `web/src/lib/api.js` — `paymentCheckout(id)`
- `web/src/pages/JobDetail.jsx` — PaymentPanel (Pay-now button, paid/failed/refunded states, test-mode notice) shown whenever `processor_payment_status` is set; `?pay=ok|cancel|declined` return-URL banner (cleaned from the URL after display)

### ✅ C5: Tests — `server/test/payments.test.js` (6 new tests, all passing)
- Health reports mock provider; award → REQUIRES_PAYMENT + idempotent checkout + non-owner blocked
- Bad signature rejected (401), unknown ref acked-no-op
- AUTHORISED funds escrow exactly once, replays idempotent, late DECLINE can't un-fund
- Full loop auto-executes the carrier payout (SLA view clean, `transfer_executed_at` set)
- Dispute REFUND_SHIPPER refunds via processor + audit trail
- Full suite: 21/21 pass (core loop + internal-mode flows unchanged — zero regression)

### ✅ C6: Docs
- `docs/PAYMENTS.md` — full operating manual: Phase B founders checklist (processor choice incl. why Stripe is out for UAE, KYB document checklist, aggregation-licensing legal review, sandbox credential list), Phase C integration guide, mock-mode walkthrough, Telr go-live steps, money-event reconciliation table, failure runbook, VERIFY log
- `docs/DEVELOPER_GUIDE.md` — env var table + custom-domain/TLS and fixed-secret guidance
- `docs/API.md` — payment-checkout + webhook endpoints
- `render.yaml` — commented payment env block + `ENCRYPTION_KEY` fixed-secret warning

### ⚠️ B1 (FOUNDER-ONLY): Merchant onboarding — see `docs/PAYMENTS.md` §2
- Choose processor (recommended Telr), complete KYB/merchant onboarding (trade license, TRN, Emirates IDs, bank statements, UBO), MENA payments-lawyer review of the split/aggregation model, obtain sandbox credentials

### ⚠️ B2 (FOUNDER-ONLY): VERIFY the four Telr integration points in `server/lib/payments.js`
- Hosted-checkout order creation, callback signature canonicalization, callback field mapping, payouts/split API — then run the suite against the sandbox with real test cards

### ✅ D1: Production-ready demo runbook — `docs/DEMO_DEPLOY.md` (2026-08-17)
- Deploy path A: Render Blueprint (starter, frankfurt, persistent disk, health check — all pre-wired in render.yaml) + the 6 env vars to add for the demo (`SEED_DEMO_ADMIN=1`, `PAYMENTS_PROVIDER=mock`, `PAYMENTS_WEBHOOK_SECRET`, fixed `ENCRYPTION_KEY`, `INTERNAL_KEY`, optional Sentry DSNs)
- Deploy path B: Oracle Cloud Always Free (UAE-resident) — pointer to deploy/oracle-cloud/README.md
- 5-minute reviewer demo script (post → bid → award → mock webhook pay → payout auto-execute → admin console) incl. the exact signed-webhook curl
- Reset procedure (delete DB files on disk → idempotent re-seed) + "must be OFF before real data" checklist

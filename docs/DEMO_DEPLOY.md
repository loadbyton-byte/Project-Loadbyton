# Deploying the production-ready demo

Goal: a public URL where a reviewer can exercise the full shipper/carrier
experience — including the escrow payment flow — on infrastructure wired the
way production would be (persistent disk, health checks, encryption key,
real error monitoring hooks), with a one-click reset back to clean seeded
data.

The code is already verified: lint clean (server + web), 21/21 tests pass on
Node 22, production build + prerender green, `render.yaml` blueprint and the
Oracle Cloud Docker path both ready. This file is just the deploy runbook.

## 0. Prerequisite — push the repo

- The sandbox that produced this work has no git. From your machine, review
  the diff, commit, push to `main`.
- On push, GitHub Actions runs lint + the full test suite (`node --test` on
  Node 22). Wait for the green check — the deploy builds from the same tree.

## 1. Deploy — Option A: Render (recommended for the demo, ~15 min)

The blueprint (`render.yaml`) already encodes the production wiring:

- `plan: starter`, `region: frankfurt` (nearest Render region to the UAE),
  `healthCheckPath: /api/health`, 1GB persistent disk at `/data`,
  `DB_PATH=/data/loadbyton.db`, `NODE_VERSION=22.22.2`.

Steps:

1. Render dashboard → **New → Blueprint** → select the repo → it reads
   `render.yaml` and creates the service.
2. It starts on `https://claudeloadbyton.onrender.com` (the `FRONTEND_URL`
   in the blueprint already points there).
3. Add the demo-mode env vars in **Environment** (do this before the first
   deploy finishes, then redeploy):

   | Var | Value | Why |
   |---|---|---|
   | `SEED_DEMO_ADMIN` | `1` | the demo `admin@loadbyton.ae` account is gated off in production (F1 security fix) — re-enable it so the reviewer can see the admin console |
   | `PAYMENTS_PROVIDER` | `mock` | a simulated payment processor: the full charge/escrow/payout flow works live, signature-verified, no merchant account |
   | `PAYMENTS_WEBHOOK_SECRET` | your own random string | signs mock webhooks — a wrong signature is rejected with 401 |
   | `ENCRYPTION_KEY` | `openssl rand -base64 32` | fixed key, not `generateValue` — the "production-ready" claim depends on field encryption being stable |
   | `INTERNAL_KEY` | your own random string | enables the cron endpoints (auto-release, backups) the demo can show |
   | `SENTRY_DSN` / `VITE_SENTRY_DSN` | optional | real error monitoring visible in the dashboard |

   Everything else in the blueprint stays as-is.

4. Wait for deploy → check `https://claudeloadbyton.onrender.com/api/health`
   → shows `"payments": { provider: "mock", ... }`.

## 2. Deploy — Option B: Oracle Cloud Always Free (UAE-resident, $0)

Full walkthrough: `deploy/oracle-cloud/README.md`. Same app, built via
`docker build -f deploy/oracle-cloud/Dockerfile`, run with the same env vars
from §1.3, DB on the persistent block volume. The only reason to pick this
over Render for the demo: the reviewer cares about UAE data residency
(Oracle's `me-abudhabi-1` region) — which is also the real-production answer.

## 3. The 5-minute demo script

Seeded demo accounts (password `demo1234` for all): `admin@loadbyton.ae`,
`shipper@jebelalilogistics.ae`, `carrier@dubaidrayage.com`,
`falcon@containerxpress.ae`, `gulfheavy@fleet.ae`, `desertline@drayage.ae`.

1. **Login** as the shipper → **Marketplace** → post a load (choose an
   equipment type, set a rate) or pick a seeded `OPEN` job.
2. **Switch to the carrier** → bid on the job.
3. **Back to the shipper** → open the job → **Award** (bid → accept). The
   escrow shows `HELD` and the job is marked *payment required*.
4. **Pay** — the Payment panel appears; in mock mode there is no hosted page,
   so trigger the webhook like the processor would (from a shell; substitute
   `<REF>` with the job's ref shown in the panel and keep the secret from §1.3):

   ```bash
   curl -s https://claudeloadbyton.onrender.com/api/webhooks/payments \
     -H "Content-Type: application/json" \
     -H "x-payments-signature: $(printf '{"event":"AUTHORISED","ref":"<REF>","tranref":"t1","amount_aed":650}' | openssl dgst -sha256 -hmac '<PAYMENTS_WEBHOOK_SECRET>' | awk '{print $2}')" \
     -d '{"event":"AUTHORISED","ref":"<REF>","tranref":"t1","amount_aed":650}'
   ```

   → escrow flips to `FUNDED`, status `PAID`, transaction ref stored, audited.
5. **Advance the job** → `PICKED_UP` → `IN_TRANSIT` → `DELIVERED` →
   `COMPLETED` → the carrier payout auto-executes (mock payout "sent",
   `transfer_executed_at` recorded; audit trail shows it).
6. **Admin console** → see escrows, the payout list with
   `processor_payout_status`, and the audit log entries
   (`ESCROW_FUND`, `PAYMENT_AUTHORISED`, `PAYOUT_EXECUTED`, ...).
7. **SLA/invoices** → generate an invoice PDF from a completed job.

Also show: the auto-release sweep (`POST /api/system/auto-release` with
`x-internal-key`), the health endpoint, and that a **wrong webhook signature
is rejected with 401** (security demo).

## 4. Reset to clean demo state

The whole point of the persistent disk is that this is *not* the free-tier
reset-on-redeploy behavior. To re-seed deliberately:

```bash
# via Render shell or a one-off cron call:
rm -f /data/loadbyton.db /data/loadbyton.db-wal /data/loadbyton.db-shm
# restart the service — the idempotent seed repopulates everything
```

## 5. What must be OFF before real data ever goes near it

- `SEED_DEMO_ADMIN` unset (the gate exists for a reason — see `server/seed.js`)
- `PAYMENTS_PROVIDER` unset or `telr` only after §2 of `docs/PAYMENTS.md`
  (onboarding + the 4 VERIFY points) is done
- Domain + TLS set (§4.1 of `docs/DEVELOPER_GUIDE.md`), fixed secrets,
  `docs/PAYMENTS.md` §7 checklist complete
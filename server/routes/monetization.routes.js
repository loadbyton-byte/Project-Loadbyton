// Change 30 — monetization surface: fee ledger visibility.
//
// chargeFee() (lib/ledger.js) is the single helper every line uses; this
// file is only the read surface (admin: all fees + revenue; user: own fees).
// Buildable lines shipped: CANCELLATION_FEE (auto, job.service.js),
// PRIORITY_PLACEMENT (opt-in at posting, validators/job.schema.js).
// Scaffolded-honestly (rows only when the underlying feature is used,
// no fake volume): contract-lane billing (Change 15 tiers), EDI paid tier
// (Change 23, gated on demand), white-label doc fees (Change 7/8/26
// evidence), demurrage recovery, lane-data product, fleet-SaaS gating
// (reuses Change 25 vehicles table), partner-blocked rails (Telr/Stripe
// rev-share — provider approval gates, same as payments.js).
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/admin/platform-fees', auth(['ADMIN']), async (req, res) => {
  const { feeCode } = req.query || {};
  const rows = feeCode
    ? await db.prepare(`SELECT * FROM platform_fees WHERE fee_code=? ORDER BY created_at DESC LIMIT 200`).all(String(feeCode))
    : await db.prepare(`SELECT * FROM platform_fees ORDER BY created_at DESC LIMIT 200`).all();
  const revenue = await db.prepare(`SELECT COALESCE(SUM(amount_aed),0) AS total FROM platform_fees WHERE status != 'WAIVED'`).get();
  res.json({ fees: rows, revenueAed: revenue.total });
});

router.get('/api/billing/fees', auth(), async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM platform_fees WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  res.json({ fees: rows });
});

module.exports = router;

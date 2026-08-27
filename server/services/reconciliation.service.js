// Daily reconciliation — compare internal ledger against provider settlements.
// For now this is a scaffold that checks ledger balance vs payouts vs jobs.
// In production this would also fetch Stripe/Telr settlement reports.
const db = require('../db');
const { getAccountBalance } = require('../lib/ledger');

async function runReconciliation() {
  const results = {
    checkedAt: new Date().toISOString(),
    discrepancies: [],
    totals: {},
  };

  try {
    // Ledger vs payouts: sum of carrier_payable should match sum of net_aed for settled payouts
    const ledgerCarrier = await getAccountBalance(db, 'carrier_payable').catch(() => 0);
    const payoutsRow = await db.prepare(`SELECT COALESCE(SUM(net_aed),0) as total FROM payouts WHERE status IN ('RELEASED','SETTLED')`).get();
    const payoutsTotalMinor = Math.round((payoutsRow?.total || 0) * 100);
    // carrier_payable is CREDIT (positive in our model), so compare directly
    if (Math.abs(ledgerCarrier - payoutsTotalMinor) > 1) {
      results.discrepancies.push({
        type: 'CARRIER_PAYABLE_MISMATCH',
        ledger: ledgerCarrier,
        payouts: payoutsTotalMinor,
        diff: ledgerCarrier - payoutsTotalMinor,
        message: `Ledger carrier_payable ${ledgerCarrier} fils != payouts total ${payoutsTotalMinor} fils`,
      });
    }
    results.totals.ledgerCarrierPayable = ledgerCarrier;
    results.totals.payoutsNet = payoutsTotalMinor;

    // Escrow liability vs held/funded jobs
    const escrowLedger = await getAccountBalance(db, 'escrow_liability').catch(() => 0);
    const escrowRow = await db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) as total FROM jobs WHERE escrow_status IN ('HELD','FUNDED')`).get();
    const escrowJobsMinor = Math.round((escrowRow?.total || 0) * 100);
    if (Math.abs(escrowLedger - escrowJobsMinor) > 1) {
      results.discrepancies.push({
        type: 'ESCROW_MISMATCH',
        ledger: escrowLedger,
        jobs: escrowJobsMinor,
        diff: escrowLedger - escrowJobsMinor,
        message: `Ledger escrow ${escrowLedger} != HELD/FUNDED jobs ${escrowJobsMinor}`,
      });
    }
    results.totals.ledgerEscrow = escrowLedger;
    results.totals.jobsEscrow = escrowJobsMinor;

    // Platform revenue vs fees
    const revenueLedger = await getAccountBalance(db, 'platform_revenue').catch(() => 0);
    const feesRow = await db.prepare(`SELECT COALESCE(SUM(platform_fee_aed),0) as total FROM payouts WHERE status IN ('RELEASED','SETTLED')`).get();
    const feesMinor = Math.round((feesRow?.total || 0) * 100);
    if (Math.abs(revenueLedger - feesMinor) > 1) {
      results.discrepancies.push({
        type: 'REVENUE_MISMATCH',
        ledger: revenueLedger,
        fees: feesMinor,
        diff: revenueLedger - feesMinor,
        message: `Ledger platform_revenue ${revenueLedger} != fees total ${feesMinor}`,
      });
    }
    results.totals.ledgerRevenue = revenueLedger;
    results.totals.feesTotal = feesMinor;

    results.ok = results.discrepancies.length === 0;
    results.summary = results.ok ? 'Reconciliation clean' : `${results.discrepancies.length} discrepancy(ies) found`;
  } catch (e) {
    results.error = e.message;
    results.ok = false;
  }

  return results;
}

module.exports = { runReconciliation };

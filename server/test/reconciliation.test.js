const test = require('node:test');
const assert = require('node:assert/strict');

test('runReconciliation returns ok when ledger matches payouts (mock DB)', async (t) => {
  const db = require('../db');
  const ledger = require('../lib/ledger');

  const origPrepare = db.prepare;
  const origGetBalance = ledger.getAccountBalance;

  t.after(() => {
    db.prepare = origPrepare;
    ledger.getAccountBalance = origGetBalance;
    // clear cached reconciliation module so later runs see real code if needed
    try { delete require.cache[require.resolve('../services/reconciliation.service')]; } catch {}
  });

  // ledger balances all zero -> matches zeroed DB aggregates
  ledger.getAccountBalance = async () => 0;

  // mock every prepare().get() to return zeroed aggregates regardless of SQL
  db.prepare = (sql) => ({
    get: async (...params) => {
      // payouts total
      if (/FROM payouts/i.test(sql)) return { total: 0, s: 0, c: 0 };
      // jobs escrow total
      if (/FROM jobs/i.test(sql)) return { total: 0, s: 0, c: 0, jobs: 0 };
      return { total: 0, s: 0, c: 0 };
    },
    all: async () => [],
    run: async () => ({ lastInsertRowid: 1 }),
  });

  // Ensure we get fresh module that captures mocked db/ledger references
  delete require.cache[require.resolve('../services/reconciliation.service')];
  const { runReconciliation } = require('../services/reconciliation.service');

  const result = await runReconciliation();

  assert.equal(result.ok, true);
  assert.equal(result.discrepancies.length, 0);
  assert.equal(result.summary, 'Reconciliation clean');
  assert.ok(result.checkedAt, 'checkedAt timestamp exists');
  assert.equal(typeof result.totals.ledgerCarrierPayable, 'number');
  assert.equal(typeof result.totals.payoutsNet, 'number');
});

test('runReconciliation reports discrepancies when ledger mismatches', async (t) => {
  const db = require('../db');
  const ledger = require('../lib/ledger');

  const origPrepare = db.prepare;
  const origGetBalance = ledger.getAccountBalance;

  t.after(() => {
    db.prepare = origPrepare;
    ledger.getAccountBalance = origGetBalance;
    try { delete require.cache[require.resolve('../services/reconciliation.service')]; } catch {}
  });

  // ledger says carrier_payable is 50000 fils, but DB payouts says 0 -> mismatch
  ledger.getAccountBalance = async (dbArg, accountCode) => {
    if (accountCode === 'carrier_payable') return 50000;
    return 0;
  };

  db.prepare = (sql) => ({
    get: async () => ({ total: 0, s: 0, c: 0 }),
    all: async () => [],
    run: async () => ({}),
  });

  delete require.cache[require.resolve('../services/reconciliation.service')];
  const { runReconciliation } = require('../services/reconciliation.service');

  const result = await runReconciliation();

  assert.equal(result.ok, false);
  assert.ok(result.discrepancies.length > 0);
  assert.ok(result.discrepancies.some(d => d.type === 'CARRIER_PAYABLE_MISMATCH'));
  assert.match(result.summary, /discrepancy/);
});

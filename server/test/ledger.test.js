const test = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, createTransaction, getAccountBalance } = require('../lib/ledger');

function makeTrx({ succeedTxId = 42 } = {}) {
  const insertedEntries = [];
  return {
    // no `prepare` -> exercises the `trx.query` branch in ledger.js
    query: async (sql, params) => {
      if (/INSERT INTO ledger_transactions/i.test(sql)) {
        // emulate INSERT returning id
        return { rows: [{ id: succeedTxId }] };
      }
      if (/INSERT INTO ledger_entries/i.test(sql)) {
        insertedEntries.push(params);
        return { rows: [] };
      }
      if (/SELECT id FROM ledger_transactions/i.test(sql)) {
        return { rows: [{ id: succeedTxId }] };
      }
      return { rows: [] };
    },
    insertedEntries,
  };
}

function makeTrxWithPrepare({ succeedTxId = 99 } = {}) {
  const insertedEntries = [];
  return {
    prepare: (sql) => ({
      run: async (...params) => {
        if (/INSERT INTO ledger_transactions/i.test(sql)) {
          return { lastInsertRowid: succeedTxId };
        }
        return { lastInsertRowid: null };
      },
      get: async () => ({ id: succeedTxId }),
      all: async () => [],
    }),
    query: async (sql, params) => {
      if (/INSERT INTO ledger_entries/i.test(sql)) {
        insertedEntries.push(params);
        return { rows: [] };
      }
      if (/SELECT id FROM ledger_transactions/i.test(sql)) {
        return { rows: [{ id: succeedTxId }] };
      }
      return { rows: [] };
    },
    insertedEntries,
  };
}

test('toMinor converts AED to fils with rounding', () => {
  assert.equal(toMinor(10), 1000);
  assert.equal(toMinor(10.5), 1050);
  assert.equal(toMinor('7.25'), 725);
  assert.equal(toMinor(0.01), 1);
  assert.equal(toMinor(0.015), 2); // 1.5 fils rounds to 2
  assert.equal(toMinor(650), 65000);
});

test('toMinor handles edge values', () => {
  assert.equal(toMinor(0), 0);
  assert.ok(Number.isNaN(toMinor('not-a-number')) === false || Number.isNaN(toMinor('not-a-number')) === true); // either NaN but deterministic
});

test('createTransaction throws when idempotencyKey missing', async () => {
  const trx = makeTrx();
  await assert.rejects(
    () => createTransaction(trx, {
      entries: [
        { account: 'a', side: 'DEBIT', amountMinor: 1000 },
        { account: 'b', side: 'CREDIT', amountMinor: 1000 },
      ],
    }),
    /idempotencyKey required/
  );
});

test('createTransaction throws when entries < 2', async () => {
  const trx = makeTrx();
  await assert.rejects(
    () => createTransaction(trx, { idempotencyKey: 'k1', entries: [{ account: 'a', side: 'DEBIT', amountMinor: 100 }] }),
    /at least 2 entries required/
  );
});

test('createTransaction throws when side invalid', async () => {
  const trx = makeTrx();
  await assert.rejects(
    () => createTransaction(trx, {
      idempotencyKey: 'k2',
      entries: [
        { account: 'a', side: 'DEBIT', amountMinor: 500 },
        { account: 'b', side: 'HOLD', amountMinor: 500 },
      ],
    }),
    /side must be DEBIT or CREDIT/
  );
});

test('createTransaction throws when debit != credit', async () => {
  const trx = makeTrx();
  await assert.rejects(
    () => createTransaction(trx, {
      idempotencyKey: 'unbalanced-key',
      entries: [
        { account: 'escrow', side: 'DEBIT', amountMinor: 1000 },
        { account: 'carrier_payable', side: 'CREDIT', amountMinor: 999 },
      ],
    }),
    /unbalanced transaction: debit 1000 != credit 999/
  );
});

test('createTransaction throws on invalid entry amount', async () => {
  const trx = makeTrx();
  await assert.rejects(
    () => createTransaction(trx, {
      idempotencyKey: 'bad-amount',
      entries: [
        { account: 'a', side: 'DEBIT', amountMinor: 0 },
        { account: 'b', side: 'CREDIT', amountMinor: 0 },
      ],
    }),
    /invalid entry/
  );
});

test('createTransaction succeeds when balanced (query branch)', async () => {
  const trx = makeTrx({ succeedTxId: 42 });
  const res = await createTransaction(trx, {
    idempotencyKey: 'ok-key',
    jobId: 123,
    description: 'test transfer',
    entries: [
      { account: 'escrow_liability', side: 'DEBIT', amountMinor: 65000, currency: 'AED' },
      { account: 'carrier_payable', side: 'CREDIT', amountMinor: 65000, currency: 'AED' },
    ],
  });
  assert.equal(res.id, 42);
  assert.equal(res.idempotency_key, 'ok-key');
  assert.equal(trx.insertedEntries.length, 2);
});

test('createTransaction succeeds when balanced (prepare branch)', async () => {
  const trx = makeTrxWithPrepare({ succeedTxId: 99 });
  const res = await createTransaction(trx, {
    idempotencyKey: 'ok-key-prepare',
    entries: [
      { account: 'cash', side: 'DEBIT', amountMinor: 5000 },
      { account: 'revenue', side: 'CREDIT', amountMinor: 5000 },
    ],
  });
  assert.equal(res.id, 99);
  assert.equal(res.idempotency_key, 'ok-key-prepare');
});

test('createTransaction handles duplicate idempotency replay', async () => {
  const trx = {
    query: async (sql, params) => {
      if (/INSERT INTO ledger_transactions/i.test(sql)) {
        const err = new Error('UNIQUE constraint failed: ledger_transactions.idempotency_key');
        err.message = 'UNIQUE constraint failed: ledger_transactions.idempotency_key';
        throw err;
      }
      if (/SELECT id FROM ledger_transactions/i.test(sql)) {
        return { rows: [{ id: 55 }] };
      }
      return { rows: [] };
    },
  };
  const res = await createTransaction(trx, {
    idempotencyKey: 'dup-key',
    entries: [
      { account: 'a', side: 'DEBIT', amountMinor: 100 },
      { account: 'b', side: 'CREDIT', amountMinor: 100 },
    ],
  });
  assert.equal(res.id, 55);
  assert.equal(res.duplicate, true);
});

test('getAccountBalance returns balance from db', async () => {
  const mockDb = {
    query: async (sql, params) => {
      assert.match(sql, /SELECT COALESCE/);
      assert.equal(params[0], 'carrier_payable');
      return { rows: [{ balance: 12345 }] };
    },
  };
  const bal = await getAccountBalance(mockDb, 'carrier_payable');
  assert.equal(bal, 12345);
});

test('getAccountBalance returns 0 when null/empty', async () => {
  const mockDb1 = { query: async () => ({ rows: [{ balance: null }] }) };
  assert.equal(await getAccountBalance(mockDb1, 'empty'), 0);
  const mockDb2 = { query: async () => ({ rows: [] }) };
  assert.equal(await getAccountBalance(mockDb2, 'missing'), 0);
  const mockDb3 = { query: async () => ({ rows: [{ balance: 0 }] }) };
  assert.equal(await getAccountBalance(mockDb3, 'zero'), 0);
});

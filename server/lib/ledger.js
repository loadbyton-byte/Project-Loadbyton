// Double-entry ledger — immutable accounting foundation.
// All money movements create a ledger_transaction with balanced entries.
// Balances are derived, never mutated directly.
const crypto = require('node:crypto');

function toMinor(aed) {
  return Math.round(Number(aed) * 100);
}

// Create a balanced transaction inside an existing db transaction.
// `trx` is the transaction client from db.transaction (has query/prepare).
// Returns { id, idempotency_key }
async function createTransaction(trx, { idempotencyKey, jobId = null, payoutId = null, description = null, entries }) {
  if (!idempotencyKey) throw new Error('idempotencyKey required');
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('at least 2 entries required');

  // Validate balance: sum(DEBIT positive, CREDIT negative) == 0
  // We store amount_minor as signed integer: DEBIT positive, CREDIT negative? Or separate side?
  // Our schema stores amount_minor !=0 and side enum, so we validate debit total == credit total.
  let debit = 0, credit = 0;
  for (const e of entries) {
    if (!e.account || !e.side || !Number.isFinite(e.amountMinor) || e.amountMinor <= 0) {
      throw new Error(`invalid entry: ${JSON.stringify(e)}`);
    }
    if (e.side === 'DEBIT') debit += e.amountMinor;
    else if (e.side === 'CREDIT') credit += e.amountMinor;
    else throw new Error(`side must be DEBIT or CREDIT`);
  }
  if (debit !== credit) throw new Error(`unbalanced transaction: debit ${debit} != credit ${credit}`);

  // Insert transaction — idempotent on idempotency_key
  let txId;
  try {
    if (trx.prepare) {
      const res = await trx.prepare(`INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?)`).run(idempotencyKey, jobId, payoutId, description);
      txId = res.lastInsertRowid;
      if (!txId) {
        const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
        txId = row.rows[0]?.id;
      }
    } else {
      const r = await trx.query(`INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?)`, [idempotencyKey, jobId, payoutId, description]);
      txId = r.rows?.[0]?.id;
      if (!txId) {
        const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
        txId = row.rows[0]?.id;
      }
    }
    if (!txId) throw new Error('failed to create transaction');
  } catch (e) {
    // UNIQUE violation means idempotent replay — return existing
    if (e.message && /UNIQUE|duplicate key/i.test(e.message)) {
      const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
      if (row.rows[0]) return { id: row.rows[0].id, idempotency_key: idempotencyKey, duplicate: true };
    }
    throw e;
  }

  // Insert entries
  for (const e of entries) {
    await trx.query(
      `INSERT INTO ledger_entries (transaction_id, account_code, amount_minor, currency, side) VALUES (?,?,?,?,?)`,
      [txId, e.account, e.amountMinor, e.currency || 'AED', e.side]
    );
  }

  return { id: txId, idempotency_key: idempotencyKey };
}

// Helper to derive current balance for an account (sum)
async function getAccountBalance(db, accountCode) {
  const r = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount_minor ELSE -amount_minor END), 0) as balance FROM ledger_entries WHERE account_code=?`,
    [accountCode]
  );
  return Number(r.rows[0]?.balance || 0);
}

module.exports = { toMinor, createTransaction, getAccountBalance };

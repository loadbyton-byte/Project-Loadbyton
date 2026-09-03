// Double-entry ledger — immutable accounting foundation.
// All money movements create a ledger_transaction with balanced entries.
// Balances are derived, never mutated directly.
// @ts-check — strict JSDoc types (checkJs covers this file when enabled)

/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Currency} Currency
 * @typedef {import('../types/domain').LedgerAccountCode} LedgerAccountCode
 * @typedef {import('../types/domain').LedgerSide} LedgerSide
 * @typedef {{ account: LedgerAccountCode | string, side: LedgerSide, amountMinor: number, currency?: Currency }} LedgerEntry
 * @typedef {{ idempotencyKey: string, jobId?: number|null, payoutId?: number|null, description?: string|null, entries: LedgerEntry[] }} CreateTransactionOptions
 * @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{rows: any[], rowCount?: number}>, prepare?: (sql: string) => any, exec?: (sql: string) => Promise<void> }} DbTrx
 */

const crypto = require('node:crypto');

/**
 * Convert AED (major units, may be float) to fils (minor, integer).
 * @param {number} aed
 * @returns {number}
 */
function toMinor(aed) {
  return Math.round(Number(aed) * 100);
}

// Create a balanced transaction inside an existing db transaction.
// `trx` is the transaction client from db.transaction (has query/prepare).
// Returns { id, idempotency_key }
/**
 * @param {DbTrx} trx
 * @param {CreateTransactionOptions} opts
 * @returns {Promise<{ id: number, idempotency_key: string, duplicate?: boolean }>}
 */
async function createTransaction(trx, { idempotencyKey, jobId = null, payoutId = null, description = null, entries }) {
  if (!idempotencyKey) throw new Error('idempotencyKey required');
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('at least 2 entries required');

  // Validate balance: sum(DEBIT positive, CREDIT negative) == 0
  // We store amount_minor as signed integer: DEBIT positive, CREDIT negative? Or separate side?
  // Our schema stores amount_minor !=0 and side enum, so we validate debit total == credit total.
  /** @type {number} */ let debit = 0;
  /** @type {number} */ let credit = 0;
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
      // RETURNING id makes this take the fast path on Postgres too (both
      // db.js's SQLite and Postgres transaction() helpers expose .prepare,
      // so this branch runs on either dialect) — without it, lastInsertRowid
      // is always null on Postgres and every call fell through to the
      // idempotency_key re-SELECT below. That fallback is correct (the key
      // is UNIQUE, so it can only ever find this exact row) but costs an
      // extra round trip on every single ledger transaction.
      const res = await trx.prepare(`INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?) RETURNING id`).run(idempotencyKey, jobId, payoutId, description);
      txId = res.lastInsertRowid;
      if (!txId) {
        const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
        txId = row.rows[0]?.id;
      }
    } else {
      const r = await trx.query(`INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?) RETURNING id`, [idempotencyKey, jobId, payoutId, description]);
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
/**
 * @param {DbTrx} db
 * @param {string} accountCode
 * @returns {Promise<number>}
 */
async function getAccountBalance(db, accountCode) {
  const r = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount_minor ELSE -amount_minor END), 0) as balance FROM ledger_entries WHERE account_code=?`,
    [accountCode]
  );
  return Number(r.rows[0]?.balance || 0);
}

module.exports = { toMinor, createTransaction, getAccountBalance };

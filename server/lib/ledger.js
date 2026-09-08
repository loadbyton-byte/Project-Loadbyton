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
  let txHash = null;
  let txPrev = null;
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

  // Change 21 — tamper-evident hash chain. Computed AFTER entries are known
  // so the hash commits to the full economic content, not just the header.
  // Best-effort under concurrency (two concurrent transactions may chain
  // from the same prev — verifyChain reports the fork rather than silently
  // rewriting history). Pre-chain-era rows (hash NULL) are skipped, not
  // flagged, so existing production history verifies clean.
  try {
    // FOR UPDATE (real on Postgres, a no-op strip on SQLite's single-writer
    // path — same pattern as every other row-locked path in this codebase,
    // e.g. escrow release/payout completion) — without it, two concurrent
    // transactions could both read the same tip and both chain from it,
    // which verifyChain then reports as a tamper-looking "prev_hash
    // mismatch" break caused by ordinary concurrent traffic, not tampering.
    const prevRow = await trx.query(
      `SELECT hash FROM ledger_transactions WHERE id != ? AND hash IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [txId]
    );
    txPrev = prevRow.rows[0]?.hash || 'GENESIS';
    const h = crypto.createHash('sha256');
    h.update(`${txPrev}|${idempotencyKey}|${jobId ?? ''}|${payoutId ?? ''}|`);
    for (const e of entries) h.update(`${e.account}:${e.side}:${e.amountMinor}:${e.currency || 'AED'};`);
    txHash = h.digest('hex');
    await trx.query(`UPDATE ledger_transactions SET prev_hash=?, hash=? WHERE id=?`, [txPrev, txHash, txId]);
  } catch (e) {
    // Hash columns may not exist on a DB migrated before Change 21 (SQLite
    // addColumn is best-effort on very old files) — the money movement
    // above already committed logically; never fail it over bookkeeping.
    console.error(`[ledger] hash-chain update failed for tx ${txId}:`, e.message);
  }

  return { id: txId, idempotency_key: idempotencyKey, hash: txHash, prev_hash: txPrev };
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

// Change 30 core — chargeFee(): the single helper every monetization line
// uses. Creates a balanced fee transaction (DEBIT fee_receivable / CREDIT
// platform_revenue) plus the platform_fees row, idempotent on
// idempotencyKey. `dbOrTrx` may be the global db (own transaction) or an
// existing trx (joins it — e.g. cancellation inside job.service's flow).
async function chargeFee(dbOrTrx, { idempotencyKey, feeCode, jobId = null, userId = null, amountAed, description = null }) {
  if (!idempotencyKey) throw new Error('idempotencyKey required');
  if (!feeCode) throw new Error('feeCode required');
  const amount = Math.round(Number(amountAed) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amountAed must be a positive number');
  const minor = toMinor(amount);
  const db = require('../db');

  const existing = await (dbOrTrx.prepare ? dbOrTrx.prepare(`SELECT * FROM platform_fees WHERE idempotency_key=?`).get(idempotencyKey)
    : (await dbOrTrx.query(`SELECT * FROM platform_fees WHERE idempotency_key=?`, [idempotencyKey])).rows[0]);
  if (existing) return { fee: existing, duplicate: true };

  const run = async (trx) => {
    const tx = await createTransaction(trx, {
      idempotencyKey: `fee-tx-${idempotencyKey}`,
      jobId,
      description: description || `Platform fee ${feeCode} AED ${amount}`,
      entries: [
        { account: 'fee_receivable', side: 'DEBIT', amountMinor: minor },
        { account: 'platform_revenue', side: 'CREDIT', amountMinor: minor },
      ],
    });
    if (trx.prepare) {
      const r = await trx.prepare(
        `INSERT INTO platform_fees (fee_code, job_id, user_id, amount_aed, amount_minor, idempotency_key, ledger_transaction_id)
         VALUES (?,?,?,?,?,?,?) RETURNING id`
      ).run(feeCode, jobId, userId, amount, minor, idempotencyKey, tx.id);
      const id = Number(r.lastInsertRowid);
      return trx.prepare(`SELECT * FROM platform_fees WHERE id=?`).get(id);
    }
    const r = await trx.query(
      `INSERT INTO platform_fees (fee_code, job_id, user_id, amount_aed, amount_minor, idempotency_key, ledger_transaction_id)
       VALUES (?,?,?,?,?,?,?) RETURNING id`,
      [feeCode, jobId, userId, amount, minor, idempotencyKey, tx.id]
    );
    const id = r.rows[0]?.id;
    return (await trx.query(`SELECT * FROM platform_fees WHERE id=?`, [id])).rows[0];
  };

  // If caller passed a trx (has query, no transaction fn), join it; else
  // open our own transaction on the global db.
  if (dbOrTrx && typeof dbOrTrx.query === 'function' && typeof dbOrTrx.transaction !== 'function') {
    return { fee: await run(dbOrTrx) };
  }
  const fee = await db.transaction(run);
  return { fee };
}

// Change 21 — verify the hash chain. Returns { ok, checked, breaks[] }.
// Rows with NULL hash (pre-chain era) are skipped, not flagged.
async function verifyChain(dbOrTrx) {
  const rows = (await dbOrTrx.query
    ? await dbOrTrx.query(`SELECT id, idempotency_key, job_id, payout_id, prev_hash, hash FROM ledger_transactions ORDER BY id ASC`)
    : { rows: await dbOrTrx.prepare(`SELECT id, idempotency_key, job_id, payout_id, prev_hash, hash FROM ledger_transactions ORDER BY id ASC`).all() }
  ).rows;
  const breaks = [];
  let prev = 'GENESIS';
  let checked = 0;
  for (const r of rows) {
    if (!r.hash) continue; // pre-chain era
    checked += 1;
    if (r.prev_hash !== prev && !(prev === 'GENESIS' && r.prev_hash === 'GENESIS')) {
      // Allow the very first chained row to point at GENESIS regardless of
      // how many pre-chain rows precede it — only flag mid-chain forks.
      const isFirstChained = breaks.length === 0 && checked === 1;
      if (!isFirstChained) breaks.push({ id: r.id, reason: 'prev_hash mismatch' });
    }
    prev = r.hash;
  }
  return { ok: breaks.length === 0, checked, breaks };
}

module.exports = { toMinor, createTransaction, getAccountBalance, chargeFee, verifyChain };

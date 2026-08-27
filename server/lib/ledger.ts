// Double-entry ledger — immutable accounting foundation.
// Strict TypeScript wrapper: same runtime as ledger.js, with explicit types.
// Re-exports via ledger.js remain the runtime path for require('./ledger').
// This .ts file is the type-checked source for `npx tsc --noEmit`.
import type { Currency, LedgerAccountCode, LedgerSide } from '../types/domain';

export type LedgerEntryInput = {
  account: LedgerAccountCode | string;
  side: LedgerSide;
  amountMinor: number;
  currency?: Currency;
};

export type CreateTransactionOptions = {
  idempotencyKey: string;
  jobId?: number | null;
  payoutId?: number | null;
  description?: string | null;
  entries: LedgerEntryInput[];
};

export type LedgerTransactionResult = {
  id: number;
  idempotency_key: string;
  duplicate?: boolean;
};

export interface DbTrx {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>;
  prepare?: (sql: string) => {
    run: (...params: unknown[]) => Promise<{ lastInsertRowid?: unknown; changes?: number }> | { lastInsertRowid?: unknown; changes?: number };
    get?: (...params: unknown[]) => unknown;
    all?: (...params: unknown[]) => unknown;
  };
  exec?: (sql: string) => Promise<void>;
}

export interface DbClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>;
}

/**
 * Convert AED (major) to fils (minor) integer. 1 AED = 100 fils.
 */
export function toMinor(aed: number): number {
  return Math.round(Number(aed) * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

/**
 * Create a balanced double-entry transaction.
 * Validates that sum(DEBIT) === sum(CREDIT) in minor units before writing.
 * Idempotent on idempotencyKey (UNIQUE constraint).
 */
export async function createTransaction(
  trx: DbTrx,
  { idempotencyKey, jobId = null, payoutId = null, description = null, entries }: CreateTransactionOptions,
): Promise<LedgerTransactionResult> {
  if (!idempotencyKey) throw new Error('idempotencyKey required');
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('at least 2 entries required');

  // --- explicit balanced debit/credit validation (strictly typed) ---
  let debit: number = 0;
  let credit: number = 0;
  for (const e of entries) {
    if (!e.account || !e.side || !Number.isFinite(e.amountMinor) || e.amountMinor <= 0) {
      throw new Error(`invalid entry: ${JSON.stringify(e)}`);
    }
    if (e.side === 'DEBIT') {
      debit += e.amountMinor;
    } else if (e.side === 'CREDIT') {
      credit += e.amountMinor;
    } else {
      throw new Error(`side must be DEBIT or CREDIT`);
    }
  }
  if (debit !== credit) {
    throw new Error(`unbalanced transaction: debit ${debit} != credit ${credit}`);
  }

  let txId: number | null = null;
  try {
    if (trx.prepare) {
      const prepared = trx.prepare(
        `INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?)`,
      );
      // prepared.run may be sync (sqlite) or async (pg shim)
      const res = (await prepared.run(idempotencyKey, jobId, payoutId, description)) as {
        lastInsertRowid?: unknown;
      };
      const raw = res?.lastInsertRowid;
      txId = typeof raw === 'number' ? raw : raw != null ? Number(raw) : null;
      if (!txId) {
        const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
        const found = row.rows[0]?.id as unknown;
        txId = found != null ? Number(found) : null;
      }
    } else {
      const r = await trx.query(
        `INSERT INTO ledger_transactions (idempotency_key, job_id, payout_id, description) VALUES (?,?,?,?)`,
        [idempotencyKey, jobId, payoutId, description],
      );
      const found = (r.rows?.[0] as Record<string, unknown> | undefined)?.id as unknown;
      txId = found != null ? Number(found) : null;
      if (!txId) {
        const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
        const fallback = row.rows[0]?.id as unknown;
        txId = fallback != null ? Number(fallback) : null;
      }
    }
    if (!txId) throw new Error('failed to create transaction');
  } catch (e) {
    const msg: string = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|duplicate key/i.test(msg)) {
      const row = await trx.query(`SELECT id FROM ledger_transactions WHERE idempotency_key=?`, [idempotencyKey]);
      const existing = row.rows[0]?.id as unknown;
      if (existing != null) {
        return { id: Number(existing), idempotency_key: idempotencyKey, duplicate: true };
      }
    }
    throw e;
  }

  for (const e of entries) {
    const currency: Currency = (e.currency as Currency) || 'AED';
    await trx.query(
      `INSERT INTO ledger_entries (transaction_id, account_code, amount_minor, currency, side) VALUES (?,?,?,?,?)`,
      [txId, e.account, e.amountMinor, currency, e.side],
    );
  }

  return { id: txId, idempotency_key: idempotencyKey };
}

/**
 * Derive current balance for an account: SUM(DEBIT) - SUM(CREDIT) in minor.
 */
export async function getAccountBalance(db: DbClient, accountCode: string): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount_minor ELSE -amount_minor END), 0) as balance FROM ledger_entries WHERE account_code=?`,
    [accountCode],
  );
  const bal: unknown = r.rows[0]?.balance;
  return Number(bal ?? 0);
}

// Keep CommonJS compatibility if this file is ever required via transpiled JS
// (runtime still uses ledger.js for require('./ledger')).

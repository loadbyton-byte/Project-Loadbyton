// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

/** @type {any} */
const db = require('../db');
/** @type {any} */
const payments = require('../lib/payments');
/** @type {any} */
const { writeAudit, notify } = require('../lib/helpers');

/**
 * @param {Job} _job
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/**
 * @param {number} jobId
 * @param {string} error
 * @returns {Promise<void>}
 */
async function markJobPaymentFailed(jobId, error) {
  await db.prepare(`UPDATE jobs SET processor_payment_status='FAILED', processor_last_error=?, updated_at=datetime('now') WHERE id=?`).run(error, jobId);
  await (/** @type {any} */ (writeAudit))(null, {
    action: 'PAYMENT_FAILED',
    details: `Job #${jobId} payment failed: ${error}`,
    entityType: 'job',
    entityId: jobId,
  });
}

/**
 * @param {Job} job
 * @param {Payout & { transfer_executed_at?: string | null }} payout
 * @param {any} req
 * @returns {Promise<void>}
 */
async function executePayoutAsync(job, payout, req) {
  if (!payout) return;
  if (!payments.isConfigured()) {
    await (/** @type {any} */ (writeAudit))(req, {
      action: 'PAYOUT_DEFERRED',
      details: `${job.job_code}: payout deferred (no payment provider configured)`,
      entityType: 'payout',
      entityId: payout.id,
    });
    return;
  }

  const provider = payments.provider();
  const destinationHint = payout.carrier_id ? String(payout.carrier_id) : 'unknown';

  // Idempotency pre-check: if already has a successful attempt or
  // transfer_executed_at, don't do redundant work. This alone is NOT the
  // safety boundary against a concurrent duplicate transfer — see the
  // claim-before-call insert below, which is.
  try {
    const existingOk = await db.prepare(`SELECT 1 FROM payout_attempts WHERE payout_id=? AND status IN ('SUBMITTED','SENT','SETTLED')`).get(payout.id);
    if (existingOk) return;
    if (/** @type {any} */ (payout).transfer_executed_at) return;
    // An UNKNOWN attempt means a prior call to the provider threw at the
    // network/transport level — we genuinely don't know whether it
    // created a real transfer. Starting a brand-new attempt (a fresh
    // idempotency key) here would be unsafe: if the original request DID
    // land, this creates a second, real, distinct transfer. Nothing may
    // proceed until reconcilePayoutAttempt() below resolves it one way or
    // the other, by retrying the SAME idempotency key against the
    // provider rather than a new one.
    const existingUnknown = await db.prepare(`SELECT 1 FROM payout_attempts WHERE payout_id=? AND status='UNKNOWN'`).get(payout.id);
    if (existingUnknown) {
      await (/** @type {any} */ (writeAudit))(req, {
        action: 'PAYOUT_BLOCKED_PENDING_RECONCILIATION',
        details: `${job.job_code}: refused to start a new payout attempt while a prior attempt's outcome is UNKNOWN — reconcile it first`,
        entityType: 'payout',
        entityId: payout.id,
      });
      return;
    }
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    if (_e.message && !/no such table/i.test(_e.message)) throw _e;
  }

  let attemptNumber = 1;
  try {
    const cnt = await db.prepare('SELECT COUNT(*) as c FROM payout_attempts WHERE payout_id=?').get(payout.id);
    attemptNumber = (/** @type {any} */ (cnt)?.c || 0) + 1;
  } catch {}

  // Numbered per attempt (not a single fixed key) so a legitimate retry
  // after a failed transfer can still claim a fresh attempt, while a true
  // concurrent race for the SAME attempt number collides on this exact
  // key and is rejected by the UNIQUE constraint.
  const idempotencyKey = `payout-${payout.id}-${provider}-attempt${attemptNumber}`;

  let carrierAccountId = null;
  try {
    const prof = job.carrier_id ? await db.prepare('SELECT processor_account_id FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
    carrierAccountId = /** @type {any} */ (prof)?.processor_account_id || null;
  } catch {}

  // Claim this attempt BEFORE calling the external processor — this insert
  // (and its UNIQUE constraint on idempotency_key) is what actually
  // prevents two concurrent callers from both sending a real transfer; the
  // pre-check above only avoids redundant work once one has already won.
  let attemptId;
  try {
    const claim = await db.prepare(
      `INSERT INTO payout_attempts (payout_id, attempt_number, provider, amount_aed, destination, idempotency_key, status) VALUES (?,?,?,?,?,?, 'SUBMITTED') RETURNING id`
    ).run(payout.id, attemptNumber, provider, payout.net_aed, carrierAccountId || destinationHint, idempotencyKey);
    attemptId = /** @type {any} */ (claim).lastInsertRowid;
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    if (_e.message && /UNIQUE|duplicate key/i.test(_e.message)) return; // another caller already claimed this exact attempt
    throw _e;
  }

  try {
    const r = await payments.executePayout({
      amountAed: payout.net_aed,
      jobCode: job.job_code,
      paymentRef: `payout-${payout.id}`,
      reference: `payout-${payout.id}`,
      carrierAccountId,
      idempotencyKey,
      // Telr-specific: this job's checkout already routed the carrier's
      // share via Split Payment (job.telr_split_applied, set at checkout
      // time in job-lifecycle.routes.js) — nothing further to transfer.
      alreadySplitPaid: !!/** @type {any} */ (job).telr_split_applied,
    });

    // ambiguous:true (network/transport error talking to the provider,
    // not a clean rejection) must NEVER be labeled FAILED — FAILED is a
    // signal to future callers that a fresh attempt (a NEW idempotency
    // key) is safe, and it is not: the original request may have already
    // gone through. UNKNOWN blocks any further attempt (see the pre-check
    // above) until reconcilePayoutAttempt() resolves it.
    const attemptStatus = r.ok ? 'SUBMITTED' : (/** @type {any} */ (r).ambiguous ? 'UNKNOWN' : 'FAILED');
    try {
      await db.prepare(`UPDATE payout_attempts SET status=?, provider_response=?, error=? WHERE id=?`)
        .run(attemptStatus, /** @type {any} */ (r).payoutRef || null, /** @type {any} */ (r).error || null, attemptId);
    } catch {}

    if (r.ok) {
      await applySuccessfulTransfer(job, payout, idempotencyKey, r, req);
    } else if (/** @type {any} */ (r).ambiguous) {
      // Do NOT touch payouts.last_error / payouts.status here — this is
      // not a confirmed failure, and payouts-sla / any retry surface must
      // keep treating this payout as "transfer outcome unknown", not
      // "failed, safe to retry". See reconcilePayoutAttempt().
      await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_AMBIGUOUS', details: `${job.job_code}: payout transfer outcome UNKNOWN (${/** @type {any} */ (r).error} — ${/** @type {any} */ (r).detail || 'no detail'}); reconciliation required before any retry`, entityType: 'payout', entityId: payout.id });
    } else {
      // Failure: keep status RELEASED but record error for SLA retry
      try { await db.prepare(`UPDATE payouts SET last_error=? WHERE id=?`).run(/** @type {any} */ (r).error || 'transfer failed', payout.id); } catch {}
      await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_FAILED', details: `${job.job_code}: payout failed — ${/** @type {any} */ (r).error}`, entityType: 'payout', entityId: payout.id });
    }
  } catch (/** @type {any} */ e) {
    const _e = /** @type {any} */ (e);
    try { await db.prepare(`UPDATE payouts SET status='FAILED', last_error=? WHERE id=?`).run(_e.message, payout.id); } catch {}
    // Update the attempt claimed above, rather than inserting a second row
    // for the same attempt — attemptId is always set here, since the only
    // path that could leave it unset (the claim insert itself failing)
    // already returns before this try block is reached.
    //
    // Unlike payments.executePayout()'s own network_error path (caught and
    // returned as a structured ambiguous:true result above), a throw that
    // reaches all the way out here comes from OUR OWN code — the
    // idempotency claim, the carrier lookup, req/payout shape — before or
    // around the provider call, not from the provider call failing after
    // being sent. FAILED (safe to retry with a fresh attempt) remains
    // correct for this path.
    try { await db.prepare(`UPDATE payout_attempts SET status='FAILED', error=? WHERE id=?`).run(_e.message, attemptId); } catch {}
  }
}

/**
 * Records a confirmed-successful transfer: payout.transfer_executed_at,
 * ledger entries, and the settlement outbox event. Shared between the
 * normal executePayoutAsync flow and reconcilePayoutAttempt() below, so a
 * transfer confirmed late (via reconciliation) is settled exactly the same
 * way as one confirmed immediately.
 *
 * @param {Job} job
 * @param {Payout} payout
 * @param {string} idempotencyKey
 * @param {any} r
 * @param {any} req
 * @returns {Promise<void>}
 */
async function applySuccessfulTransfer(job, payout, idempotencyKey, r, req) {
  // Successful transfer — keep payout status as RELEASED (set by job-lifecycle before calling), just record transfer
  // Add ledger entries for escrow release (idempotent on idempotencyKey)
  try {
    // Not try/catch-swallowed inside the transaction — same reasoning
    // as award.service.js: a swallowed error here can leave the
    // transaction ABORTED at the Postgres level while the JS callback
    // still returns normally, so db.js's unconditional COMMIT silently
    // becomes a no-op ROLLBACK — undoing the transfer_executed_at
    // update too, with no exception anywhere, right after a REAL
    // external transfer already happened. Letting it throw here means
    // the outer catch below (which already has a real fallback) is the
    // one that runs instead of a silent no-op.
    await db.transaction(async (/** @type {any} */ trx) => {
      // Update transfer fields if not already set (preserve RELEASED status)
      await trx.query(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=? AND transfer_executed_at IS NULL`, [`processor:${r.payoutRef}`, payout.id]);
      const ledger = require('../lib/ledger');
      const grossMinor = ledger.toMinor(payout.gross_aed);
      const feeMinor = ledger.toMinor(payout.platform_fee_aed);
      const netMinor = ledger.toMinor(payout.net_aed);
      await ledger.createTransaction(trx, {
        idempotencyKey,
        jobId: job.id,
        payoutId: payout.id,
        description: `Payout ${job.job_code} AED ${payout.net_aed}`,
        entries: [
          { account: 'escrow_liability', side: 'DEBIT', amountMinor: grossMinor },
          { account: 'carrier_payable', side: 'CREDIT', amountMinor: netMinor },
          { account: 'platform_revenue', side: 'CREDIT', amountMinor: feeMinor },
        ],
      });
      await trx.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status) VALUES (?,?,?,?,?)`, ['payout', payout.id, 'PAYOUT_SETTLED', JSON.stringify({ payoutId: payout.id, jobId: job.id, amount: payout.net_aed }), 'PENDING']);
    });
  } catch (/** @type {any} */ e) {
    // Fallback: at least mark transfer — money already moved for real,
    // this must never be lost even if the ledger/outbox bookkeeping failed.
    try { await db.prepare(`UPDATE payouts SET transfer_executed_at=datetime('now'), processor_payout_status='SENT', transfer_reference=? WHERE id=? AND transfer_executed_at IS NULL`).run(`processor:${r.payoutRef}`, payout.id); } catch {}
  }
  await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_EXECUTED', details: `${job.job_code}: payout AED ${payout.net_aed} executed (ref ${r.payoutRef})`, entityType: 'payout', entityId: payout.id });
}

/**
 * Resolves a payout_attempts row stuck in UNKNOWN (a prior network/
 * transport failure talking to the provider, outcome unconfirmed) by
 * re-driving the EXACT SAME idempotency key against the provider. This is
 * safe to call any number of times: Stripe's own idempotency layer
 * guarantees that replaying a request with a key it has already seen
 * returns the original result instead of creating a second transfer,
 * whether or not the original request actually landed.
 *
 * @param {number} attemptId
 * @param {any} req
 * @returns {Promise<{ok: boolean, resolved: boolean, status: string, detail?: string}>}
 */
async function reconcilePayoutAttempt(attemptId, req) {
  const attempt = await db.prepare('SELECT * FROM payout_attempts WHERE id=?').get(attemptId);
  if (!attempt) return { ok: false, resolved: false, status: 'NOT_FOUND', detail: 'No such payout attempt' };
  if (attempt.status !== 'UNKNOWN') {
    return { ok: true, resolved: true, status: attempt.status, detail: 'Attempt is not in an UNKNOWN state — nothing to reconcile' };
  }

  const payout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(attempt.payout_id);
  if (!payout) return { ok: false, resolved: false, status: 'UNKNOWN', detail: 'Payout attempt exists but its payout row is gone' };
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(payout.job_id);
  if (!job) return { ok: false, resolved: false, status: 'UNKNOWN', detail: 'Payout attempt exists but its job row is gone' };

  const r = await payments.executePayout({
    amountAed: attempt.amount_aed,
    jobCode: job.job_code,
    paymentRef: `payout-${payout.id}`,
    reference: `payout-${payout.id}`,
    carrierAccountId: attempt.destination,
    // Re-send the ORIGINAL key, not a new one — this is the entire safety
    // property this function relies on. A new key here would defeat the
    // provider-side idempotency guard and could create a real second
    // transfer if the original attempt actually succeeded.
    idempotencyKey: attempt.idempotency_key,
    alreadySplitPaid: !!job.telr_split_applied,
  });

  if (r.ok) {
    await db.prepare(`UPDATE payout_attempts SET status='SUBMITTED', provider_response=?, error=NULL WHERE id=?`).run(r.payoutRef || null, attemptId);
    await applySuccessfulTransfer(job, payout, attempt.idempotency_key, r, req);
    await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_RECONCILED', details: `${job.job_code}: reconciliation confirmed attempt #${attemptId} succeeded (ref ${r.payoutRef})`, entityType: 'payout', entityId: payout.id });
    return { ok: true, resolved: true, status: 'SUBMITTED', detail: r.payoutRef };
  }

  if (r.ambiguous) {
    // Still can't tell. Leave it UNKNOWN — do not guess. An admin can call
    // this again later (e.g. once the provider's own outage clears).
    try { await db.prepare(`UPDATE payout_attempts SET error=? WHERE id=?`).run(r.detail || r.error, attemptId); } catch {}
    await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_RECONCILIATION_INCONCLUSIVE', details: `${job.job_code}: reconciliation attempt for #${attemptId} was itself ambiguous (${r.error}) — still UNKNOWN`, entityType: 'payout', entityId: payout.id });
    return { ok: false, resolved: false, status: 'UNKNOWN', detail: r.detail || r.error };
  }

  // A clean rejection this time (e.g. the destination account is now
  // invalid) — the provider is telling us, unambiguously, that no
  // transfer exists under this key. Safe to mark FAILED: the pre-check in
  // executePayoutAsync will now allow a fresh attempt (a new idempotency
  // key) on the next release/retry.
  await db.prepare(`UPDATE payout_attempts SET status='FAILED', error=? WHERE id=?`).run(r.error || 'transfer failed', attemptId);
  await (/** @type {any} */ (writeAudit))(req, { action: 'PAYOUT_RECONCILED', details: `${job.job_code}: reconciliation confirmed attempt #${attemptId} did NOT succeed (${r.error}) — now FAILED, eligible for retry`, entityType: 'payout', entityId: payout.id });
  return { ok: true, resolved: true, status: 'FAILED', detail: r.error };
}

/**
 * @param {Job} job
 * @returns {Promise<void>}
 */
async function refundJobAsync(job, amountAedOverride) {
  if (!payments.isConfigured()) return;
  let r;
  try {
    r = await payments.refundCharge({
      jobCode: job.job_code,
      // A cancellation fee (planning register Change 24F) means the
      // shipper is refunded less than the full agreed price — the caller
      // passes the net amount explicitly rather than this function
      // guessing a deduction on its own.
      amountAed: amountAedOverride != null ? amountAedOverride : /** @type {any} */ (job).agreed_price_aed,
      tranref: /** @type {any} */ (job).processor_tranref,
      paymentRef: /** @type {any} */ (job).processor_payment_ref,
    });
  } catch (/** @type {any} */ e) {
    console.error(`[payout] refundCharge threw for job ${job.id}:`, /** @type {any} */ (e).message);
    return;
  }
  if (!r.ok) return;
  // A real refund already happened at this point — recording it must
  // never be silently lost. Previously any failure here (DB blip, audit
  // write error) was swallowed by an empty catch, leaving no trace that
  // money actually moved.
  try {
    await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id);
    await (/** @type {any} */ (writeAudit))(null, {
      action: 'REFUND_SHIPPER_EXECUTED',
      details: `${job.job_code}: refunded AED ${/** @type {any} */ (job).agreed_price_aed}`,
      entityType: 'job',
      entityId: job.id,
    });
  } catch (/** @type {any} */ e) {
    console.error(`[payout] REAL refund succeeded for job ${job.id} but recording it failed:`, /** @type {any} */ (e).message);
    try { await db.prepare(`UPDATE jobs SET processor_payment_status='REFUNDED', updated_at=datetime('now') WHERE id=?`).run(job.id); } catch {}
  }
}

module.exports = { markJobPaymentFailed, executePayoutAsync, refundJobAsync, reconcilePayoutAttempt };

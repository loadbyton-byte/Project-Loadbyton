import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Textarea } from '../../components/ui.jsx';
import { formatMoney } from '../../lib/constants.js';

// Commercial-logic audit finding: cancellation had no recorded reason at
// all — a shipper or carrier could cancel with one click and no trace of
// why, beyond a bare status change. Reason stays optional server-side
// (existing/other callers keep working), but this is the one place a
// human actually clicks "cancel," so it's the right place to ask —
// mirrors DisputePanel.jsx's reveal-a-reason-box pattern for consistency.
//
// Extended per the product-evolution brief: cancellation used to show the
// exact same generic "why?" box regardless of who's cancelling, what
// stage the job is at, or what actually happens next. The consequences
// below are read directly off job.service.js's real cancellation branch
// (escrow fee only after award + only for INSTANT-tier jobs, no fee at
// all for deferred NET_* terms, a reliability strike only when the
// CARRIER is the one cancelling after award) — not invented copy, so if
// that logic ever changes, this text will drift and need updating with it.
export default function CancelJobPanel({ job, actorRole, pendingBidCount = 0, label, variant = 'danger', onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancellationFeeBps, setCancellationFeeBps] = useState(null);

  const isAwarded = job.status !== 'OPEN' && job.status !== 'DRAFT';
  const isInstantTier = !job.payment_tier || job.payment_tier === 'INSTANT';
  const escrowActive = ['HELD', 'FUNDED'].includes(job.escrow_status);
  const feeApplies = isAwarded && isInstantTier && escrowActive;

  useEffect(() => {
    if (open && feeApplies && cancellationFeeBps === null) {
      api.publicMarket().then((d) => setCancellationFeeBps(d.market.cancellationFeeBpsAfterAward)).catch(() => {});
    }
  }, [open, feeApplies, cancellationFeeBps]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await api.setStatus(job.id, 'CANCELLED', reason.trim() || undefined);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button className="w-full" variant={variant} onClick={() => setOpen(true)}>{label}</Button>
    );
  }

  const consequences = [];
  if (!isAwarded) {
    if (pendingBidCount > 0) {
      consequences.push(`${pendingBidCount} pending bid${pendingBidCount === 1 ? '' : 's'} will be withdrawn. No transporter has been assigned yet, so no fee applies.`);
    } else {
      consequences.push('This job hasn\'t been awarded yet — cancelling it costs nothing and doesn\'t affect any transporter.');
    }
  } else if (actorRole === 'CARRIER') {
    consequences.push('The shipper will be notified immediately and the job reopens for a new award.');
    consequences.push('Cancelling after being awarded is recorded against your reliability score.');
  } else if (feeApplies) {
    const feeAmount = cancellationFeeBps != null ? Math.round((job.agreed_price_aed || 0) * cancellationFeeBps / 10000 * 100) / 100 : null;
    consequences.push(
      feeAmount != null
        ? `The held payment (${formatMoney(job.agreed_price_aed, job.currency)}) will be released back to you, minus a cancellation fee of ${formatMoney(feeAmount, job.currency)} (${(cancellationFeeBps / 100).toFixed(1)}%).`
        : 'The held payment will be released back to you, minus a cancellation fee (rate loading…).'
    );
    if (job.escrow_status === 'FUNDED') consequences.push('If a card payment was already captured, the refund typically arrives within 5–7 business days.');
  } else if (job.payment_tier && job.payment_tier !== 'INSTANT') {
    consequences.push(`This job is on deferred payment terms — cancelling clears the ${formatMoney(job.agreed_price_aed, job.currency)} draw against your credit line. No cancellation fee applies to deferred-term jobs.`);
  } else {
    consequences.push('The transporter assigned to this job will be notified immediately.');
  }

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--status-danger-bg)' }}>
      <p className="mb-2 text-sm font-medium text-ink">{label}?</p>
      <ul className="mb-3 space-y-1 text-xs text-ink-secondary" style={{ listStyle: 'disc', paddingLeft: '1.1rem' }}>
        {consequences.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
      <Textarea rows={2} placeholder="Optional, but helps everyone if something goes wrong later..." value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-2 text-sm text-status-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button variant={variant} onClick={confirm} loading={busy}>Confirm cancellation</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Back</Button>
      </div>
    </div>
  );
}

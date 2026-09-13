import React, { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Textarea } from '../../components/ui.jsx';

// Commercial-logic audit finding: cancellation had no recorded reason at
// all — a shipper or carrier could cancel with one click and no trace of
// why, beyond a bare status change. Reason stays optional server-side
// (existing/other callers keep working), but this is the one place a
// human actually clicks "cancel," so it's the right place to ask —
// mirrors DisputePanel.jsx's reveal-a-reason-box pattern for consistency.
export default function CancelJobPanel({ jobId, label, variant = 'danger', onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await api.setStatus(jobId, 'CANCELLED', reason.trim() || undefined);
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

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--status-danger-bg)' }}>
      <p className="mb-2 text-sm font-medium text-ink">{label} — why?</p>
      <Textarea rows={2} placeholder="Optional, but helps everyone if something goes wrong later..." value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-2 text-sm text-status-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button variant={variant} onClick={confirm} loading={busy}>Confirm cancellation</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Back</Button>
      </div>
    </div>
  );
}

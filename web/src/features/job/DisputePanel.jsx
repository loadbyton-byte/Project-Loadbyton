import React, { useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { Button, Input, Textarea, Label, Badge } from '../../components/ui.jsx';

export default function DisputePanel({ jobId, onDone }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.openDispute(jobId, reason);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border bg-white p-4">
      <h3 className="font-semibold text-ink mb-2">Open dispute</h3>
      <p className="text-sm text-ink-muted mb-3">This will freeze escrow and notify both parties. An admin will review and resolve.</p>
      <Textarea rows={3} placeholder="Describe the issue clearly..." value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-2 text-sm text-status-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={submit} loading={busy}>Open dispute</Button>
      </div>
    </div>
  );
}
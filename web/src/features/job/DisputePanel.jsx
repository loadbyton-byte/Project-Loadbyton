import React, { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Textarea, Select, Label } from '../../components/ui.jsx';

// 7 typed dispute categories, each auto-assembling its own relevant
// evidence for the admin instead of a single free-text reason — see the
// planning register's Change 26.
const DISPUTE_TYPES = [
  { value: 'PRICE', label: 'Price / extra charges' },
  { value: 'DELAY_DEMURRAGE', label: 'Delay / demurrage' },
  { value: 'DAMAGE_SHORTAGE', label: 'Damage / shortage' },
  { value: 'MISSING_DOCS', label: 'Missing documents' },
  { value: 'NO_SHOW', label: 'No-show / ghost job' },
  { value: 'PAYMENT_VAT', label: 'Payment / VAT' },
  { value: 'FRAUD_IDENTITY', label: 'Fraud / identity' },
];

export default function DisputePanel({ jobId, onDone }) {
  const [disputeType, setDisputeType] = useState('PRICE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.disputeJob(jobId, reason, disputeType);
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
      <p className="text-sm text-ink-muted mb-3">This will freeze escrow and notify both parties. An admin will review within 48 hours.</p>
      <Label>Dispute type</Label>
      <Select value={disputeType} onChange={(e) => setDisputeType(e.target.value)} className="mb-3">
        {DISPUTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      {disputeType === 'DAMAGE_SHORTAGE' && <p className="text-xs text-ink-muted mb-2">Requires at least one EIR photo already on file for this job.</p>}
      {disputeType === 'NO_SHOW' && <p className="text-xs text-ink-muted mb-2">Requires at least one recorded location ping for this job.</p>}
      <Textarea rows={3} placeholder="Describe the issue clearly..." value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-2 text-sm text-status-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={submit} loading={busy}>Open dispute</Button>
      </div>
    </div>
  );
}

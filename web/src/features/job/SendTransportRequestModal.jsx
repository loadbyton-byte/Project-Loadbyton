import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Input, Label, Modal, Select } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';

// Broker-side trigger for POST /api/jobs/:id/direct-assign
// (server/routes/broker.routes.js) — the endpoint and the carrier-side
// accept/decline UI (MyBids.jsx's acceptAssignment) already existed, but
// nothing on the broker side ever called it. Framed as a request the
// transporter must accept, not an automatic assignment — the backend
// enforces this too (carrier_acceptance_required=1; the job stays OPEN
// until the transporter accepts).
export default function SendTransportRequestModal({ job, onClose, onSent }) {
  const { addToast } = useToasts();
  const [carriers, setCarriers] = useState(null);
  const [carrierId, setCarrierId] = useState('');
  const [amountAed, setAmountAed] = useState(job?.max_budget_aed || '');
  const [etaAt, setEtaAt] = useState('');
  const [spreadBps, setSpreadBps] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listBrokerCarriers().then((d) => setCarriers(d.carriers || [])).catch(() => setCarriers([]));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!carrierId) { setError('Choose a transporter from your roster.'); return; }
    const amount = Number(amountAed);
    if (!amount || amount <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true);
    try {
      await api.directAssign(job.id, {
        carrierId: Number(carrierId),
        amountAed: amount,
        etaAt: etaAt || undefined,
        ...(spreadBps !== '' ? { brokerSpreadBps: Number(spreadBps) } : {}),
      });
      addToast({ type: 'status_change', title: 'Transport request sent', body: `${job.job_code}: awaiting the transporter's acceptance.` });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Send transport request">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">
          {job.job_code} stays open until <strong>{carriers?.find((c) => String(c.carrier_id) === carrierId)?.company_name || 'the transporter'}</strong> accepts or declines — this doesn't award the job automatically.
        </p>
        <div>
          <Label htmlFor="sta-carrier">Transporter</Label>
          {carriers === null ? (
            <p className="mt-1 text-sm text-ink-muted">Loading your roster…</p>
          ) : carriers.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Your roster is empty — add a verified transporter first from the Transporter Roster page.</p>
          ) : (
            <Select id="sta-carrier" required value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">Choose from your roster…</option>
              {carriers.map((c) => (
                <option key={c.carrier_id} value={c.carrier_id}>{c.company_name || c.carrier_email}</option>
              ))}
            </Select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="sta-amount">Amount (AED)</Label>
            <Input id="sta-amount" type="number" min="1" required value={amountAed} onChange={(e) => setAmountAed(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sta-eta">ETA (optional)</Label>
            <Input id="sta-eta" type="datetime-local" value={etaAt} onChange={(e) => setEtaAt(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="sta-spread">Your spread, bps (optional)</Label>
          <Input id="sta-spread" type="number" min="0" max="2000" step="10" value={spreadBps} onChange={(e) => setSpreadBps(e.target.value)} placeholder="Defaults to 0 if left blank" />
        </div>
        {error && (
          <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>{error}</p>
        )}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={busy} className="flex-1" disabled={carriers?.length === 0}>Send request</Button>
        </div>
      </form>
    </Modal>
  );
}

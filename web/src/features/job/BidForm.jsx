import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { EQUIPMENT_TYPES, formatAED, ANCILLARY_CHARGE_LABELS, paymentTermLabel } from '../../lib/constants.js';
import { Button, Input, Label, Select, Textarea, Badge } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { IconClose, IconWallet } from '../../components/icons.jsx';
import TimeSlotPicker from '../../components/TimeSlotPicker.jsx';

export default function BidForm({ jobId, verified, defaultEquipment, paymentTier, onDone }) {
  const { addToast } = useToasts();
  const [form, setForm] = useState({
    amount: '',
    currency: 'AED',
    etaAt: '',
    truckType: defaultEquipment || EQUIPMENT_TYPES[0],
    notes: '',
  });
  // Anticipated ancillary charges declared up front, at bid time — the
  // shipper reviews these alongside the price for every bidder, instead
  // of only discovering them after picking one bid to negotiate with.
  // Still refinable in the pre-award discussion (server/routes/bids.routes.js's
  // negotiation/ancillary-charges endpoints) once the shipper picks a bid.
  const [ancillaryCharges, setAncillaryCharges] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function addCharge() {
    setAncillaryCharges([...ancillaryCharges, { chargeType: 'SALIK', amountAed: '' }]);
  }
  function updateCharge(i, patch) {
    setAncillaryCharges(ancillaryCharges.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCharge(i) {
    setAncillaryCharges(ancillaryCharges.filter((_, idx) => idx !== i));
  }

  useEffect(() => {
    if (!verified) {
      addToast({ type: 'system_message', title: 'Account not verified', body: 'Please complete your profile verification before bidding.' });
    }
  }, [verified]);

  async function submit(e) {
    e.preventDefault();
    if (!verified) {
      setError('Your account must be verified to place bids.');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setError('Please enter a valid bid amount.');
      return;
    }
    if (!form.etaAt) {
      setError('Please choose an ETA date/time.');
      return;
    }
    const cleanCharges = ancillaryCharges.filter((c) => c.chargeType && Number(c.amountAed) > 0);
    if (ancillaryCharges.some((c) => c.chargeType && !(Number(c.amountAed) > 0))) {
      setError('Every ancillary charge needs a valid amount, or remove it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.placeBid(jobId, {
        amountAed: Number(form.amount),
        etaAt: new Date(form.etaAt).toISOString(),
        truckType: form.truckType,
        notes: form.notes,
        ancillaryCharges: cleanCharges.map((c) => ({ chargeType: c.chargeType, amountAed: Number(c.amountAed) })),
      });
      addToast({ type: 'bid', title: 'Bid placed', body: `Your bid of ${formatAED(form.amount)} was submitted.` });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-ink">Place your bid</h3>
        <Badge color="accent">{formatAED(form.amount || 0)}</Badge>
      </div>
      {/* Payment terms are fixed by the shipper at posting, not negotiable
          per-bid — shown here, the last thing a carrier sees before
          submitting, so both sides are knowingly on the same terms before
          any agreement forms (not editable; informational only). */}
      {paymentTier && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-subtle)' }}>
          <IconWallet size={16} style={{ color: 'var(--brand-accent)' }} />
          <span className="text-ink-secondary">Payment terms:</span>
          <span className="font-semibold text-ink">{paymentTermLabel(paymentTier)}</span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Bid amount (AED)</Label>
          <Input type="number" min="1" step="1" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div>
          <Label>Currency</Label>
          <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="AED">AED</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Truck type</Label>
          <Select value={form.truckType} onChange={(e) => setForm({ ...form, truckType: e.target.value })}>
            {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <TimeSlotPicker label="ETA" required value={form.etaAt} onChange={(v) => setForm({ ...form, etaAt: v })} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any special requirements or notes for the shipper" />
          <p className="mt-1 text-xs text-ink-muted">Driver details aren't shared at bid time — you'll add your assigned driver after the shipper awards you this job.</p>
        </div>
        <div className="sm:col-span-2">
          <Label>Anticipated extra charges (optional)</Label>
          <p className="mt-0.5 text-xs text-ink-muted">Salik, e-token, demurrage/waiting, inspection waiting — declared up front so the shipper sees your full expected cost before deciding, not after.</p>
          <div className="mt-2 space-y-2">
            {ancillaryCharges.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={c.chargeType} onChange={(e) => updateCharge(i, { chargeType: e.target.value })} className="flex-1">
                  {Object.entries(ANCILLARY_CHARGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Input type="number" min="1" placeholder="AED" value={c.amountAed} onChange={(e) => updateCharge(i, { amountAed: e.target.value })} className="w-28" />
                <button type="button" onClick={() => removeCharge(i)} className="text-ink-muted hover:text-status-danger" aria-label="Remove charge"><IconClose size={16} /></button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={addCharge} className="mt-2">+ Add a charge</Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-status-danger">{error}</p>}
      <Button type="submit" className="w-full" variant="accent" loading={busy}>Submit bid</Button>
    </form>
  );
}
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { CONTAINER_EQUIPMENT, EQUIPMENT_TYPES, formatAED } from '../../lib/constants.js';
import { Button, Input, Label, Select, Textarea, Badge } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';

export default function BidForm({ jobId, verified, defaultEquipment, onDone }) {
  const { user } = useAuth();
  const { addToast } = useToasts();
  const [form, setForm] = useState({
    amount: '',
    currency: 'AED',
    etaMinutes: '',
    etaAt: '',
    truckType: defaultEquipment || EQUIPMENT_TYPES[0],
    driverName: user.profile?.company_name || '',
    driverPhone: user.profile?.phone || '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    setBusy(true);
    setError('');
    try {
      await api.bidJob(jobId, { amount: Number(form.amount), ...form });
      addToast({ type: 'bid', title: 'Bid placed', body: `Your bid of ${formatAED(form.amount)} AED was submitted.` });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-ink">Place your bid</h3>
        <Badge color="accent">{formatAED(form.amount || 0)}</Badge>
      </div>
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
        <div>
          <Label>ETA (minutes)</Label>
          <Input type="number" min="1" value={form.etaMinutes} onChange={(e) => setForm({ ...form, etaMinutes: e.target.value })} placeholder="e.g. 120" />
        </div>
        <div>
          <Label>ETA date/time</Label>
          <input type="datetime-local" className="input" value={form.etaAt} onChange={(e) => setForm({ ...form, etaAt: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Label>Driver name</Label>
          <Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} placeholder="e.g. Ahmed Al Mansoori" />
        </div>
        <div className="sm:col-span-2">
          <Label>Driver phone (UAE format)</Label>
          <Input value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} placeholder="05XXXXXXXX" />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any special requirements or notes for the shipper" />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-status-danger">{error}</p>}
      <Button className="w-full" variant="accent" onClick={() => {}} loading={busy}>Submit bid</Button>
    </form>
  );
}
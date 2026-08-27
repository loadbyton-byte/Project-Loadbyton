import React, { useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { CONTAINER_EQUIPMENT, TERMINALS, AREAS, EQUIPMENT_TYPES, formatLabel } from '../../lib/constants.js';
import { Button, Card, Input, Label, Select, Textarea } from '../../components/ui.jsx';

function toDatetimeLocal(raw) {
  if (!raw) return '';
  return raw.replace(' ', 'T').slice(0, 16);
}

export default function JobEditForm({ job, onDone, onCancel }) {
  const [form, setForm] = useState({
    shipmentType: job.shipment_type || 'IMPORT',
    loadingLocation: job.loading_location || '',
    deliveryLocation: job.delivery_location || '',
    importPickupTerminal: job.import_pickup_terminal || job.pickup_terminal,
    importUnloadingLocation: job.import_unloading_location || job.delivery_area,
    importEmptyReturnLocation: job.import_empty_return_location || 'JAFZA_DEPOT',
    exportEmptyPickupLocation: job.export_empty_pickup_location || 'JAFZA_DEPOT',
    exportLoadingLocation: job.export_loading_location || job.delivery_area,
    exportDepositTerminal: job.export_deposit_terminal || job.pickup_terminal,
    pickupTerminal: job.pickup_terminal,
    deliveryArea: job.delivery_area,
    deliveryAddress: job.delivery_address,
    containerNumber: job.container_number || '',
    readyAt: toDatetimeLocal(job.ready_at),
    deadline: toDatetimeLocal(job.deadline),
    targetPriceAed: job.max_budget_aed ?? '',
    cargoWeightTons: job.cargo_weight_tons ?? '',
    notes: job.notes || '',
    containerCount: job.container_count,
    truckCount: job.truck_count,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toDatetimeLocal(raw) {
    if (!raw) return '';
    return raw.replace(' ', 'T').slice(0, 16);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.editJob(job.id, {
        ...form,
        targetPriceAed: form.targetPriceAed === '' ? undefined : Number(form.targetPriceAed),
        cargoWeightTons: form.cargoWeightTons === '' ? undefined : Number(form.cargoWeightTons),
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Shipment direction</Label>
        <div className="mt-1 flex rounded-lg border p-1" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-subtle)' }}>
          <button type="button" onClick={() => setForm({ ...form, shipmentType: 'IMPORT' })} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${form.shipmentType === 'IMPORT' ? 'bg-white shadow text-ink' : 'text-ink-muted'}`}>Import</button>
          <button type="button" onClick={() => setForm({ ...form, shipmentType: 'EXPORT' })} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${form.shipmentType === 'EXPORT' ? 'bg-white shadow text-ink' : 'text-ink-muted'}`}>Export</button>
        </div>
      </div>
      {form.shipmentType === 'LOCAL' ? (
        <>
          <div>
            <Label>Loading location</Label>
            <Input value={form.loadingLocation} onChange={(e) => setForm({ ...form, loadingLocation: e.target.value, pickupTerminal: e.target.value })} />
          </div>
          <div>
            <Label>Delivery location</Label>
            <Input value={form.deliveryLocation} onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value, deliveryArea: e.target.value })} />
          </div>
        </>
      ) : form.shipmentType === 'IMPORT' ? (
        <>
          <div>
            <Label>Container pickup at terminal</Label>
            <Select value={form.importPickupTerminal} onChange={(e) => setForm({ ...form, importPickupTerminal: e.target.value, pickupTerminal: e.target.value })}>
              {TERMINALS.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
            </Select>
          </div>
          <div>
            <Label>Unloading location</Label>
            <Select value={form.importUnloadingLocation} onChange={(e) => setForm({ ...form, importUnloadingLocation: e.target.value, deliveryArea: e.target.value })}>
              {AREAS.map((a) => <option key={a} value={a}>{formatLabel(a)}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Empty return depot</Label>
            <Select value={form.importEmptyReturnLocation} onChange={(e) => setForm({ ...form, importEmptyReturnLocation: e.target.value })}>
              {['JAFZA_DEPOT','AL_QUSAIS_DEPOT','KHALIFA_DEPOT','SHARJAH_DEPOT','FUJAIRAH_DEPOT','DIP_DEPOT'].map((d) => <option key={d} value={d}>{d.replace('_',' ')}</option>)}
            </Select>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Empty pickup depot</Label>
            <Select value={form.exportEmptyPickupLocation} onChange={(e) => setForm({ ...form, exportEmptyPickupLocation: e.target.value })}>
              {['JAFZA_DEPOT','AL_QUSAIS_DEPOT','KHALIFA_DEPOT','SHARJAH_DEPOT','FUJAIRAH_DEPOT','DIP_DEPOT'].map((d) => <option key={d} value={d}>{d.replace('_',' ')}</option>)}
            </Select>
          </div>
          <div>
            <Label>Loading location</Label>
            <Select value={form.exportLoadingLocation} onChange={(e) => setForm({ ...form, exportLoadingLocation: e.target.value, deliveryArea: e.target.value })}>
              {AREAS.map((a) => <option key={a} value={a}>{formatLabel(a)}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Deposit terminal</Label>
            <Select value={form.exportDepositTerminal} onChange={(e) => setForm({ ...form, exportDepositTerminal: e.target.value, pickupTerminal: e.target.value })}>
              {TERMINALS.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
            </Select>
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <Label>Delivery address detail</Label>
        <Input required value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} />
      </div>
      <div>
        <Label>Cargo weight (tons)</Label>
        <Input type="number" min="0" step="0.5" value={form.cargoWeightTons} onChange={(e) => setForm({ ...form, cargoWeightTons: e.target.value })} placeholder="e.g. 24" />
      </div>
      {CONTAINER_EQUIPMENT.includes(job.equipment_type) && (
        <div>
          <Label>Container #</Label>
          <Input value={form.containerNumber} onChange={(e) => setForm({ ...form, containerNumber: e.target.value })} />
        </div>
      )}
      <div>
        <Label>Ready at</Label>
        <Input type="datetime-local" required value={form.readyAt} onChange={(e) => setForm({ ...form, readyAt: e.target.value })} />
      </div>
      <div>
        <Label>Deadline</Label>
        <Input type="datetime-local" required value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
      </div>
      <div>
        <Label>Target price (AED, per trip)</Label>
        <Input type="number" min="0" value={form.targetPriceAed} onChange={(e) => setForm({ ...form, targetPriceAed: e.target.value })} />
        <p className="mt-1 text-xs text-ink-muted">What you're willing to pay for this trip — bids above it still appear, just flagged.</p>
      </div>
      {CONTAINER_EQUIPMENT.includes(job.equipment_type) && (
        <>
          <div>
            <Label>No. of containers</Label>
            <Input type="number" min="1" value={form.containerCount} onChange={(e) => setForm({ ...form, containerCount: e.target.value })} />
          </div>
          <div>
            <Label>No. of trucks</Label>
            <Input type="number" min="1" value={form.truckCount} onChange={(e) => setForm({ ...form, truckCount: e.target.value })} />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <Label>Notes</Label>
        <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      {error && <p className="sm:col-span-2 text-sm text-status-danger">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={busy}>Save changes</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
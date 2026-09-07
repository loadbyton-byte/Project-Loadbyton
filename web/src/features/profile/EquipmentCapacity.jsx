import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Input, Label, Card } from '../../components/ui.jsx';

// available_units is the live number (decrements on award, restores on
// delivery/cancellation); fleet_size stays the static declared total. The
// "mark N units externally engaged" control is the actual fix for a
// carrier who has privately committed some of their fleet outside the
// platform — see the planning register's Change 3.
export default function EquipmentCapacity() {
  const [capacity, setCapacity] = useState(null);
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api.getFleetCapacity().then(setCapacity).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function engage() {
    const n = Number(units);
    if (!n || n <= 0) return setError('Enter a valid number of units');
    setBusy(true);
    setError('');
    try {
      await api.externalEngageUnits(n, note);
      setUnits('');
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function release(n) {
    setBusy(true);
    try {
      await api.releaseExternalUnits(n);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!capacity) return null;
  const platformEngaged = capacity.fleet_size - capacity.available_units - capacity.externally_engaged_units;

  return (
    <Card className="mt-6">
      <Card.Header><Card.Title>Equipment capacity</Card.Title></Card.Header>
      <Card.Content>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="text-xs text-ink-muted">Fleet size</p><p className="text-lg font-semibold text-ink">{capacity.fleet_size}</p></div>
          <div><p className="text-xs text-ink-muted">On-platform (auto)</p><p className="text-lg font-semibold text-ink">{platformEngaged}</p></div>
          <div><p className="text-xs text-ink-muted">Externally engaged</p><p className="text-lg font-semibold text-ink">{capacity.externally_engaged_units}</p></div>
          <div><p className="text-xs text-ink-muted">Available now</p><p className="text-lg font-semibold" style={{ color: capacity.available_units <= 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{capacity.available_units}</p></div>
        </div>
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <Label>Mark units engaged with an outside (off-platform) client</Label>
          <p className="mt-0.5 text-xs text-ink-muted">If you've privately committed some of your fleet to a client outside Loadbyton, declare it here so your "available" number stays accurate.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input type="number" min="1" placeholder="Units" value={units} onChange={(e) => setUnits(e.target.value)} className="w-24" />
            <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 min-w-[160px]" />
            <Button type="button" variant="secondary" onClick={engage} loading={busy}>Mark engaged</Button>
          </div>
          {capacity.externally_engaged_units > 0 && (
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => release(capacity.externally_engaged_units)} loading={busy}>
              Release all {capacity.externally_engaged_units} externally-engaged units
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-status-danger">{error}</p>}
      </Card.Content>
    </Card>
  );
}

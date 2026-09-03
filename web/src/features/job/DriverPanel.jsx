import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Button, Card, Input, Label, Select } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';

// UAE mobile: 05XXXXXXXX (10 digits, starts with 05)
const UAE_PHONE_RE = /^05\d{8}$/;

function validateDriver(name, phone) {
  if (!name.trim() || name.trim().length < 2) {
    return 'Driver name must be at least 2 characters.';
  }
  const normalized = phone.replace(/[\s-]/g, '');
  if (!UAE_PHONE_RE.test(normalized)) {
    return 'Enter a valid UAE mobile number (05XXXXXXXX).';
  }
  return null;
}

export default function DriverPanel({ job, onDone }) {
  const { addToast } = useToasts();
  const [open, setOpen] = useState(false);
  const [drivers, setDrivers] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  // Manual entry stays available (not everyone has built a roster yet) —
  // shown by default when the roster is empty, opt-in via a toggle otherwise.
  const [manualMode, setManualMode] = useState(false);
  const [driverName, setDriverName] = useState(job?.assigned_driver_name || '');
  const [driverPhone, setDriverPhone] = useState(job?.assigned_driver_phone || '');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  useEffect(() => {
    if (!open || drivers !== null) return;
    api.listDrivers().then((d) => {
      setDrivers(d.drivers);
      setManualMode(d.drivers.length === 0);
      if (job?.assigned_driver_id && d.drivers.some((dr) => dr.id === job.assigned_driver_id)) {
        setSelectedDriverId(String(job.assigned_driver_id));
      } else if (d.drivers.length) {
        setSelectedDriverId(String(d.drivers[0].id));
      }
    }).catch(() => { setDrivers([]); setManualMode(true); });
  }, [open, drivers, job]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setFieldError('');
    try {
      let body;
      let assignedName;
      if (manualMode) {
        const err = validateDriver(driverName, driverPhone);
        if (err) { setFieldError(err); setBusy(false); return; }
        body = { driverName: driverName.trim(), driverPhone: driverPhone.replace(/[\s-]/g, '') };
        assignedName = driverName.trim();
      } else {
        if (!selectedDriverId) { setFieldError('Pick a driver from the list.'); setBusy(false); return; }
        body = { driverId: Number(selectedDriverId) };
        assignedName = drivers.find((d) => d.id === Number(selectedDriverId))?.name || 'Driver';
      }
      await api.updateDriver(job.id, body);
      addToast({
        type: 'status_change',
        title: job.assigned_driver_name ? 'Driver updated' : 'Driver added',
        body: `${assignedName} is now the assigned driver — the shipper can see it on this job.`,
      });
      setOpen(false);
      if (onDone) onDone();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not update driver', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!job) return null;

  if (!open) {
    return (
      <Card className="mb-6">
        <Card.Content className="flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-muted">Assigned driver</p>
            <p className="font-medium text-ink">
              {job.assigned_driver_name || (job.status === 'AWARDED' ? 'Add the driver — required before pickup' : 'Not set')}
            </p>
            {job.assigned_driver_phone && <p className="text-xs text-ink-muted">{job.assigned_driver_phone}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {job.assigned_driver_name ? 'Update' : 'Add driver'}
          </Button>
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <Card.Header>
        <Card.Title>Update driver</Card.Title>
      </Card.Header>
      <form onSubmit={submit} noValidate>
        <Card.Content className="space-y-3">
          {drivers === null ? (
            <p className="text-sm text-ink-muted">Loading your drivers…</p>
          ) : !manualMode ? (
            <>
              <div>
                <Label htmlFor="driver-select">Driver</Label>
                <Select id="driver-select" value={selectedDriverId} onChange={(e) => setSelectedDriverId(e.target.value)}>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} — {d.phone}</option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-ink-muted">
                Not on the list? <Link to="/drivers" className="font-medium text-brand-secondary hover:underline">Add a driver</Link>, then come back here — or{' '}
                <button type="button" className="font-medium text-brand-secondary hover:underline" onClick={() => setManualMode(true)}>type their details manually</button>.
              </p>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="driver-name">Driver name</Label>
                <Input
                  id="driver-name"
                  required
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  aria-invalid={fieldError && fieldError.toLowerCase().includes('name') ? 'true' : undefined}
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="driver-phone">Driver mobile (UAE)</Label>
                <Input
                  id="driver-phone"
                  required
                  placeholder="05XXXXXXXX"
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  inputMode="tel"
                  aria-invalid={fieldError && fieldError.toLowerCase().includes('mobile') ? 'true' : undefined}
                  autoComplete="tel"
                />
              </div>
              {drivers.length > 0 && (
                <p className="text-xs text-ink-muted">
                  <button type="button" className="font-medium text-brand-secondary hover:underline" onClick={() => setManualMode(false)}>Pick from your saved drivers instead</button>
                </p>
              )}
              <p className="text-xs text-ink-muted">
                Tip: save this driver once in <Link to="/drivers" className="font-medium text-brand-secondary hover:underline">My Drivers</Link> to pick them next time instead of retyping.
              </p>
            </>
          )}
          {fieldError && <p className="text-sm text-status-danger" role="alert">{fieldError}</p>}
        </Card.Content>
        <Card.Footer>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>Save</Button>
        </Card.Footer>
      </form>
    </Card>
  );
}

export { validateDriver };

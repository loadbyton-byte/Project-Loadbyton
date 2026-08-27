import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Card, Input, Label } from '../../components/ui.jsx';
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
  const [driverName, setDriverName] = useState(job?.assigned_driver_name || '');
  const [driverPhone, setDriverPhone] = useState(job?.assigned_driver_phone || '');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const err = validateDriver(driverName, driverPhone);
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      const normalizedPhone = driverPhone.replace(/[\s-]/g, '');
      await api.updateDriver(job.id, { driverName: driverName.trim(), driverPhone: normalizedPhone });
      addToast({
        type: 'status_change',
        title: job.assigned_driver_name ? 'Driver updated' : 'Driver added',
        body: `${driverName.trim()} is now the assigned driver — the shipper can see it on this job.`,
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

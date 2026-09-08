import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { uploadFile, UPLOAD_ACCEPT, driverDocumentUrl } from '../lib/upload.js';
import { Button, Card, Input, Label, EmptyState, ErrorState, Badge, Select } from '../components/ui.jsx';
import { IconPlus, IconTruck, IconFile, IconCheckCircle, IconWallet, IconChevronDown, IconChevronRight } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';

const empty = { name: '', phone: '', licenseNumber: '', licenseExpiry: '' };

export default function Drivers() {
  usePageTitle('My Drivers');
  const { addToast } = useToasts();
  const [drivers, setDrivers] = useState(null);
  const [driversError, setDriversError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState(null); // { driverId, docType }
  const [seatBusyFor, setSeatBusyFor] = useState(null); // driverId
  const [revealedSeat, setRevealedSeat] = useState(null); // { driverName, email, password } — shown once
  const [capacity, setCapacity] = useState(null);
  const [walletEntries, setWalletEntries] = useState([]);
  const [capacityBusy, setCapacityBusy] = useState(false);
  const [engageUnits, setEngageUnits] = useState('');
  const [engageNote, setEngageNote] = useState('');
  const [walletBusyFor, setWalletBusyFor] = useState(null);

  function load() {
    setDriversError('');
    Promise.all([
      api.listDrivers().then((d) => setDrivers(d.drivers)).catch((err) => { setDrivers([]); setDriversError(err.message); }),
      // GET /api/fleet/capacity returns {fleet_size, available_units,
      // externally_engaged_units, events} directly, not wrapped under a
      // `.capacity` key — setCapacity(c.capacity) was always feeding the
      // state `undefined`, so every field below silently fell back to its
      // '—' placeholder regardless of the account's real fleet data.
      api.getFleetCapacity().then((c) => setCapacity(c)).catch(() => setCapacity(null)),
      api.listDriverAssociateWallet().then((w) => setWalletEntries(w.entries || [])).catch(() => setWalletEntries([])),
    ]);
  }
  useEffect(load, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createDriver(form);
      setForm(empty);
      setShowForm(false);
      load();
      addToast({ type: 'status_change', title: 'Driver added', body: `${form.name} is now in your roster — pick them when assigning a job.` });
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not add driver', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeDriver(driver) {
    if (!window.confirm(`Remove ${driver.name} from your roster? Past jobs they were assigned to keep their record.`)) return;
    try {
      await api.deleteDriver(driver.id);
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not remove driver', body: err.message });
    }
  }

  async function createLogin(driver) {
    setSeatBusyFor(driver.id);
    try {
      const { email, password } = await api.addDriverSeat(driver.id);
      setRevealedSeat({ driverName: driver.name, email, password });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not create login', body: err.message });
    } finally {
      setSeatBusyFor(null);
    }
  }

  async function uploadDoc(driver, docType, file) {
    if (!file) return;
    setUploadingFor({ driverId: driver.id, docType });
    try {
      const uploaded = await uploadFile(file, (mimeType) => api.getDriverDocumentUploadUrl(driver.id, mimeType));
      await api.uploadDriverDocument(driver.id, { docType, ...uploaded });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not upload document', body: err.message });
    } finally {
      setUploadingFor(null);
    }
  }

  async function engageExternalUnits(e) {
    e.preventDefault();
    if (!engageUnits || Number(engageUnits) <= 0) return;
    setCapacityBusy(true);
    try {
      await api.externalEngageUnits(Number(engageUnits), engageNote);
      addToast({ type: 'status_change', title: 'Units engaged', body: `${engageUnits} unit(s) added to your fleet capacity.` });
      setEngageUnits('');
      setEngageNote('');
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not engage units', body: err.message });
    } finally {
      setCapacityBusy(false);
    }
  }

  async function releaseUnits(e) {
    e.preventDefault();
    if (!engageUnits || Number(engageUnits) <= 0) return;
    setCapacityBusy(true);
    try {
      await api.releaseExternalUnits(Number(engageUnits));
      addToast({ type: 'status_change', title: 'Units released', body: `${engageUnits} unit(s) released from your fleet capacity.` });
      setEngageUnits('');
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not release units', body: err.message });
    } finally {
      setCapacityBusy(false);
    }
  }

  async function markWalletPaid(driverId, entryId, amount) {
    if (!window.confirm(`Mark AED ${amount} as paid for this driver?`)) return;
    setWalletBusyFor(entryId);
    try {
      await api.markWalletEntryPaid(entryId);
      addToast({ type: 'status_change', title: 'Marked paid', body: `AED ${amount} marked as paid.` });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not mark paid', body: err.message });
    } finally {
      setWalletBusyFor(null);
    }
  }

  return (
    <div className="container-page py-6" dir="ltr">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">My Drivers</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Register drivers once with their license and vehicle documents — pick them from here when assigning a job, instead of retyping details every time.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="shrink-0">
          <IconPlus size={18} /> Add driver
        </Button>
      </div>

      {/* Fleet Capacity */}
      <Card className="mt-5">
        <Card.Header>
          <Card.Title>Fleet Capacity</Card.Title>
        </Card.Header>
        <Card.Content>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="col-span-3 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Total Fleet</p>
              <p className="mt-1 tabular font-display text-3xl font-bold text-ink">{capacity?.fleet_size ?? '—'}</p>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Available Units</p>
              <p className="mt-1 tabular font-display text-3xl font-bold" style={{ color: 'var(--status-success)' }}>{capacity?.available_units ?? '—'}</p>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Externally Engaged</p>
              <p className="mt-1 tabular font-display text-3xl font-bold text-brand-primary">{capacity?.externally_engaged_units ?? '—'}</p>
            </div>
          </div>
          <form onSubmit={engageExternalUnits} className="mt-4 flex flex-col sm:flex-row gap-2">
            <Input type="number" min="1" placeholder="Units to engage" value={engageUnits} onChange={(e) => setEngageUnits(e.target.value)} className="w-full sm:w-32" />
            <Input type="text" placeholder="Note (optional)" value={engageNote} onChange={(e) => setEngageNote(e.target.value)} className="w-full sm:w-48" />
            <Button type="submit" loading={capacityBusy} className="flex-1 sm:w-auto"><IconChevronRight size={16} className="mr-2" /> Engage Units</Button>
            <Button type="button" variant="secondary" onClick={releaseUnits} loading={capacityBusy} className="flex-1 sm:w-auto"><IconChevronDown size={16} className="mr-2" /> Release Units</Button>
          </form>
        </Card.Content>
      </Card>

      {/* Driver Associate Wallet */}
      <Card className="mt-5">
        <Card.Header>
          <Card.Title className="flex items-center gap-2"><IconWallet size={20} /> Driver Associate Wallet</Card.Title>
        </Card.Header>
        <Card.Content>
          {walletEntries.length === 0 ? (
            <p className="text-sm text-ink-muted">No pending driver associate payments.</p>
          ) : (
            <div className="space-y-3">
              {walletEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink">{entry.driver_name}</p>
                    <p className="text-sm text-ink-muted">Job: {entry.job_code} · {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular font-display text-lg font-bold text-ink">AED {entry.driver_share_aed}</span>
                    <Button size="sm" variant={entry.paid_at ? 'ghost' : 'accent'} loading={walletBusyFor === entry.id} onClick={() => markWalletPaid(entry.driver_id, entry.id, entry.driver_share_aed)} disabled={entry.paid_at}>
                      {entry.paid_at ? (<span><IconCheckCircle size={14} /> Paid</span>) : 'Mark Paid'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>

      {revealedSeat && (
        <Card className="mt-5" style={{ borderColor: 'var(--brand-accent)' }}>
          <Card.Content>
            <p className="text-sm font-semibold text-ink">Login created for {revealedSeat.driverName}</p>
            <p className="mt-1 text-sm text-ink-muted">
              Share these with {revealedSeat.driverName} yourself (call or WhatsApp) — this password is shown only once and can't be retrieved again.
            </p>
            <div className="mt-3 grid gap-2 rounded-lg p-3 font-mono text-sm" style={{ background: 'var(--surface-container-high)' }}>
              <div><span className="text-ink-muted">Sign-in ID: </span>{revealedSeat.email}</div>
              <div><span className="text-ink-muted">Password: </span>{revealedSeat.password}</div>
            </div>
          </Card.Content>
          <Card.Footer>
            <Button variant="secondary" onClick={() => setRevealedSeat(null)}>Done, I've saved it</Button>
          </Card.Footer>
        </Card>
      )}

      {showForm && (
        <Card className="mt-5">
          <form onSubmit={submit}>
            <Card.Content className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Driver name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ahmed Hassan" autoComplete="name" />
              </div>
              <div>
                <Label>Mobile (UAE)</Label>
                <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="05XXXXXXXX" inputMode="tel" autoComplete="tel" />
              </div>
              <div>
                <Label>License number (optional)</Label>
                <Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value.toUpperCase() })} placeholder="DXB-DRV001" />
              </div>
              <div>
                <Label>License expiry (optional)</Label>
                <Input type="date" value={form.licenseExpiry} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })} />
              </div>
              <p className="text-xs text-ink-muted sm:col-span-2">License and vehicle documents can be uploaded after the driver is added.</p>
            </Card.Content>
            <Card.Footer>
              <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setForm(empty); }}>Cancel</Button>
              <Button type="submit" loading={busy}>Save driver</Button>
            </Card.Footer>
          </form>
        </Card>
      )}

      <div className="mt-8">
        {drivers === null ? null : driversError ? (
          <ErrorState title="Couldn't load your drivers" description={driversError} onRetry={load} />
        ) : drivers.length === 0 ? (
          <EmptyState icon={<IconTruck size={28} />} title="No drivers yet" description="Add your first driver to start picking them from a list when a job is awarded." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drivers.map((d) => (
              <Card key={d.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-base font-semibold text-ink">{d.name}</p>
                    <p className="text-sm text-ink-secondary">{d.phone}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeDriver(d)}>Remove</Button>
                </div>
                {d.license_number && (
                  <p className="mt-2 text-xs text-ink-muted">
                    Licence {d.license_number}{d.license_expiry ? ` · expires ${d.license_expiry}` : ''}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-ink-secondary">App access</span>
                  {d.seat_user_id ? (
                    <Badge color="success" dot={false}><IconCheckCircle size={12} /> Login active</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" loading={seatBusyFor === d.id} onClick={() => createLogin(d)}>
                      Create login
                    </Button>
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <DocRow
                    label="License document"
                    driver={d}
                    docType="LICENSE"
                    hasDoc={!!d.license_doc_storage_path}
                    uploading={uploadingFor?.driverId === d.id && uploadingFor.docType === 'LICENSE'}
                    onUpload={(file) => uploadDoc(d, 'LICENSE', file)}
                  />
                  <DocRow
                    label="Vehicle document"
                    driver={d}
                    docType="VEHICLE"
                    hasDoc={!!d.vehicle_doc_storage_path}
                    uploading={uploadingFor?.driverId === d.id && uploadingFor.docType === 'VEHICLE'}
                    onUpload={(file) => uploadDoc(d, 'VEHICLE', file)}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DocRow({ label, driver, docType, hasDoc, uploading, onUpload }) {
  const inputId = `driver-${driver.id}-${docType}`;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-ink-secondary">
        <IconFile size={14} className="text-ink-muted" /> {label}
      </span>
      {hasDoc ? (
        <div className="flex items-center gap-2">
          <Badge color="success" dot={false}><IconCheckCircle size={12} /> Uploaded</Badge>
          <a href={driverDocumentUrl(driver.id, docType.toLowerCase())} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-secondary hover:underline">
            View
          </a>
          <label htmlFor={inputId} className="cursor-pointer text-xs font-medium text-brand-secondary hover:underline">
            {uploading ? 'Uploading…' : 'Replace'}
          </label>
        </div>
      ) : (
        <label htmlFor={inputId} className="cursor-pointer text-xs font-medium text-brand-secondary hover:underline">
          {uploading ? 'Uploading…' : 'Upload'}
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        disabled={uploading}
        onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

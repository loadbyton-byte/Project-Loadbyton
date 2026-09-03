import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { fileToBase64, UPLOAD_ACCEPT, driverDocumentUrl } from '../lib/upload.js';
import { Button, Card, Input, Label, EmptyState, Badge } from '../components/ui.jsx';
import { IconPlus, IconTruck, IconFile, IconCheckCircle } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';

const empty = { name: '', phone: '', licenseNumber: '', licenseExpiry: '' };

export default function Drivers() {
  usePageTitle('My Drivers');
  const { addToast } = useToasts();
  const [drivers, setDrivers] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState(null); // { driverId, docType }

  function load() {
    api.listDrivers().then((d) => setDrivers(d.drivers)).catch(() => setDrivers([]));
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

  async function uploadDoc(driver, docType, file) {
    if (!file) return;
    setUploadingFor({ driverId: driver.id, docType });
    try {
      const { base64, mimeType } = await fileToBase64(file);
      await api.uploadDriverDocument(driver.id, { docType, mimeType, fileBase64: base64 });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not upload document', body: err.message });
    } finally {
      setUploadingFor(null);
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
        {drivers === null ? null : drivers.length === 0 ? (
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

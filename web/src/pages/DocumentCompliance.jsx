import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { uploadFile, UPLOAD_ACCEPT, profileDocumentUrl } from '../lib/upload.js';
import { Card, Badge, StatusBadge, EmptyState } from '../components/ui.jsx';
import { IconShield, IconFile, IconCheckCircle, IconAlert, IconTruck } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';

// The Stitch document_compliance mockup shows a "compliance score" +
// document checklist — kept as-is below. Extended with three real sections
// this page never had: the company's own trade licence/insurance files
// (previously just a self-reported boolean, no file — see
// server/routes/documents.routes.js), a read-only roll-up of the driver
// roster's document status, and every job this account has attached
// documents to.
export default function DocumentCompliance() {
  usePageTitle('Document compliance');
  const { user, refresh } = useAuth();
  const { addToast } = useToasts();
  const p = user.profile || {};
  const isCarrier = user.role === 'CARRIER';

  const [uploadingDocType, setUploadingDocType] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    if (isCarrier) api.listDrivers().then((d) => setDrivers(d.drivers)).catch(() => setDrivers([]));
  }, [isCarrier]);
  useEffect(() => {
    api.myDocumentedJobs().then((d) => setJobs(d.jobs)).catch(() => setJobs([]));
  }, []);

  async function uploadCompanyDoc(docType, file) {
    if (!file) return;
    setUploadingDocType(docType);
    try {
      const uploaded = await uploadFile(file, (mimeType) => api.getProfileDocumentUploadUrl(docType, mimeType));
      await api.uploadProfileDocument({ docType, ...uploaded });
      await refresh();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not upload document', body: err.message });
    } finally {
      setUploadingDocType(null);
    }
  }

  const checklist = [
    { label: 'TRN certificate', done: !!p.trn_number, hint: 'UAE Tax Registration Number on file.' },
    { label: 'Trade licence', done: !!p.trade_license_number, hint: 'Trade licence number on file.' },
    ...(isCarrier ? [
      { label: 'Insurance', done: !!p.insurance_uploaded, hint: 'Fleet/cargo insurance confirmed.' },
      { label: 'Payout IBAN', done: !!p.iban, hint: 'Required before an admin can approve verification.' },
    ] : []),
  ];
  const score = Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Document compliance</h1>
      <p className="mt-1 text-sm text-ink-muted">What Loadbyton has on file for {p.company_name || user.email}.</p>

      <Card className="mt-5 p-5">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-mono text-lg font-bold"
            style={{ background: score === 100 ? 'var(--status-success-bg)' : 'var(--status-warning-bg)', color: score === 100 ? 'var(--status-success)' : 'var(--status-warning)' }}
          >
            {score}%
          </div>
          <div>
            <p className="font-display font-bold text-ink">Compliance score</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
              {user.is_verified ? (
                <><IconCheckCircle size={15} className="text-status-success" /> Verified account</>
              ) : (
                <><IconAlert size={15} className="text-status-warning" /> Awaiting admin verification</>
              )}
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-5 flex flex-col gap-2.5">
        {checklist.map((item) => (
          <Card key={item.label} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--surface-container-high)' }}>
                <IconFile size={16} className="text-ink-muted" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{item.label}</p>
                <p className="text-xs text-ink-muted">{item.hint}</p>
              </div>
            </div>
            <Badge color={item.done ? 'success' : 'danger'}>{item.done ? 'Complete' : 'Missing'}</Badge>
          </Card>
        ))}
      </div>

      {/* Company documents — the real files behind the checklist above */}
      <h2 className="mt-8 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">Company documents</h2>
      <Card className="mt-3 p-4">
        <div className="flex flex-col gap-3">
          <CompanyDocRow
            label="Trade licence"
            docType="TRADE_LICENSE"
            present={!!p.trade_license_doc_storage_path}
            uploading={uploadingDocType === 'TRADE_LICENSE'}
            onUpload={(file) => uploadCompanyDoc('TRADE_LICENSE', file)}
          />
          {isCarrier && (
            <CompanyDocRow
              label="Insurance certificate"
              docType="INSURANCE"
              present={!!p.insurance_doc_storage_path}
              uploading={uploadingDocType === 'INSURANCE'}
              onUpload={(file) => uploadCompanyDoc('INSURANCE', file)}
            />
          )}
        </div>
      </Card>

      {/* Drivers — read-only roll-up, managed from /drivers */}
      {isCarrier && (
        <>
          <h2 className="mt-8 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">Drivers</h2>
          <Card className="mt-3 overflow-hidden">
            {drivers === null ? (
              <p className="p-4 text-sm text-ink-muted">Loading…</p>
            ) : drivers.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<IconTruck size={24} />} title="No drivers yet" description="Add drivers from the Drivers page to track their documents here." />
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {drivers.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 p-3.5">
                    <div>
                      <p className="text-sm font-semibold text-ink">{d.name}</p>
                      <p className="text-xs text-ink-muted">{d.phone}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge color={d.license_doc_storage_path ? 'success' : 'danger'} dot={false}>Licence</Badge>
                      <Badge color={d.vehicle_doc_storage_path ? 'success' : 'danger'} dot={false}>Vehicle</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link to="/drivers" className="block border-t p-3 text-center text-sm font-semibold text-brand-secondary hover:underline" style={{ borderColor: 'var(--border-subtle)' }}>
              Manage drivers
            </Link>
          </Card>
        </>
      )}

      {/* Per-job — every job with at least one attached document */}
      <h2 className="mt-8 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">Per-job documents</h2>
      <Card className="mt-3 overflow-hidden">
        {jobs === null ? (
          <p className="p-4 text-sm text-ink-muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<IconFile size={24} />} title="No job documents yet" description="POD, EIR, and other files attached to your jobs will show up here." />
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {jobs.map((j) => (
              <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 p-3.5 transition hover:bg-surface-container">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-semibold text-ink-muted">{j.jobCode}</span>
                  <StatusBadge status={j.status} />
                </div>
                <span className="text-xs text-ink-muted">{j.docCount} document{j.docCount === 1 ? '' : 's'}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-5 flex items-center gap-3 rounded-lg p-4" style={{ background: 'var(--surface-container-low)' }}>
        <IconShield size={20} className="shrink-0 text-brand-accent" />
        <p className="text-sm text-ink-secondary">Missing something? Update it from your profile — the scan-to-autofill tool can read it straight off a photo.</p>
      </div>
      <Link to="/profile" className="btn-accent mt-4 w-full justify-center">Update profile</Link>
    </div>
  );
}

function CompanyDocRow({ label, docType, present, uploading, onUpload }) {
  const inputId = `company-doc-${docType}`;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-ink-secondary">
        <IconFile size={14} className="text-ink-muted" /> {label}
      </span>
      {present ? (
        <div className="flex items-center gap-2">
          <Badge color="success" dot={false}><IconCheckCircle size={12} /> Uploaded</Badge>
          <a href={profileDocumentUrl(docType)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-secondary hover:underline">View</a>
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

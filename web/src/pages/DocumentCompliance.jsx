import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { Card, Badge, Button } from '../components/ui.jsx';
import { IconShield, IconFile, IconCheckCircle, IconAlert } from '../components/icons.jsx';

// The Stitch document_compliance mockup shows a "compliance score" +
// document checklist. There's no generic multi-document library in the
// backend (job_documents is job-scoped, not account-scoped) — rather than
// invent one, this computes the score from the verification-relevant
// profile fields that already exist (trn/trade licence/insurance/IBAN),
// which is exactly what the admin verification queue itself checks before
// approving a carrier. A real per-document upload/version history would be
// a genuine new backend feature, not a restyle — out of scope here.
export default function DocumentCompliance() {
  usePageTitle('Document compliance');
  const { user } = useAuth();
  const p = user.profile || {};
  const isCarrier = user.role === 'CARRIER';

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

      <div className="mt-5 flex items-center gap-3 rounded-lg p-4" style={{ background: 'var(--surface-container-low)' }}>
        <IconShield size={20} className="shrink-0 text-brand-accent" />
        <p className="text-sm text-ink-secondary">Missing something? Update it from your profile — the scan-to-autofill tool can read it straight off a photo.</p>
      </div>
      <Link to="/profile" className="btn-accent mt-4 w-full justify-center">Update profile</Link>
    </div>
  );
}

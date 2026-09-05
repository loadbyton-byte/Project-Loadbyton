import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth, roleHome } from '../../lib/auth.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { usePageTitle } from '../../lib/seo.jsx';
import { formatAED, formatDate, formatDateTime, formatLabel } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Label, Badge, Select, EmptyState, ErrorState, Pagination } from '../../components/ui.jsx';
import { IconShield, IconAlert, IconCheck, IconInfo, IconUser, IconFile, IconWallet } from '../../components/icons.jsx';

const TABS = ['Health', 'Verification', 'Account approvals', 'Members', 'Disputes', 'Registrations', 'Payout SLA', 'Audit log', 'Revenue', 'Settings'];


function DisputesTab() {
  const { addToast } = useToasts();
  const [disputes, setDisputes] = useState(null);
  const [disputesError, setDisputesError] = useState('');
  const [form, setForm] = useState({ jobId: '', reason: '' });
  const [resolveDrafts, setResolveDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState(null);

  function load() {
    setDisputesError('');
    api.adminDisputes().then((d) => setDisputes(d.disputes)).catch((err) => { setDisputes([]); setDisputesError(err.message); });
  }
  useEffect(load, []);

  async function open(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adminOpenDispute({ jobId: Number(form.jobId), reason: form.reason });
      setForm({ jobId: '', reason: '' });
      load();
    } catch (err) {
      // F16, fixed independently on both branches: no catch here either —
      // e.g. an invalid job ID failed silently with the form just sitting there.
      addToast({ type: 'system_message', title: 'Could not open dispute', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id, decision) {
    setBusy(true);
    try {
      await api.adminResolveDispute(id, { decision, determination: resolveDrafts[id] || '' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not resolve dispute', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card className="p-5">
        <p className="font-display text-base font-semibold text-ink">Open a dispute</p>
        <form onSubmit={open} className="mt-3 flex flex-wrap gap-3">
          <Input placeholder="Job ID" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-32" required />
          <Input placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="flex-1 min-w-[240px]" required />
          <Button type="submit" variant="danger" loading={busy}>Open dispute</Button>
        </form>
      </Card>

      <div className="mt-6 space-y-4">
        {disputes === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : disputesError ? (
          <ErrorState title="Couldn't load disputes" description={disputesError} onRetry={load} />
        ) : disputes.length === 0 ? (
          <EmptyState icon={<IconAlert size={26} />} title="No disputes" description="Escrow disputes will show up here for review." />
        ) : (
          disputes.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs text-ink-muted">{d.job_code}</p>
                  <p className="mt-0.5 font-medium text-ink">{d.reason}</p>
                  {d.determination && <p className="mt-1 text-sm text-ink-muted">Determination: {d.determination}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge color={d.status === 'RESOLVED' ? 'success' : 'warning'}>{d.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setEvidenceFor(evidenceFor?.id === d.id ? null : d)}>
                    <IconFile size={13} /> {evidenceFor?.id === d.id ? 'Hide evidence' : 'View evidence'}
                  </Button>
                </div>
              </div>
              {evidenceFor?.id === d.id && <EvidenceDossier jobId={d.job_id} />}
              {d.status === 'OPEN' && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Input placeholder="Determination note" value={resolveDrafts[d.id] || ''} onChange={(e) => setResolveDrafts({ ...resolveDrafts, [d.id]: e.target.value })} className="flex-1 min-w-[220px]" />
                  <Button variant="accent" onClick={() => resolve(d.id, 'RELEASE_TO_CARRIER')} loading={busy}>Release to carrier</Button>
                  <Button variant="secondary" onClick={() => resolve(d.id, 'REFUND_SHIPPER')} loading={busy}>Refund shipper</Button>
                  <Button variant="ghost" onClick={() => resolve(d.id, 'SPLIT')} loading={busy}>Split</Button>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// GET /api/admin/evidence/:jobId — built server-side (the "dispute dossier":
// job, bids, docs, messages, ratings, audit trail) but the Disputes tab had
// no view for it at all before this redesign pass.
function EvidenceDossier({ jobId }) {
  const [evidence, setEvidence] = useState(null);
  useEffect(() => { api.adminEvidence(jobId).then((d) => setEvidence(d.evidence)).catch(() => setEvidence(false)); }, [jobId]);

  if (evidence === null) return <p className="mt-4 text-sm text-ink-muted">Loading evidence…</p>;
  if (evidence === false) return <p className="mt-4 text-sm text-status-danger">Could not load evidence.</p>;

  return (
    <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2" style={{ borderColor: 'var(--border-subtle)' }}>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Bids ({evidence.bids.length})</p>
        <ul className="mt-1.5 space-y-1 text-sm text-ink-secondary">
          {evidence.bids.map((b) => <li key={b.id}>{formatAED(b.amount_aed)} · {b.eta_at ? formatDateTime(b.eta_at) : 'ETA n/a'} · <Badge>{b.status}</Badge></li>)}
          {evidence.bids.length === 0 && <li className="text-ink-muted">None</li>}
        </ul>
      </div>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Documents ({evidence.documents.length})</p>
        <ul className="mt-1.5 space-y-1 text-sm text-ink-secondary">
          {evidence.documents.map((doc) => <li key={doc.id}>{doc.title} <Badge>{doc.doc_type}</Badge></li>)}
          {evidence.documents.length === 0 && <li className="text-ink-muted">None</li>}
        </ul>
      </div>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Messages ({evidence.messages.length})</p>
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-sm text-ink-secondary">
          {evidence.messages.map((m) => <li key={m.id}>{m.content}</li>)}
          {evidence.messages.length === 0 && <li className="text-ink-muted">None</li>}
        </ul>
      </div>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Audit trail ({evidence.auditTrail.length})</p>
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-sm text-ink-secondary">
          {evidence.auditTrail.map((a) => <li key={a.id}>{a.action} — {formatDateTime(a.created_at)}</li>)}
          {evidence.auditTrail.length === 0 && <li className="text-ink-muted">None</li>}
        </ul>
      </div>
    </div>
  );
}

export default DisputesTab;

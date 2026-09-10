import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToasts } from '../../components/Toast.jsx';
import { formatAED, formatDateTime } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Badge, EmptyState, ErrorState, Select } from '../../components/ui.jsx';
import { IconCheck, IconX, IconShield } from '../../components/icons.jsx';

const ACTION_LABEL = {
  MANUAL_ESCROW_RELEASE: 'Manual escrow release',
  MANUAL_REFUND: 'Manual refund',
  DISPUTE_RESOLVE: 'Dispute resolution',
  MARK_TRANSFERRED: 'Payout transfer confirmation',
};

// Two-person approval inbox — every action here (admin-approvals.routes.js)
// was created by ONE admin and needs a DIFFERENT admin to confirm or reject
// before anything actually happens. This tab existed nowhere in the
// product before: the whole mechanism (MANUAL_ESCROW_RELEASE/MANUAL_REFUND,
// and — once the Settings tab's "require a second admin" toggle is on —
// dispute resolutions and payout transfer confirmations too) was API-only,
// meaning a pending request had no way to actually get confirmed short of
// calling the API directly.
function ApprovalsTab() {
  const { addToast } = useToasts();
  const [approvals, setApprovals] = useState(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [busyId, setBusyId] = useState(null);
  const [rejectDrafts, setRejectDrafts] = useState({});

  function load() {
    setError('');
    api.adminActionApprovals(statusFilter || undefined).then((d) => setApprovals(d.approvals)).catch((err) => { setApprovals([]); setError(err.message); });
  }
  useEffect(load, [statusFilter]);

  async function confirm(id) {
    setBusyId(id);
    try {
      await api.adminConfirmApproval(id);
      addToast({ type: 'status_change', title: 'Confirmed and executed' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not confirm', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id) {
    setBusyId(id);
    try {
      await api.adminRejectApproval(id, rejectDrafts[id] || '');
      addToast({ type: 'status_change', title: 'Rejected' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not reject', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState title="Couldn't load approvals" description={error} onRetry={load} />;
  if (!approvals) return <p className="text-sm text-ink-muted">Loading…</p>;

  const pendingCount = approvals.filter((a) => a.status === 'PENDING').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Showing" value={approvals.length} />
          <Stat label="Pending (this filter)" value={pendingCount} tone={pendingCount > 0 ? 'accent' : 'default'} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="PENDING">Pending</option>
          <option value="EXECUTED">Executed</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </Select>
      </div>

      {approvals.length === 0 ? (
        <EmptyState icon={<IconShield size={26} />} title="Nothing here" description="Two-person approval requests (dispute resolutions, payout transfers, manual escrow overrides) show up here when the requesting admin needs a second admin to confirm." />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => {
            let payload = {};
            try { payload = a.payload ? JSON.parse(a.payload) : {}; } catch { /* leave empty */ }
            return (
              <Card key={a.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-sm font-semibold text-ink">{ACTION_LABEL[a.action_type] || a.action_type}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">Job #{a.job_id} · requested by admin #{a.requested_by} · {formatDateTime(a.created_at)}</p>
                    {payload.decision && <p className="mt-1 text-sm text-ink-secondary">Decision: {payload.decision.replaceAll('_', ' ')}{payload.determination ? ` — ${payload.determination}` : ''}</p>}
                    {payload.splitShipperPct != null && <p className="text-sm text-ink-secondary">Split: {payload.splitShipperPct}% shipper / {payload.splitCarrierPct}% carrier</p>}
                    {payload.reference && <p className="mt-1 text-sm text-ink-secondary">Reference: {payload.reference}</p>}
                    {payload.reason && <p className="mt-1 text-sm text-ink-secondary">Reason: {payload.reason}</p>}
                  </div>
                  <Badge color={a.status === 'PENDING' ? 'warning' : a.status === 'EXECUTED' ? 'success' : 'neutral'}>{a.status}</Badge>
                </div>
                {a.status === 'PENDING' && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Button variant="accent" size="sm" loading={busyId === a.id} onClick={() => confirm(a.id)}>
                      <IconCheck size={14} /> Confirm &amp; execute
                    </Button>
                    <Input placeholder="Rejection reason (optional)" value={rejectDrafts[a.id] || ''} onChange={(e) => setRejectDrafts({ ...rejectDrafts, [a.id]: e.target.value })} className="flex-1 min-w-[200px]" />
                    <Button variant="secondary" size="sm" loading={busyId === a.id} onClick={() => reject(a.id)}>
                      <IconX size={14} /> Reject
                    </Button>
                    <p className="w-full text-xs text-ink-muted">A different admin than the one who requested this must confirm or reject — self-decisions are refused server-side.</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ApprovalsTab;

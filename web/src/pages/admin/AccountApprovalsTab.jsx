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


function AccountApprovalsTab() {
  const { addToast } = useToasts();
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  function load() {
    setError('');
    api.adminApprovals().then((d) => setQueue(d.queue)).catch((err) => { setQueue([]); setError(err.message); });
  }
  useEffect(load, []);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api.adminApprove(id, action);
      addToast({ type: 'status_change', title: `Account ${action}d` });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not update approval', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (!queue) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (error) return <ErrorState title="Couldn't load approvals" description={error} onRetry={load} />;
  if (queue.length === 0) return <EmptyState icon={<IconUser size={26} />} title="Nothing pending" description="All registered accounts are approved. New registrations land here until an admin approves them." />

  return (
    <div className="space-y-4">
      {queue.map((u) => (
        <Card key={u.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-display text-base font-semibold text-ink">{u.profile.company_name}</p>
              <p className="text-sm text-ink-muted">{u.email} · {u.role} · registered {formatDateTime(u.created_at)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-ink-muted">Phone</dt><dd className="text-ink">{u.profile.phone || '—'}</dd></div>
                <div><dt className="text-ink-muted">TRN</dt><dd className="text-ink">{u.profile.trn_number || '—'}</dd></div>
                <div><dt className="text-ink-muted">Trade licence</dt><dd className="text-ink">{u.profile.trade_license_number || '—'}</dd></div>
                <div><dt className="text-ink-muted">Fleet</dt><dd className="text-ink">{u.profile.fleet_size} ({u.profile.owned_chassis} owned)</dd></div>
              </dl>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => act(u.id, 'approve')} loading={busyId === u.id}>Approve</Button>
              <Button variant="danger" onClick={() => act(u.id, 'reject')} loading={busyId === u.id}>Reject</Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default AccountApprovalsTab;

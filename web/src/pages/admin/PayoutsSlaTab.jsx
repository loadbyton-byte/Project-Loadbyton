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


function PayoutsSlaTab() {
  const { addToast } = useToasts();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [overdueCount, setOverdueCount] = useState(0);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setError('');
    api.adminPayoutsSla().then((d) => { setPending(d.pending); setOverdueCount(d.overdueCount); }).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function markTransferred(payoutId) {
    setBusyId(payoutId);
    try {
      await api.adminMarkTransferred(payoutId);
      addToast({ type: 'payout_released', title: 'Transfer confirmed' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Failed to confirm', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState title="Couldn't load payout SLA data" description={error} onRetry={load} />;
  if (!pending) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Awaiting transfer" value={pending.length} />
        <Stat label="Overdue (past 48h)" value={overdueCount} tone={overdueCount > 0 ? 'accent' : 'default'} />
      </div>
      {pending.length === 0 ? (
        <EmptyState icon={<IconCheck size={28} />} title="Nothing outstanding" description="Every released payout has a confirmed transfer." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Net AED</th>
                  <th className="px-5 py-3 font-medium">Released</th>
                  <th className="px-5 py-3 font-medium">SLA deadline</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-5 py-3 font-mono text-xs">{p.job_code}</td>
                    <td className="tabular px-5 py-3 font-semibold text-ink">{formatAED(p.net_aed)}</td>
                    <td className="px-5 py-3 text-ink-muted">{formatDateTime(p.released_at)}</td>
                    <td className="px-5 py-3">
                      <Badge color={p.overdue ? 'danger' : 'warning'}>{p.overdue ? 'Overdue' : formatDateTime(p.sla_deadline)}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="secondary" loading={busyId === p.id} onClick={() => markTransferred(p.id)}>
                        Confirm transfer sent
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default PayoutsSlaTab;

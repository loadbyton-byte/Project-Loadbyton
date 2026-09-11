import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToasts } from '../../components/Toast.jsx';
import { formatAED, formatDateTime } from '../../lib/constants.js';
import { Button, Card, Stat, Badge, EmptyState, ErrorState } from '../../components/ui.jsx';
import { IconCheck } from '../../components/icons.jsx';

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
      const result = await api.adminMarkTransferred(payoutId);
      // Server-side setting two_person_approval_required (Settings tab) can
      // turn this into a pending request instead of an immediate
      // confirmation — without this branch the row just silently stayed in
      // the list with no explanation.
      if (result?.pendingApproval) {
        addToast({ type: 'status_change', title: 'Sent for approval', body: 'A second admin must confirm this in the Approvals tab before the transfer is actually confirmed.' });
      } else {
        addToast({ type: 'payout_released', title: 'Transfer confirmed' });
      }
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

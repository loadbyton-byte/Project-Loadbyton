import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToasts } from '../../components/Toast.jsx';
import { formatAED, formatDateTime } from '../../lib/constants.js';
import { Button, Card, Stat, Badge, EmptyState, ErrorState } from '../../components/ui.jsx';
import { IconCheck, IconAlert } from '../../components/icons.jsx';

function PayoutsSlaTab() {
  const { addToast } = useToasts();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [overdueCount, setOverdueCount] = useState(0);
  const [busyId, setBusyId] = useState(null);
  // Ambiguous payout-attempts queue — a provider call whose outcome
  // couldn't be determined (network/transport failure). Backend
  // (server/routes/admin.routes.js) has existed for a while with no admin
  // UI at all — a real operational gap: any payout stuck here previously
  // could only be unblocked via a direct API call, not through the app.
  const [unknownAttempts, setUnknownAttempts] = useState(null);
  const [unknownError, setUnknownError] = useState('');
  const [busyKey, setBusyKey] = useState(null); // e.g. 'att-5' or 'pay-7' — attempt_id and payout_id are different id spaces

  function load() {
    setError('');
    api.adminPayoutsSla().then((d) => { setPending(d.pending); setOverdueCount(d.overdueCount); }).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  function loadUnknown() {
    setUnknownError('');
    api.adminPayoutsUnknown().then((d) => setUnknownAttempts(d.unknown)).catch((err) => setUnknownError(err.message));
  }
  useEffect(loadUnknown, []);

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

  async function reconcile(attemptId) {
    setBusyKey(`att-${attemptId}`);
    try {
      const result = await api.adminReconcilePayoutAttempt(attemptId);
      if (result.resolved) {
        addToast({ type: 'status_change', title: 'Reconciled', body: result.detail || `Attempt is now ${result.status}.` });
      } else {
        addToast({ type: 'system_message', title: 'Still unresolved', body: result.detail || 'The provider is still ambiguous — try again later.' });
      }
      loadUnknown();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Reconciliation failed', body: err.message });
    } finally {
      setBusyKey(null);
    }
  }

  async function retryPayout(payoutId) {
    setBusyKey(`pay-${payoutId}`);
    try {
      await api.adminRetryPayout(payoutId);
      addToast({ type: 'status_change', title: 'Payout retried' });
      loadUnknown();
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Retry failed', body: err.message });
    } finally {
      setBusyKey(null);
    }
  }

  if (error) return <ErrorState title="Couldn't load payout SLA data" description={error} onRetry={load} />;
  if (!pending) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Awaiting transfer" value={pending.length} />
        <Stat label="Overdue (past 48h)" value={overdueCount} tone={overdueCount > 0 ? 'accent' : 'default'} />
        <Stat label="Stuck / ambiguous" value={unknownAttempts?.length ?? '—'} tone={unknownAttempts?.length > 0 ? 'accent' : 'default'} />
      </div>

      <h3 className="mb-2 font-display text-sm font-semibold text-ink">Stuck / ambiguous payout attempts</h3>
      {unknownError ? (
        <ErrorState className="mb-8" title="Couldn't load stuck payouts" description={unknownError} onRetry={loadUnknown} />
      ) : unknownAttempts === null ? (
        <p className="mb-8 text-sm text-ink-muted">Loading…</p>
      ) : unknownAttempts.length === 0 ? (
        <div className="mb-8">
          <EmptyState icon={<IconCheck size={26} />} title="Nothing stuck" description="Every payout attempt resolved cleanly." />
        </div>
      ) : (
        <Card className="mb-8 overflow-hidden">
          <div className="overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 font-medium">Amount AED</th>
                  <th className="px-5 py-3 font-medium">Since</th>
                  <th className="px-5 py-3 font-medium">Error</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {unknownAttempts.map((a) => (
                  <tr key={a.attempt_id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-5 py-3 font-mono text-xs">{a.job_code}</td>
                    <td className="px-5 py-3 text-ink-secondary">{a.provider}</td>
                    <td className="tabular px-5 py-3 font-semibold text-ink">{formatAED(a.amount_aed)}</td>
                    <td className="px-5 py-3 text-ink-muted">{formatDateTime(a.created_at)}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--status-warning)' }}>
                        <IconAlert size={13} /> {a.error || 'Ambiguous provider response'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" loading={busyKey === `att-${a.attempt_id}`} onClick={() => reconcile(a.attempt_id)}>
                          Reconcile
                        </Button>
                        <Button size="sm" variant="ghost" loading={busyKey === `pay-${a.payout_id}`} onClick={() => retryPayout(a.payout_id)}>
                          Retry payout
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h3 className="mb-2 font-display text-sm font-semibold text-ink">Awaiting bank transfer confirmation</h3>
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

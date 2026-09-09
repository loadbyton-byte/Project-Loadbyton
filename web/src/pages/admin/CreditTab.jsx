import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToasts } from '../../components/Toast.jsx';
import { formatAED, formatDate } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Label, Badge, EmptyState, ErrorState } from '../../components/ui.jsx';
import { IconWallet, IconCheck } from '../../components/icons.jsx';

function ApproveForm({ userId, current, onDone }) {
  const { addToast } = useToasts();
  const [limitAed, setLimitAed] = useState(current?.credit_limit_aed || '');
  const [termsDays, setTermsDays] = useState(current?.credit_terms_days || 30);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.adminApproveCredit(userId, Number(limitAed), Number(termsDays));
      addToast({ type: 'status_change', title: 'Credit terms updated' });
      onDone();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not update credit terms', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div>
        <Label>Credit limit (AED)</Label>
        <Input type="number" min="0" value={limitAed} onChange={(e) => setLimitAed(e.target.value)} className="w-32" />
      </div>
      <div>
        <Label>Net terms (days)</Label>
        <Input type="number" min="1" value={termsDays} onChange={(e) => setTermsDays(e.target.value)} className="w-24" />
      </div>
      <Button size="sm" loading={busy} onClick={submit}>{current?.credit_approved_at ? 'Update' : 'Approve'}</Button>
    </div>
  );
}

function CreditTab() {
  const { addToast } = useToasts();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [busyJobId, setBusyJobId] = useState(null);

  function load() {
    setError('');
    api.adminCredit().then(setData).catch((err) => { setData({ shippers: [], outstandingJobs: [] }); setError(err.message); });
  }
  useEffect(load, []);

  async function settle(jobId) {
    setBusyJobId(jobId);
    try {
      await api.adminSettleCredit(jobId);
      addToast({ type: 'payout_released', title: 'Credit draw settled' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not settle', body: err.message });
    } finally {
      setBusyJobId(null);
    }
  }

  if (error) return <ErrorState title="Couldn't load credit data" description={error} onRetry={load} />;
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;

  const totalOutstanding = data.outstandingJobs.reduce((sum, j) => sum + (j.agreed_price_aed || 0), 0);
  const now = Date.now();

  return (
    <div>
      <p className="mb-4 text-sm text-ink-muted">
        A shipper only sees CONTRACT_CREDIT as an option on the post-job form once approved here — award.service.js
        refuses the award otherwise. Approving doesn't move any money; it just raises the ceiling a job's award is
        allowed to draw against.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Approved shippers" value={data.shippers.filter((s) => s.credit_approved_at).length} />
        <Stat label="Outstanding draws" value={data.outstandingJobs.length} />
        <Stat label="Outstanding total" value={formatAED(totalOutstanding)} />
      </div>

      <h3 className="mb-2 font-display text-sm font-semibold text-ink">Shipper credit standing</h3>
      {data.shippers.length === 0 ? (
        <EmptyState icon={<IconWallet size={26} />} title="No credit accounts yet" description="Approve a shipper's credit terms via a job's payment-tier flow, or grant one directly below once a shipper requests it." />
      ) : (
        <div className="mb-8 space-y-3">
          {data.shippers.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{s.company_name}</p>
                  <p className="text-xs text-ink-muted">{s.email}</p>
                </div>
                <div className="text-right text-sm">
                  {s.credit_approved_at ? (
                    <>
                      <p className="tabular font-semibold text-ink">{formatAED(s.credit_balance_aed)} / {formatAED(s.credit_limit_aed)}</p>
                      <p className="text-xs text-ink-muted">net {s.credit_terms_days} days</p>
                    </>
                  ) : (
                    <Badge color="neutral">Not approved</Badge>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(editingId === s.id ? null : s.id)}>
                  {editingId === s.id ? 'Cancel' : s.credit_approved_at ? 'Adjust' : 'Approve'}
                </Button>
              </div>
              {editingId === s.id && <ApproveForm userId={s.id} current={s} onDone={() => { setEditingId(null); load(); }} />}
            </Card>
          ))}
        </div>
      )}

      <h3 className="mb-2 font-display text-sm font-semibold text-ink">Outstanding credit draws</h3>
      {data.outstandingJobs.length === 0 ? (
        <EmptyState icon={<IconCheck size={26} />} title="Nothing outstanding" description="Every contract-credit job has been settled." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.outstandingJobs.map((j) => {
                  const overdue = j.credit_due_at && new Date(j.credit_due_at).getTime() < now;
                  return (
                    <tr key={j.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-5 py-3 font-mono text-xs">{j.job_code}</td>
                      <td className="tabular px-5 py-3 font-semibold text-ink">{formatAED(j.agreed_price_aed)}</td>
                      <td className="px-5 py-3"><Badge color={overdue ? 'danger' : 'neutral'}>{overdue ? 'Overdue — ' : ''}{formatDate(j.credit_due_at)}</Badge></td>
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant="secondary" loading={busyJobId === j.id} onClick={() => settle(j.id)}>Mark settled</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default CreditTab;

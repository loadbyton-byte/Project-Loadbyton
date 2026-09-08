import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { usePageTitle } from '../../lib/seo.jsx';
import { useLocale } from '../../lib/i18n.jsx';
import { Card, Badge, ErrorState, Stat, Button } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { IconSync, IconCheckCircle, IconAlert } from '../../components/icons.jsx';

export default function AdminReconciliation() {
  usePageTitle('Reconciliation');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await api.adminReconciliation();
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runReconciliation() {
    addToast({ type: 'system_message', title: 'Reconciliation started' });
    // Would call a reconciliation endpoint
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load reconciliation" description={error} onRetry={fetchData} /></div>;

  return (
    <div className="container-page max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('admin.reconciliation', 'Reconciliation')}</h1>
          <p className="text-ink-muted mt-1">{t('admin.reconciliationDesc', 'Cross-system financial reconciliation')}</p>
        </div>
        <Button variant="secondary" onClick={runReconciliation}><IconSync size={16} className="mr-2" /> Run Now</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Stat label="Escrow Balance" value={data?.escrow_balance ? `AED ${Number(data.escrow_balance).toLocaleString()}` : '—'} />
        <Stat label="Ledger Balance" value={data?.ledger_balance ? `AED ${Number(data.ledger_balance).toLocaleString()}` : '—'} tone="accent" />
        <Stat label="Discrepancies" value={data?.discrepancies ?? 0} tone={data?.discrepancies > 0 ? 'danger' : 'success'} />
        <Stat label="Last Run" value={data?.last_run ? new Date(data.last_run).toLocaleDateString() : '—'} />
      </div>

      <Card className="mb-6">
        <Card.Header><Card.Title>Reconciliation Details</Card.Title></Card.Header>
        <Card.Content className="space-y-3">
          {data?.items?.length > 0 ? (
            data.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: item.match ? 'var(--status-success-bg)' : 'var(--border-default)' }}>
                <div className="flex items-center gap-3">
                  <span className={item.match ? 'text-status-success' : 'text-status-danger'}>
                    {item.match ? <IconCheckCircle size={16} /> : <IconAlert size={16} />}
                  </span>
                  <div>
                    <p className="font-medium text-ink">{item.description}</p>
                    <p className="text-xs text-ink-muted">{item.system_a}: AED {item.amount_a?.toLocaleString()} · {item.system_b}: AED {item.amount_b?.toLocaleString()}</p>
                  </div>
                </div>
                <Badge color={item.match ? 'success' : 'danger'}>
                  {item.match ? 'Matched' : 'Mismatch'}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-center py-8 text-ink-muted">No reconciliation data available</p>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
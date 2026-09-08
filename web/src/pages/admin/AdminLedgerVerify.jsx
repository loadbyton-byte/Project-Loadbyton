import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { usePageTitle } from '../../lib/seo.jsx';
import { useLocale } from '../../lib/i18n.jsx';
import { Button, Card, Badge, ErrorState, Stat } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { IconSync, IconCheckCircle, IconAlert, IconShield } from '../../components/icons.jsx';

export default function AdminLedgerVerify() {
  usePageTitle('Ledger Verification');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await api.adminLedgerVerify();
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runVerification() {
    setVerifying(true);
    try {
      const res = await api.verifyAuditChain();
      setData(res);
      addToast({ type: 'status_change', title: 'Verification complete' });
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load verification" description={error} onRetry={fetchData} /></div>;

  const valid = data?.valid === true;
  const checks = data?.checks || [];

  return (
    <div className="container-page max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2"><IconShield size={24} /> {t('admin.ledgerVerify', 'Ledger Chain Verification')}</h1>
          <p className="text-ink-muted mt-1">{t('admin.ledgerVerifyDesc', 'Verify integrity of the append-only ledger hash chain')}</p>
        </div>
        <Button onClick={runVerification} loading={verifying}><IconSync size={16} className="mr-2" /> {t('admin.runVerification', 'Run Verification')}</Button>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: valid ? 'var(--status-success-bg)' : 'var(--status-danger-bg)' }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: valid ? 'var(--status-success)' : 'var(--status-danger)' }}>
            {valid ? <IconCheckCircle size={24} /> : <IconAlert size={24} />}
          </div>
          <div>
            <p className="font-display text-xl font-bold" style={{ color: valid ? 'var(--status-success)' : 'var(--status-danger)' }}>
              {valid ? t('admin.chainValid', 'Chain Valid') : t('admin.chainBroken', 'Chain Broken')}
            </p>
            <p className="text-sm" style={{ color: valid ? 'var(--status-success)' : 'var(--status-danger)' }}>
              {valid ? t('admin.allChecksPassed', 'All integrity checks passed') : t('admin.integrityIssues', 'Integrity issues detected')}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <Card.Header><Card.Title>{t('admin.checks', 'Verification Checks')}</Card.Title></Card.Header>
        <Card.Content>
          {checks.length > 0 ? (
            <div className="space-y-3">
              {checks.map((check, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: check.passed ? 'var(--status-success-bg)' : 'var(--status-danger-bg)' }}>
                  <div className="flex items-center gap-3">
                    <span className={check.passed ? 'text-status-success' : 'text-status-danger'}>
                      {check.passed ? <IconCheckCircle size={16} /> : <IconAlert size={16} />}
                    </span>
                    <div>
                      <p className="font-medium text-ink">{check.name}</p>
                      <p className="text-xs text-ink-muted">{check.description}</p>
                    </div>
                  </div>
                  <Badge color={check.passed ? 'success' : 'danger'}>
                    {check.passed ? 'Pass' : 'Fail'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-8 text-ink-muted">No checks available</p>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
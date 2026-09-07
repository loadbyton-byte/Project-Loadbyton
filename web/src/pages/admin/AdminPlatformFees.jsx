import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { usePageTitle } from '../../lib/seo.jsx';
import { useLocale } from '../../lib/i18n.jsx';
import { Button, Card, Badge, ErrorState, Select, Input, Label } from '../../components/ui.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { IconSync, IconPackage, IconTag } from '../../components/icons.jsx';

export default function AdminPlatformFees() {
  usePageTitle('Platform Fees');
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
      const res = await api.adminPlatformFees();
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateFee(feeType, value) {
    try {
      await api.adminUpdateSettings({ [feeType]: value });
      addToast('Fee updated', 'success');
      fetchData();
    } catch (e) {
      addToast(e.message || 'Failed to update', 'error');
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load fees" description={error} onRetry={fetchData} /></div>;

  const fees = data?.fees || {};

  return (
    <div className="container-page max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2"><IconDollarSign size={24} /> {t('admin.platformFees') || 'Platform Fees'}</h1>
          <p className="text-ink-muted mt-1">{t('admin.platformFeesDesc') || 'Configure platform fee rates'}</p>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2">
            <Label>{t('admin.commissionRate') || 'Commission Rate (bps)'}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" max="10000" value={fees.commission_rate_bps || 0} onChange={(e) => updateFee('commission_rate_bps', Number(e.target.value))} className="w-32" />
              <span className="text-ink-muted">bps (100 bps = 1%)</span>
            </div>
          </div>

          <div>
            <Label>{t('admin.cancellationFee') || 'Cancellation Fee (bps)'}</Label>
            <Input type="number" min="0" max="10000" value={fees.cancellation_fee_bps || 0} onChange={(e) => updateFee('cancellation_fee_bps', Number(e.target.value))} className="w-32" />
          </div>

          <div>
            <Label>{t('admin.priorityFee') || 'Priority Fee (bps)'}</Label>
            <Input type="number" min="0" max="10000" value={fees.priority_fee_bps || 0} onChange={(e) => updateFee('priority_fee_bps', Number(e.target.value))} className="w-32" />
          </div>

          <div className="col-span-2">
            <Label>{t('admin.autoReleaseHours') || 'Auto-release Hours'}</Label>
            <Input type="number" min="1" max="168" value={fees.auto_release_hours || 24} onChange={(e) => updateFee('auto_release_hours', Number(e.target.value))} className="w-32" />
          </div>
        </div>

        <Card.Footer>
          <Button variant="secondary" onClick={fetchData}><IconSync size={16} className="mr-2" /> Refresh</Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
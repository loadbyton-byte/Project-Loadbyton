import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconPackage, IconCheckCircle, IconArrowRight, IconAlert } from '../components/icons.jsx';

export default function StripeConnect() {
  usePageTitle('Stripe Connect');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const data = await api.stripeConnectStatus();
      setStatus(data);
    } catch (e) {
      setStatus({ connected: false, error: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleOnboard() {
    setOnboarding(true);
    try {
      const res = await api.stripeConnectOnboard();
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Failed to start onboarding' });
    } finally {
      setOnboarding(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;

  return (
    <div className="container-page max-w-md">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
          <IconPackage size={24} /> {t('stripe.title', 'Stripe Connect')}
        </h1>
        <p className="text-ink-muted mt-1">{t('stripe.desc', 'Connect your Stripe account for automated payouts')}</p>
      </div>

      <Card className="p-6">
        {status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconCheckCircle size={24} className="text-status-success" />
                <div>
                  <p className="font-semibold text-ink">{t('stripe.connected', 'Stripe Connected')}</p>
                  <p className="text-sm text-ink-muted">{t('stripe.ready', 'Ready for automated payouts')}</p>
                </div>
              </div>
              <Badge color="success">{t('stripe.active', 'Active')}</Badge>
            </div>
            <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-xs text-ink-muted">{t('stripe.accountId', 'Account ID')}: {status.account_id || '—'}</p>
              <p className="text-xs text-ink-muted">{t('stripe.chargesEnabled', 'Charges')}: {status.charges_enabled ? 'Yes' : 'No'}</p>
              <p className="text-xs text-ink-muted">{t('stripe.payoutsEnabled', 'Payouts')}: {status.payouts_enabled ? 'Yes' : 'No'}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <IconAlert size={48} className="mx-auto text-status-warning" />
            <h3 className="font-semibold text-ink">{t('stripe.notConnected', 'Not Connected')}</h3>
            <p className="text-ink-muted">{t('stripe.connectDesc', 'Connect your Stripe account to enable automated payouts for your fleet')}</p>
            <Button className="w-full" size="lg" onClick={handleOnboard} loading={onboarding}>
              <IconArrowRight size={16} className="mr-2" /> {t('stripe.connectBtn', 'Connect Stripe')}
            </Button>
            {status?.error && <p className="text-xs text-status-danger">{status.error}</p>}
          </div>
        )}
      </Card>

      <Card className="mt-6 p-4">
        <div className="flex items-start gap-3">
          <IconAlert size={20} className="text-brand-secondary mt-0.5" />
          <div className="text-sm text-ink-secondary space-y-1">
            <p>{t('stripe.info1', 'Automated payouts release funds to carriers on delivery confirmation')}</p>
            <p>{t('stripe.info2', 'Supports instant payouts where available in UAE/GCC')}</p>
            <p>{t('stripe.info3', 'Carriers must complete their own Stripe onboarding separately')}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
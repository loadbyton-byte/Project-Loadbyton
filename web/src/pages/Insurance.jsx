import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconShield, IconInfo, IconCheckCircle, IconX } from '../components/icons.jsx';

// GIT (Goods-in-Transit) cargo insurance — matches the real backend exactly
// (server/lib/insurance.js's rate card: premium = cargoValueAed * rateBps,
// floored/capped, coverage = cargo value). There is no cargo-type/transport-
// mode/coverage-level/deductible/VAT concept anywhere server-side — an
// earlier version of this page invented UI for a richer product than the
// one that actually exists, which meant getting a quote or binding a
// policy never worked. Rebuilt around the one real parameter (cargo value)
// and the real response shape.
export default function Insurance() {
  usePageTitle('Insurance');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const { id } = useParams();

  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [providerInfo, setProviderInfo] = useState(null);
  const [cargoValueAed, setCargoValueAed] = useState('');
  const [bindLoading, setBindLoading] = useState(false);

  useEffect(() => { loadPolicy(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPolicy() {
    try {
      const d = await api.getPolicy(id);
      setPolicy(d.policy);
      setProviderInfo({ provider: d.provider, configured: d.configured });
    } catch (e) {
      addToast({ type: 'system_message', title: t('insurance.errorLoadJob', 'Failed to load insurance status'), body: e.message });
    }
  }

  async function handleQuote(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api.getInsuranceQuote({ cargoValueAed: Number(cargoValueAed) });
      setQuote(d.quote);
    } catch (e) {
      addToast({ type: 'system_message', title: t('insurance.quoteError', 'Failed to get quote'), body: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleBind() {
    setBindLoading(true);
    try {
      const d = await api.bindInsurance(id, { cargoValueAed: quote.cargoValueAed });
      setPolicy(d.policy);
      setQuote(null);
      addToast({ type: 'status_change', title: t('insurance.bindSuccess', 'Policy bound') });
    } catch (e) {
      addToast({ type: 'system_message', title: t('insurance.bindError', 'Failed to bind policy'), body: e.message });
    } finally {
      setBindLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm(t('insurance.confirmCancel', 'Cancel this policy?'))) return;
    setBindLoading(true);
    try {
      const d = await api.cancelInsurance(id);
      setPolicy(d.policy);
      addToast({ type: 'status_change', title: t('insurance.cancelSuccess', 'Policy cancelled') });
    } catch (e) {
      addToast({ type: 'system_message', title: t('insurance.cancelError', 'Failed to cancel'), body: e.message });
    } finally {
      setBindLoading(false);
    }
  }

  const infoPanel = (
    <Card className="mt-6 p-4">
      <div className="flex items-start gap-3">
        <IconInfo size={20} className="text-brand-secondary mt-0.5" />
        <div className="text-sm text-ink-secondary space-y-1">
          <p>{t('insurance.infoInternal', 'Loadbyton self-underwrites this coverage today — it is not a third-party insurance product. Ask ops before relying on it for a high-value shipment.')}</p>
          <p>{t('insurance.infoCoverage', 'Coverage runs from pickup to delivery.')}</p>
        </div>
      </div>
    </Card>
  );

  if (policy && policy.status === 'ACTIVE') {
    return (
      <div className="container-page max-w-3xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">{t('insurance.activePolicy', 'Active Insurance Policy')}</h1>
          <p className="text-ink-muted mt-1">{t('insurance.policyDesc', 'Your cargo is covered for this job')}</p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.policyRef', 'Policy reference')}</p>
              <p className="font-mono text-sm text-ink">{policy.policy_ref}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.provider', 'Provider')}</p>
              <p className="text-sm text-ink">{policy.provider}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.coverage', 'Coverage')}</p>
              <p className="text-sm font-bold text-ink">AED {Number(policy.coverage_aed).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.premium', 'Premium')}</p>
              <p className="text-sm font-bold text-brand-primary">AED {Number(policy.premium_aed).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.status', 'Status')}</p>
              <Badge color="success">{policy.status}</Badge>
            </div>
          </div>

          <div className="pt-4 border-t flex gap-2">
            <Button variant="danger" onClick={handleCancel} loading={bindLoading} className="flex-1">
              <IconX size={16} /> {t('insurance.cancelPolicy', 'Cancel policy')}
            </Button>
          </div>
        </Card>

        {infoPanel}
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t('insurance.getQuote', 'Get insurance quote')}</h1>
        <p className="text-ink-muted mt-1">{t('insurance.getQuoteDesc', 'Enter the cargo value to get an instant quote for Goods-in-Transit coverage')}</p>
      </div>

      {providerInfo && !providerInfo.configured && (
        <Card className="mb-4 p-4" style={{ background: 'var(--status-warning-bg)' }}>
          <p className="text-sm" style={{ color: 'var(--status-warning)' }}>{t('insurance.providerDark', 'This provider is not configured yet — quotes work, but binding a real policy will fail until it is.')}</p>
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <form onSubmit={handleQuote} className="space-y-4">
          <div>
            <Label htmlFor="cargoValue">{t('insurance.cargoValue', 'Cargo value (AED)')}</Label>
            <Input id="cargoValue" type="number" required min="1" step="1000" value={cargoValueAed} onChange={(e) => setCargoValueAed(e.target.value)} placeholder="50000" />
          </div>

          <Button type="submit" loading={loading} className="w-full">
            <IconShield size={16} /> {t('insurance.getQuoteBtn', 'Get quote')}
          </Button>
        </form>

        {quote && (
          <div className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-ink">{t('insurance.quoteResult', 'Quote result')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg" style={{ background: 'var(--surface-container-high)' }}>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.premium', 'Premium')}</p>
                <p className="font-bold text-2xl text-brand-primary">AED {Number(quote.premiumAed).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.coverage', 'Coverage')}</p>
                <p className="font-bold text-lg text-ink">AED {Number(quote.coverageAed).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.rate', 'Rate')}</p>
                <p className="font-bold text-2xl text-ink">{(quote.rateBps / 100).toFixed(2)}%</p>
              </div>
            </div>

            <Button type="button" onClick={handleBind} loading={bindLoading} className="w-full" disabled={!quote.configured}>
              <IconCheckCircle size={16} /> {t('insurance.bindPolicy', 'Bind policy')}
            </Button>
            {!quote.configured && (
              <p className="text-xs text-center" style={{ color: 'var(--status-warning)' }}>{t('insurance.cannotBindDark', 'This provider is not configured — binding is disabled until it is.')}</p>
            )}
          </div>
        )}

        {infoPanel}
      </Card>
    </div>
  );
}

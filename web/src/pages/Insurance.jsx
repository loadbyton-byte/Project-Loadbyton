import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge, Select, Textarea } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconShield, IconInfo, IconAlertTriangle, IconCheckCircle, IconX } from '../components/icons.jsx';

export default function Insurance() {
  usePageTitle('Insurance');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const { id } = useParams();

  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [form, setForm] = useState({
    cargoValue: '',
    cargoType: 'general',
    transportMode: 'road',
    coverage: 'FULL',
    deductible: 0,
  });
  const [bindLoading, setBindLoading] = useState(false);

  useEffect(() => {
    fetchJob();
  }, [id]);

  async function fetchJob() {
    try {
      const job = await api.getJob(id);
      if (job.insurance) setPolicy(job.insurance);
    } catch (e) {
      addToast(t('insurance.errorLoadJob') || 'Failed to load job', 'error');
    }
  }

  async function handleQuote(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const q = await api.getInsuranceQuote(id, form);
      setQuote(q);
      addToast(t('insurance.quoteSuccess') || 'Quote generated', 'success');
    } catch (e) {
      addToast(e.message || t('insurance.quoteError') || 'Failed to get quote', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleBind(e) {
    e.preventDefault();
    setBindLoading(true);
    try {
      const p = await api.bindInsurance(id, { quoteId: quote.quoteId });
      setPolicy(p);
      setQuote(null);
      addToast(t('insurance.bindSuccess') || 'Policy bound', 'success');
    } catch (e) {
      addToast(e.message || t('insurance.bindError') || 'Failed to bind policy', 'error');
    } finally {
      setBindLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm(t('insurance.confirmCancel') || 'Cancel this policy?')) return;
    setBindLoading(true);
    try {
      await api.cancelInsurance(id);
      setPolicy(null);
      addToast(t('insurance.cancelSuccess') || 'Policy cancelled', 'success');
    } catch (e) {
      addToast(e.message || t('insurance.cancelError') || 'Failed to cancel', 'error');
    } finally {
      setBindLoading(false);
    }
  }

  if (policy) {
    return (
      <div className="container-page max-w-3xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">{t('insurance.activePolicy') || 'Active Insurance Policy'}</h1>
          <p className="text-ink-muted mt-1">{t('insurance.policyDesc') || 'Your cargo is covered for this job'}</p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.policyId') || 'Policy ID'}</p>
              <p className="font-mono text-sm text-ink">{policy.policy_id}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.provider') || 'Provider'}</p>
              <p className="text-sm text-ink">{policy.provider || 'GIT Broker'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.coverage') || 'Coverage'}</p>
              <p className="text-sm text-ink">{policy.coverage || 'FULL'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.sumInsured') || 'Sum Insured'}</p>
              <p className="text-sm font-bold text-ink">AED {policy.sum_insured?.toLocaleString() || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.premium') || 'Premium'}</p>
              <p className="text-sm font-bold text-brand-primary">AED {policy.premium_aed?.toLocaleString() || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide">{t('insurance.status') || 'Status'}</p>
              <Badge color={policy.status === 'ACTIVE' ? 'success' : 'neutral'}>{policy.status}</Badge>
            </div>
          </div>

          <div className="pt-4 border-t flex gap-2">
            <Button variant="destructive" onClick={handleCancel} loading={bindLoading} className="flex-1">
              <IconX size={16} className="mr-2" /> {t('insurance.cancelPolicy') || 'Cancel Policy'}
            </Button>
          </div>
        </Card>

        <Card className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <IconInfo size={20} className="text-brand-secondary mt-0.5" />
            <div className="text-sm text-ink-secondary space-y-1">
              <p>{t('insurance.infoProvider') || 'Policies issued via GIT Broker (Goods in Transit Insurance)'}</p>
              <p>{t('insurance.infoClaims') || 'Claims filed directly with provider; Loadbyton facilitates documentation'}</p>
              <p>{t('insurance.infoCoverage') || 'Coverage starts at PICKED_UP status and ends at DELIVERED'}</p>
              <p>{t('insurance.infoExclusions') || 'Exclusions: war, nuclear, inherent vice, delay, insufficient packing'}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t('insurance.getQuote') || 'Get Insurance Quote'}</h1>
        <p className="text-ink-muted mt-1">{t('insurance.getQuoteDesc') || 'Enter cargo details to get an instant quote for Goods in Transit coverage'}</p>
      </div>

      <Card className="p-6 space-y-4">
        <form onSubmit={handleQuote} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cargoValue">{t('insurance.cargoValue') || 'Cargo Value (AED)'}</Label>
              <Input id="cargoValue" type="number" required min="1" step="1000" value={form.cargoValue} onChange={(e) => setForm({ ...form, cargoValue: e.target.value })} placeholder="50000" />
            </div>
            <div>
              <Label htmlFor="cargoType">{t('insurance.cargoType') || 'Cargo Type'}</Label>
              <Select id="cargoType" value={form.cargoType} onChange={(e) => setForm({ ...form, cargoType: e.target.value })}>
                <option value="general">{t('insurance.cargoGeneral') || 'General goods'}</option>
                <option value="perishable">{t('insurance.cargoPerishable') || 'Perishable'}</option>
                <option value="hazardous">{t('insurance.cargoHazardous') || 'Hazardous (ADR)'}</option>
                <option value="high_value">{t('insurance.cargoHighValue') || 'High value / electronics'}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="transportMode">{t('insurance.transportMode') || 'Transport Mode'}</Label>
              <Select id="transportMode" value={form.transportMode} onChange={(e) => setForm({ ...form, transportMode: e.target.value })}>
                <option value="road">{t('insurance.modeRoad') || 'Road'}</option>
                <option value="sea">{t('insurance.modeSea') || 'Sea'}</option>
                <option value="air">{t('insurance.modeAir') || 'Air'}</option>
                <option value="multimodal">{t('insurance.modeMulti') || 'Multimodal'}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="coverage">{t('insurance.coverageLevel') || 'Coverage Level'}</Label>
              <Select id="coverage" value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })}>
                <option value="FULL">{t('insurance.coverageFull') || 'All risks (FULL)'}</option>
                <option value="TOTAL_LOSS">{t('insurance.coverageTotalLoss') || 'Total loss only'}</option>
                <option value="NAMED_PERILS">{t('insurance.coverageNamed') || 'Named perils'}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="deductible">{t('insurance.deductible') || 'Deductible (AED)'}</Label>
              <Input id="deductible" type="number" min="0" step="500" value={form.deductible} onChange={(e) => setForm({ ...form, deductible: Number(e.target.value) })} placeholder="0" />
            </div>
          </div>

          <Button type="submit" loading={loading} className="w-full" style={{ marginTop: '8px' }}>
            <IconShield size={16} className="mr-2" /> {t('insurance.getQuoteBtn') || 'Get Quote'}
          </Button>
        </form>

        {quote && (
          <div className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-ink">{t('insurance.quoteResult') || 'Quote Result'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg" style={{ background: 'var(--surface-container-high)' }}>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.premium') || 'Premium'}</p>
                <p className="font-bold text-2xl text-brand-primary">AED {quote.premium_aed?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.tax') || 'VAT (5%)'}</p>
                <p className="font-bold text-lg text-ink">AED {quote.vat_aed?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">{t('insurance.total') || 'Total'}</p>
                <p className="font-bold text-2xl text-ink">AED {quote.total_aed?.toLocaleString()}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--outline-variant)' }}>
              <h4 className="font-medium text-ink mb-2">{t('insurance.coverageDetails') || 'Coverage Details'}</h4>
              <ul className="space-y-1 text-sm text-ink-secondary">
                <li>• {t('insurance.coversTransit') || 'Covers transit from pickup to delivery'}</li>
                <li>• {t('insurance.coversTheft') || 'Theft, damage, loss during transport'}</li>
                <li>• {t('insurance.coversLoading') || 'Loading/unloading incidents'}</li>
                <li>• {quote.deductible ? `${t('insurance.deductibleApplies') || 'Deductible applies'}: AED ${quote.deductible.toLocaleString()}` : `${t('insurance.noDeductible') || 'No deductible'}`}</li>
              </ul>
            </div>

            <Button type="button" onClick={handleBind} loading={bindLoading} className="w-full" style={{ marginTop: '8px' }}>
              <IconCheckCircle size={16} className="mr-2" /> {t('insurance.bindPolicy') || 'Bind Policy'}
            </Button>

            <p className="text-xs text-center text-ink-muted">{t('insurance.quoteValid') || 'Quote valid for 24 hours'}</p>
          </div>
        )}

        <Card className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <IconInfo size={20} className="text-brand-secondary mt-0.5" />
            <div className="text-sm text-ink-secondary space-y-1">
              <p>{t('insurance.infoProvider') || 'Policies issued via GIT Broker (Goods in Transit Insurance)'}</p>
              <p>{t('insurance.infoClaims') || 'Claims filed directly with provider; Loadbyton facilitates documentation'}</p>
              <p>{t('insurance.infoCoverage') || 'Coverage starts at PICKED_UP status and ends at DELIVERED'}</p>
              <p>{t('insurance.infoExclusions') || 'Exclusions: war, nuclear, inherent vice, delay, insufficient packing'}</p>
            </div>
          </div>
        </Card>
      </Card>
    </div>
  );
}
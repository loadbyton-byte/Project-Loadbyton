import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge, Modal, Select } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconPlus, IconUser, IconTruck, IconSearch, IconCheckCircle, IconAlert } from '../components/icons.jsx';

export default function BrokerCarriers() {
  usePageTitle('Carrier Roster');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [carriers, setCarriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: '', companyName: '', spreadBps: 0 });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCarriers();
  }, []);

  async function fetchCarriers() {
    try {
      const data = await api.listBrokerCarriers();
      setCarriers(data.carriers || []);
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || t('broker.errorLoad', 'Failed to load carriers') });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.addBrokerCarrier(form);
      addToast({ type: 'status_change', title: t('broker.added', 'Carrier added to roster') });
      setShowModal(false);
      setForm({ email: '', companyName: '', spreadBps: 0 });
      fetchCarriers();
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || t('broker.addError', 'Failed to add carrier') });
    } finally {
      setSubmitting(false);
    }
  }

  const filteredCarriers = carriers.filter((c) =>
    c.company_name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.trn?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container-page max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('broker.carrierRoster', 'Carrier Roster')}</h1>
          <p className="text-ink-muted mt-1">{t('broker.carrierRosterDesc', 'Manage your verified carriers for direct-assign')}</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <IconPlus size={16} className="mr-2" /> {t('broker.addCarrier', 'Add Carrier')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>
      ) : filteredCarriers.length === 0 ? (
        <Card className="p-12 text-center">
          <IconTruck size={48} className="mx-auto text-ink-muted mb-4" />
          <h3 className="font-semibold text-ink mb-2">{t('broker.noCarriers', 'No carriers in roster')}</h3>
          <p className="text-ink-muted mb-6">{t('broker.noCarriersDesc', 'Add verified carriers to enable direct-assign')}</p>
          <Button onClick={() => setShowModal(true)}><IconPlus size={16} className="mr-2" /> {t('broker.addFirstCarrier', 'Add First Carrier')}</Button>
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <div className="relative max-w-md">
              <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input type="text" placeholder={t('broker.searchPlaceholder', 'Search carriers...')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
          </div>

          <Card className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-muted bg-surface-container-high">
                  <th className="px-4 py-3">{t('broker.carrier', 'Carrier')}</th>
                  <th className="px-4 py-3">{t('broker.trn', 'TRN')}</th>
                  <th className="px-4 py-3">{t('broker.verified', 'Verified')}</th>
                  <th className="px-4 py-3">{t('broker.defaultSpread', 'Default Spread')}</th>
                  <th className="px-4 py-3">{t('broker.added', 'Added')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filteredCarriers.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-container-high">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                          <IconTruck size={18} />
                        </div>
                        <div>
                          <p className="font-medium text-ink">{c.company_name}</p>
                          <p className="text-sm text-ink-muted">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-ink">{c.trn || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={c.is_verified ? 'success' : 'warning'}>{c.is_verified ? t('broker.verified') : t('broker.pending')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">{c.default_spread_bps ? `${(c.default_spread_bps / 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-muted">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('broker.addCarrierModal', 'Add Carrier to Roster')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">{t('broker.carrierEmail', 'Carrier Email')}</Label>
            <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="carrier@company.ae" />
            <p className="mt-1 text-xs text-ink-muted">{t('broker.emailHint', 'Must be a registered and verified carrier on Loadbyton')}</p>
          </div>
          <div>
            <Label htmlFor="companyName">{t('broker.companyName', 'Company Name')}</Label>
            <Input id="companyName" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Al-Majid Transport" />
          </div>
          <div>
            <Label htmlFor="spreadBps">{t('broker.defaultSpread', 'Default Broker Spread (bps)')}</Label>
            <Input id="spreadBps" type="number" min="0" max="2000" step="10" value={form.spreadBps} onChange={(e) => setForm({ ...form, spreadBps: Number(e.target.value) })} placeholder="100" />
            <p className="mt-1 text-xs text-ink-muted">{t('broker.spreadHint', '0-2000 bps (0-20%). Applied to direct-assign if not overridden per job.')}</p>
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" loading={submitting} className="flex-1">{t('broker.addCarrierBtn', 'Add Carrier')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
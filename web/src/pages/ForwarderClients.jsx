import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge, Modal } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconPlus, IconUser, IconPackage, IconSearch, IconCheckCircle } from '../components/icons.jsx';

export default function ForwarderClients() {
  usePageTitle('Client Roster');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  // Matches the real schema (server/schema.js's forwarder_clients table)
  // exactly: client_name, contact_phone, contact_email — that's the whole
  // row. This page previously invented a contactName/email/trn vocabulary
  // that never existed on the backend at all (no contact-person name field,
  // no TRN column) — invisible until real seed data first populated this
  // table today, since an empty list never exercises the display filter or
  // a real submit.
  const [form, setForm] = useState({ clientName: '', contactPhone: '', contactEmail: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    try {
      const data = await api.listForwarderClients();
      setClients(data.clients || []);
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || t('forwarder.errorLoad', 'Failed to load clients') });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.addForwarderClient(form);
      addToast({ type: 'status_change', title: t('forwarder.added', 'Client added to roster') });
      setShowModal(false);
      setForm({ clientName: '', contactPhone: '', contactEmail: '' });
      fetchClients();
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || t('forwarder.addError', 'Failed to add client') });
    } finally {
      setSubmitting(false);
    }
  }

  const filteredClients = clients.filter((c) => {
    const needle = search.toLowerCase();
    return (
      c.client_name?.toLowerCase().includes(needle) ||
      c.contact_email?.toLowerCase().includes(needle) ||
      c.contact_phone?.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="container-page max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('forwarder.clientRoster', 'Client Roster')}</h1>
          <p className="text-ink-muted mt-1">{t('forwarder.clientRosterDesc', 'Manage your shipper clients for direct-assign')}</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <IconPlus size={16} className="mr-2" /> {t('forwarder.addClient', 'Add Client')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>
      ) : filteredClients.length === 0 ? (
        <Card className="p-12 text-center">
          <IconPackage size={48} className="mx-auto text-ink-muted mb-4" />
          <h3 className="font-semibold text-ink mb-2">{t('forwarder.noClients', 'No clients in roster')}</h3>
          <p className="text-ink-muted mb-6">{t('forwarder.noClientsDesc', 'Add shipper clients to enable direct-assign')}</p>
          <Button onClick={() => setShowModal(true)}><IconPlus size={16} className="mr-2" /> {t('forwarder.addFirstClient', 'Add First Client')}</Button>
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <div className="relative max-w-md">
              <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input type="text" placeholder={t('forwarder.searchPlaceholder', 'Search clients...')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
          </div>

          <Card className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-muted bg-surface-container-high">
                  <th className="px-4 py-3">{t('forwarder.client', 'Client')}</th>
                  <th className="px-4 py-3">{t('forwarder.phone', 'Phone')}</th>
                  <th className="px-4 py-3">{t('forwarder.email', 'Email')}</th>
                  <th className="px-4 py-3">{t('forwarder.added', 'Added')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filteredClients.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-container-high">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                          <IconPackage size={18} />
                        </div>
                        <div>
                          <p className="font-medium text-ink">{c.client_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">{c.contact_phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-muted">{c.contact_email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-muted">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('forwarder.addClientModal', 'Add Client to Roster')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="clientName">{t('forwarder.companyName', 'Client Name')}</Label>
            <Input id="clientName" required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Emirates Steel" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contactPhone">{t('forwarder.phone', 'Phone')}</Label>
              <Input id="contactPhone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="05XXXXXXXX" />
            </div>
            <div>
              <Label htmlFor="contactEmail">{t('forwarder.email', 'Email')}</Label>
              <Input id="contactEmail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="contact@company.ae" />
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" loading={submitting} className="flex-1">{t('forwarder.addClientBtn', 'Add Client')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
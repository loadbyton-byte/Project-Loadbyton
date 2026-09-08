import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Input, Label, EmptyState, ErrorState, Badge, Modal, Select } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconPlus, IconPackage, IconFile, IconSearch, IconArrowRight } from '../components/icons.jsx';

const CONSIGNMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION'];

export default function EdiConsignments() {
  usePageTitle('EDI Consignments');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const navigate = useNavigate();

  const [consignments, setConsignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchConsignments();
  }, []);

  async function fetchConsignments() {
    try {
      const data = await api.listConsignments();
      setConsignments(data.consignments || []);
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Failed to load consignments' });
    } finally {
      setLoading(false);
    }
  }

  const filtered = consignments.filter((c) =>
    c.consignment_id.toLowerCase().includes(search.toLowerCase()) ||
    c.origin.toLowerCase().includes(search.toLowerCase()) ||
    c.destination.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;

  return (
    <div className="container-page max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('edi.title', 'EDI Consignments')}</h1>
          <p className="text-ink-muted mt-1">{t('edi.desc', 'Manage EDI consignments and transitions')}</p>
        </div>
        <Button onClick={async () => {
          try {
            await api.ingestEdi({ test: true });
            addToast({ type: 'status_change', title: 'EDI ingest triggered' });
            fetchConsignments();
          } catch (e) { addToast({ type: 'system_message', title: e.message || 'Failed' }); }
        }}>
          <IconPlus size={16} className="mr-2" /> {t('edi.ingest', 'Ingest EDI')}
        </Button>
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input type="text" placeholder={t('edi.searchPlaceholder', 'Search consignments...')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <IconPackage size={48} className="mx-auto text-ink-muted mb-4" />
          <h3 className="font-semibold text-ink mb-2">{t('edi.none', 'No consignments')}</h3>
          <p className="text-ink-muted mb-6">{t('edi.noneDesc', 'Ingest EDI files to see consignments here')}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-muted bg-surface-container-high">
                <th className="px-4 py-3">{t('edi.consignmentId', 'Consignment ID')}</th>
                <th className="px-4 py-3">{t('edi.origin', 'Origin')}</th>
                <th className="px-4 py-3">{t('edi.destination', 'Destination')}</th>
                <th className="px-4 py-3">{t('edi.status', 'Status')}</th>
                <th className="px-4 py-3">{t('edi.linkedJob', 'Linked Job')}</th>
                <th className="px-4 py-3">{t('edi.updated', 'Updated')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-surface-container-high">
                  <td className="px-4 py-3 font-mono text-sm text-ink">{c.consignment_id}</td>
                  <td className="px-4 py-3 text-sm text-ink">{c.origin}</td>
                  <td className="px-4 py-3 text-sm text-ink">{c.destination}</td>
                  <td className="px-4 py-3"><Badge color={c.status === 'DELIVERED' ? 'success' : c.status === 'EXCEPTION' ? 'danger' : c.status === 'IN_TRANSIT' ? 'warning' : 'neutral'}>{c.status}</Badge></td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{c.job_code || '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/edi/consignments/${c.id}`)}>
                      <IconArrowRight size={14} /> View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
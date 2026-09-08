import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Input, Label, EmptyState, ErrorState, Badge, Modal, Select } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconPlus, IconPackage, IconGavel, IconFile, IconSearch, IconCheckCircle, IconClock } from '../components/icons.jsx';

export default function RfpList() {
  usePageTitle('RFPs');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const navigate = useNavigate();

  const [rfps, setRfps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', origin: '', destination: '', equipmentType: 'CONTAINER_CHASSIS', cargoType: 'GENERAL_GOODS', deadline: '', budgetAed: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchRfps();
  }, []);

  async function fetchRfps() {
    try {
      const data = await api.listRfps();
      setRfps(data.rfps || []);
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Failed to load RFPs' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createRfp(form);
      addToast({ type: 'status_change', title: 'RFP created' });
      setShowModal(false);
      setForm({ title: '', description: '', origin: '', destination: '', equipmentType: 'CONTAINER_CHASSIS', cargoType: 'GENERAL_GOODS', deadline: '', budgetAed: '' });
      fetchRfps();
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Failed to create RFP' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;

  return (
    <div className="container-page max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('rfp.title', 'Request for Proposals')}</h1>
          <p className="text-ink-muted mt-1">{t('rfp.desc', 'Manage your RFPs and carrier bids')}</p>
        </div>
        <Button onClick={() => setShowModal(true)}><IconPlus size={16} className="mr-2" /> {t('rfp.create', 'Create RFP')}</Button>
      </div>

      {rfps.length === 0 ? (
        <Card className="p-12 text-center">
          <IconPackage size={48} className="mx-auto text-ink-muted mb-4" />
          <h3 className="font-semibold text-ink mb-2">{t('rfp.none', 'No RFPs yet')}</h3>
          <p className="text-ink-muted mb-6">{t('rfp.noneDesc', 'Create your first RFP to receive carrier proposals')}</p>
          <Button onClick={() => setShowModal(true)}><IconPlus size={16} className="mr-2" /> {t('rfp.createFirst', 'Create First RFP')}</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {rfps.map((rfp) => (
            <Card key={rfp.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-lg font-semibold text-ink">{rfp.title}</h3>
                    <Badge color={rfp.status === 'OPEN' ? 'primary' : rfp.status === 'AWARDED' ? 'success' : 'neutral'}>{rfp.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{rfp.origin} → {rfp.destination}</p>
                  <p className="text-xs text-ink-muted">Deadline: {rfp.deadline ? new Date(rfp.deadline).toLocaleString() : '—'} · Budget: AED {rfp.budget_aed?.toLocaleString() || '—'}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/rfps/${rfp.id}`)}>View</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('rfp.createModal', 'Create RFP')}>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <Label>{t('rfp.title', 'Title')}</Label>
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Jebel Ali → Riyadh weekly lane" />
          </div>
          <div>
            <Label>{t('rfp.description', 'Description')}</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Weekly container moves, 40HC dry" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>{t('rfp.origin', 'Origin')}</Label>
              <Input required value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="Jebel Ali Port" />
            </div>
            <div>
              <Label>{t('rfp.destination', 'Destination')}</Label>
              <Input required value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Riyadh Dry Port" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>{t('rfp.equipmentType', 'Equipment Type')}</Label>
              <Select value={form.equipmentType} onChange={(e) => setForm({ ...form, equipmentType: e.target.value })}>
                <option value="CONTAINER_CHASSIS">Container Chassis</option>
                <option value="TRAILER_WITH_GENSET">Trailer with Genset</option>
                <option value="LOWBED_TRAILER">Lowbed Trailer</option>
                <option value="FLATBED_TRAILER">Flatbed Trailer</option>
                <option value="BOX_TRUCK">Box Truck</option>
              </Select>
            </div>
            <div>
              <Label>{t('rfp.cargoType', 'Cargo Type')}</Label>
              <Select value={form.cargoType} onChange={(e) => setForm({ ...form, cargoType: e.target.value })}>
                <option value="GENERAL_GOODS">General Goods</option>
                <option value="ELECTRONICS">Electronics</option>
                <option value="FOODSTUFF_PERISHABLES">Foodstuff / Perishables</option>
                <option value="MACHINERY_EQUIPMENT">Machinery & Equipment</option>
                <option value="CHEMICALS_HAZMAT">Chemicals / Hazmat</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>{t('rfp.deadline', 'Deadline')}</Label>
              <Input type="datetime-local" required value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <Label>{t('rfp.budgetAed', 'Budget (AED)')}</Label>
              <Input type="number" min="1" required value={form.budgetAed} onChange={(e) => setForm({ ...form, budgetAed: e.target.value })} placeholder="50000" />
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" loading={submitting} className="flex-1">{t('rfp.createBtn', 'Create RFP')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
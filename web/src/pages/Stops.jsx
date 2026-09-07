import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge, Modal, Select } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconPlus, IconMapPin, IconCheckCircle, IconTruck, IconPackage, IconX, IconAlert } from '../components/icons.jsx';

const STOP_TYPES = ['PICKUP', 'DELIVERY', 'BORDER_CROSSING', 'FUEL_STOP', 'REST_STOP', 'CUSTOMS', 'WEIGH_STATION', 'OTHER'];

export default function Stops() {
  usePageTitle('Job Stops');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const navigate = useNavigate();
  const { id } = useParams();

  const [job, setJob] = useState(null);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStop, setEditingStop] = useState(null);
  const [form, setForm] = useState({
    stopType: 'PICKUP',
    location: '',
    addressDetail: '',
    lat: '',
    lng: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  async function fetchData() {
    setLoading(true);
    try {
      const [jobData, stopsData] = await Promise.all([
        api.getJob(id),
        api.listStops(id),
      ]);
      setJob(jobData);
      setStops(stopsData.stops || []);
    } catch (e) {
      addToast(e.message || t('stops.errorLoad') || 'Failed to load stops', 'error');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ stopType: 'PICKUP', location: '', addressDetail: '', lat: '', lng: '' });
  }

  function openCreateModal() {
    resetForm();
    setEditingStop(null);
    setShowModal(true);
  }

  function openEditModal(stop) {
    setEditingStop(stop);
    setForm({
      stopType: stop.stop_type,
      location: stop.location,
      addressDetail: stop.address_detail || '',
      lat: stop.lat || '',
      lng: stop.lng || '',
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingStop(null);
    resetForm();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        stopType: form.stopType,
        location: form.location,
        addressDetail: form.addressDetail || undefined,
        lat: form.lat ? Number(form.lat) : undefined,
        lng: form.lng ? Number(form.lng) : undefined,
      };

      if (editingStop) {
        // For editing, we'd need a PATCH endpoint - but backend only has POST and DELETE
        // For now, delete and recreate (or we could add PATCH to backend)
        // Since we don't have PATCH, we'll just delete and recreate
        await api.deleteStop(id, editingStop.id);
        await api.createStop(id, payload);
        addToast(t('stops.updated') || 'Stop updated', 'success');
      } else {
        await api.createStop(id, payload);
        addToast(t('stops.created') || 'Stop added', 'success');
      }
      closeModal();
      fetchData();
    } catch (e) {
      addToast(e.message || t('stops.saveError') || 'Failed to save stop', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(stop) {
    if (stop.completed_at) return;
    try {
      await api.completeStop(id, stop.id);
      addToast(t('stops.completed') || 'Stop marked complete', 'success');
      fetchData();
    } catch (e) {
      addToast(e.message || t('stops.completeError') || 'Failed to complete stop', 'error');
    }
  }

  async function handleDelete(stop) {
    if (!confirm(t('stops.confirmDelete') || 'Delete this stop?')) return;
    if (stop.completed_at) {
      addToast(t('stops.cannotDeleteCompleted') || 'Cannot delete completed stop', 'error');
      return;
    }
    try {
      await api.deleteStop(id, stop.id);
      addToast(t('stops.deleted') || 'Stop deleted', 'success');
      fetchData();
    } catch (e) {
      addToast(e.message || t('stops.deleteError') || 'Failed to delete stop', 'error');
    }
  }

  const canEdit = job && ['OPEN', 'QUOTING', 'AWARDED', 'PICKED_UP'].includes(job.status);
  const canComplete = job && ['PICKED_UP', 'IN_TRANSIT'].includes(job.status);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  }

  if (!job) {
    return (
      <div className="container-page max-w-3xl text-center py-12">
        <IconAlert size={48} className="mx-auto text-status-warning mb-4" />
        <h2 className="font-display text-xl font-bold text-ink mb-2">{t('common.notFound') || 'Job not found'}</h2>
        <Button onClick={() => navigate(-1)}>{t('common.back') || 'Go Back'}</Button>
      </div>
    );
  }

  return (
    <div className="container-page max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t('stops.title') || 'Job Stops'}</h1>
          <p className="text-ink-muted mt-1">{job.job_code} · {job.pickup_terminal} → {job.delivery_area}</p>
        </div>
        {canEdit && <Button onClick={openCreateModal}><IconPlus size={16} className="mr-2" /> {t('stops.addStop') || 'Add Stop'}</Button>}
      </div>

      <div className="mb-4 p-4 rounded-lg" style={{ background: 'var(--surface-container-high)' }}>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: 'var(--status-success)' }} />
            <span className="text-ink-muted">{t('stops.completed') || 'Completed'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: 'var(--brand-primary)' }} />
            <span className="text-ink-muted">{t('stops.pending') || 'Pending'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border" style={{ borderColor: 'var(--outline-variant)' }} />
            <span className="text-ink-muted">{t('stops.upcoming') || 'Upcoming'}</span>
          </div>
        </div>
      </div>

      {stops.length === 0 ? (
        <Card className="p-12 text-center">
          <IconMapPin size={48} className="mx-auto text-ink-muted mb-4" />
          <h3 className="font-semibold text-ink mb-2">{t('stops.noStops') || 'No stops defined'}</h3>
          <p className="text-ink-muted mb-6">{t('stops.noStopsDesc') || 'Add pickup, delivery, and intermediate stops for this job'}</p>
          {canEdit && <Button onClick={openCreateModal}><IconPlus size={16} className="mr-2" /> {t('stops.addFirstStop') || 'Add First Stop'}</Button>}
        </Card>
      ) : (
        <div className="space-y-3">
          {stops.map((stop, index) => (
            <Card key={stop.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold" style={{
                  background: stop.completed_at ? 'var(--status-success-bg)' : index === 0 ? 'var(--brand-primary-bg)' : 'var(--surface-container-high)',
                  color: stop.completed_at ? 'var(--status-success)' : index === 0 ? 'var(--brand-primary)' : 'var(--text-muted)',
                }}>
                  {stop.completed_at ? <IconCheckCircle size={16} /> : (index + 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color={
                      stop.stop_type === 'PICKUP' ? 'success' :
                      stop.stop_type === 'DELIVERY' ? 'primary' :
                      stop.stop_type === 'BORDER_CROSSING' ? 'warning' :
                      'neutral'
                    }>{stop.stop_type}</Badge>
                    {stop.completed_at && <Badge color="success">{t('stops.completed') || 'Completed'}</Badge>}
                    {!stop.completed_at && index === 0 && <Badge color="primary">{t('stops.current') || 'Current'}</Badge>}
                  </div>
                  <p className="font-medium text-ink truncate">{stop.location}</p>
                  {stop.address_detail && <p className="text-sm text-ink-muted truncate">{stop.address_detail}</p>}
                  {stop.lat && stop.lng && (
                    <p className="text-xs text-ink-muted font-mono">{Number(stop.lat).toFixed(6)}, {Number(stop.lng).toFixed(6)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && !stop.completed_at && (
                    <Button variant="ghost" size="sm" onClick={() => openEditModal(stop)} aria-label={t('stops.edit') || 'Edit'}>
                      <IconMapPin size={16} />
                    </Button>
                  )}
                  {canComplete && !stop.completed_at && (
                    <Button variant="secondary" size="sm" onClick={() => handleComplete(stop)}>
                      <IconCheckCircle size={14} className="mr-1" /> {t('stops.complete') || 'Complete'}
                    </Button>
                  )}
                  {canEdit && !stop.completed_at && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(stop)} aria-label={t('stops.delete') || 'Delete'} className="text-status-danger hover:text-status-danger">
                      <IconX size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={closeModal} title={editingStop ? t('stops.editStop') : t('stops.addStop')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="stopType">{t('stops.type') || 'Stop Type'}</Label>
            <Select id="stopType" value={form.stopType} onChange={(e) => setForm({ ...form, stopType: e.target.value })}>
              {STOP_TYPES.map((type) => (
                <option key={type} value={type}>{t(`stops.type.${type.toLowerCase()}`) || type}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="location">{t('stops.location') || 'Location Name'}</Label>
            <Input id="location" required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t('stops.locationPlaceholder') || 'e.g., Jebel Ali Port Gate 4'} />
          </div>
          <div>
            <Label htmlFor="addressDetail">{t('stops.addressDetail') || 'Address Details (optional)'}</Label>
            <Input id="addressDetail" value={form.addressDetail} onChange={(e) => setForm({ ...form, addressDetail: e.target.value })} placeholder="Building 12, Street 5" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lat">{t('stops.latitude') || 'Latitude'}</Label>
              <Input id="lat" type="number" step="any" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="25.012345" />
            </div>
            <div>
              <Label htmlFor="lng">{t('stops.longitude') || 'Longitude'}</Label>
              <Input id="lng" type="number" step="any" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="55.123456" />
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={closeModal} className="flex-1">{t('common.cancel') || 'Cancel'}</Button>
            <Button type="submit" loading={submitting} className="flex-1">{editingStop ? t('stops.update') : t('stops.add')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button, Input, Label, Card, Badge, Modal } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconPlus, IconUser, IconTruck, IconClock, IconCheckCircle, IconX, IconAlert, IconBell } from '../components/icons.jsx';

export default function TripOffers() {
  usePageTitle('Trip Offers');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const navigate = useNavigate();
  const { id } = useParams();

  const [job, setJob] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  async function fetchData() {
    setLoading(true);
    try {
      const [jobData, driversData, offersData] = await Promise.all([
        api.getJob(id),
        api.listDrivers(),
        // Note: no direct API for trip_offers list yet, we'll get from job data
      ]);
      setJob(jobData);
      setDrivers(driversData.drivers || []);
      // Fetch trip offers for this job
      // There's no dedicated endpoint, but we can check job for pending offer
    } catch (e) {
      addToast(e.message || t('tripOffer.errorLoad') || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }

  const activeOffer = job?.trip_offer;
  const eligibleDrivers = drivers.filter(d => d.seat_user_id && d.is_active);

  async function handleSendOffer(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createTripOffer(id, { driverId: selectedDriver.id });
      addToast(t('tripOffer.sent') || 'Trip offer sent to driver', 'success');
      setShowModal(false);
      setSelectedDriver(null);
      fetchData();
    } catch (e) {
      addToast(e.message || t('tripOffer.sendError') || 'Failed to send offer', 'error');
    } finally {
      setSubmitting(false);
    }
  }

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
    <div className="container-page max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold text-ink">{t('tripOffer.title') || 'Trip Offers'}</h1>
          <Badge color="neutral">{job.job_code}</Badge>
        </div>
        <p className="text-ink-muted">{job.pickup_terminal} → {job.delivery_area} · {t('tripOffer.status') || 'Status'}: <span className="font-medium capitalize">{job.status.toLowerCase().replace('_', ' ')}</span></p>
      </div>

      {/* Active Offer */}
      <Card className="mb-6 p-6">
        <h3 className="font-semibold text-ink mb-4 flex items-center gap-2">
          <IconBell size={20} className={activeOffer?.status === 'PENDING' ? 'text-brand-primary' : 'text-status-success'} />
          {activeOffer ? (
            activeOffer.status === 'PENDING' ? t('tripOffer.pendingOffer') : t('tripOffer.acceptedOffer')
          ) : t('tripOffer.noActiveOffer')}
        </h3>

        {activeOffer && activeOffer.status === 'PENDING' ? (
          <div className="space-y-3">
            <div className="p-4 rounded-lg" style={{ background: 'var(--surface-container-high)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                    <IconUser size={22} />
                  </div>
                  <div>
                    <p className="font-medium text-ink">{activeOffer.driver_name || activeOffer.driver_id}</p>
                    <p className="text-sm text-ink-muted">{t('tripOffer.sentAt') || 'Sent'}: {activeOffer.created_at ? new Date(activeOffer.created_at).toLocaleString() : '—'}</p>
                  </div>
                </div>
                <Badge color="warning">{t('tripOffer.pending') || 'Pending'}</Badge>
              </div>
              <p className="text-sm text-ink-muted mt-2">{t('tripOffer.driverDeciding') || 'Driver is deciding via WhatsApp. They can Accept or Decline.'}</p>
            </div>
          </div>
        ) : activeOffer && activeOffer.status === 'ACCEPTED' ? (
          <div className="p-4 rounded-lg" style={{ background: 'var(--status-success-bg)' }}>
            <div className="flex items-center gap-3">
              <IconCheckCircle size={22} className="text-status-success" />
              <div>
                <p className="font-medium text-ink">{t('tripOffer.accepted') || 'Offer accepted by driver'}</p>
                <p className="text-sm text-ink-muted">{activeOffer.driver_name || 'Driver'} {t('tripOffer.isAssigned') || 'is now assigned to this job'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-ink-muted">
            <IconTruck size={32} className="mx-auto mb-3 opacity-50" />
            <p>{t('tripOffer.noOfferDesc') || 'No active trip offer. Send one to a driver from your roster.'}</p>
            {!activeOffer && eligibleDrivers.length > 0 && (
              <Button onClick={() => setShowModal(true)} className="mt-4">
                <IconPlus size={16} className="mr-2" /> {t('tripOffer.sendOffer') || 'Send Trip Offer'}
              </Button>
            )}
            {!activeOffer && eligibleDrivers.length === 0 && (
              <p className="mt-2 text-sm">{t('tripOffer.noEligibleDrivers') || 'No eligible drivers with login seats. Create driver seats first.'}</p>
            )}
          </div>
        )}
      </Card>

      {/* History */}
      <Card className="p-6">
        <h3 className="font-semibold text-ink mb-4">{t('tripOffer.history') || 'Offer History'}</h3>
        {job.trip_offers && job.trip_offers.length > 0 ? (
          <div className="space-y-3">
            {job.trip_offers.map((offer) => (
              <div key={offer.id} className="p-4 rounded-lg border" style={{ borderColor: 'var(--outline-variant)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: offer.status === 'ACCEPTED' ? 'var(--status-success-bg)' : offer.status === 'DECLINED' ? 'var(--status-danger-bg)' : 'var(--surface-container-high)', color: offer.status === 'ACCEPTED' ? 'var(--status-success)' : offer.status === 'DECLINED' ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                      {offer.status === 'ACCEPTED' ? <IconCheckCircle size={20} /> : offer.status === 'DECLINED' ? <IconX size={20} /> : <IconClock size={20} />}
                    </div>
                    <div>
                      <p className="font-medium text-ink">{offer.driver_name || offer.driver_id}</p>
                      <p className="text-sm text-ink-muted">{new Date(offer.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <Badge color={offer.status === 'ACCEPTED' ? 'success' : offer.status === 'DECLINED' ? 'danger' : 'warning'}>{offer.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-8 text-ink-muted">{t('tripOffer.noHistory') || 'No offers sent yet'}</p>
        )}
      </Card>

      {/* Send Offer Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('tripOffer.sendOfferModal') || 'Send Trip Offer'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-ink-muted">{t('tripOffer.selectDriver') || 'Select a driver with a login seat (DRIVER_ASSOCIATE)'}</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {eligibleDrivers.length === 0 ? (
              <p className="text-center py-4 text-ink-muted">{t('tripOffer.noEligibleDrivers') || 'No drivers with login seats. Create seats first in My Drivers.'}</p>
            ) : (
              eligibleDrivers.map((d) => (
                <label key={d.id} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-surface-container-high transition-colors">
                  <input type="radio" name="driver" value={d.id} checked={selectedDriver?.id === d.id} onChange={() => setSelectedDriver(d)} className="text-brand-primary" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                    <IconUser size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-ink">{d.name}</p>
                    <p className="text-sm text-ink-muted">{d.phone} · {d.seat_user_id ? t('tripOffer.hasLogin') : t('tripOffer.noLogin')}</p>
                  </div>
                  <Badge color={d.seat_role === 'DRIVER_ASSOCIATE' ? 'success' : 'neutral'}>{d.seat_role}</Badge>
                </label>
              ))
            )}
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel') || 'Cancel'}</Button>
            <Button type="submit" loading={submitting} disabled={!selectedDriver} className="flex-1">{t('tripOffer.sendBtn') || 'Send Offer'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
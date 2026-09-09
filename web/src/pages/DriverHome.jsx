import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { formatDateTime, formatMoney, formatLabel, equipmentLabel } from '../lib/constants.js';
import { Card, StatusBadge, EmptyState, ErrorState, Button, Badge } from '../components/ui.jsx';
import { IconTruck, IconMapPin, IconWallet } from '../components/icons.jsx';
import ChatPopup from '../features/job/ChatPopup.jsx';
import { directionsUrl } from '../lib/googleMaps.js';
import { useToasts } from '../components/Toast.jsx';

// Pending trip offer — the accept/decline step between a carrier assigning
// a job to this driver and it actually becoming "my job" below. Previously
// only reachable by replying to a WhatsApp message (whatsapp.routes.js),
// which needs WHATSAPP_ACCESS_TOKEN configured (dark by default) and the
// driver to actually have WhatsApp set up — a driver with neither had no
// way to see or act on a real pending offer at all.
function TripOfferCard({ onResolved }) {
  const { addToast } = useToasts();
  const [offer, setOffer] = useState(undefined); // undefined = loading, null = none pending
  const [busy, setBusy] = useState(false);

  function load() {
    api.driverTripOffer().then((d) => setOffer(d.tripOffer)).catch(() => setOffer(null));
  }
  useEffect(load, []);

  async function respond(accepted) {
    setBusy(true);
    try {
      await api.respondToTripOffer(offer.id, accepted);
      addToast({ type: accepted ? 'status_change' : 'system_message', title: accepted ? 'Trip accepted' : 'Trip declined' });
      setOffer(null);
      onResolved();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not respond', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!offer) return null;
  const job = offer.job;
  return (
    <Card className="mb-4" style={{ borderColor: 'var(--brand-accent)' }}>
      <Card.Content>
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">{job?.job_code}</p>
          <Badge color="accent">New offer</Badge>
        </div>
        <p className="mt-1 text-sm font-medium text-ink">
          {formatLabel(job?.pickup_terminal)} → {formatLabel(job?.delivery_area)}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {equipmentLabel(job?.equipment_type)} · Ready {formatDateTime(job?.ready_at)}
          {job?.agreed_price_aed ? ` · ${formatMoney(job.agreed_price_aed, job.currency)}` : ''}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" loading={busy} onClick={() => respond(true)}>Accept</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => respond(false)}>Decline</Button>
        </div>
      </Card.Content>
    </Card>
  );
}

// DRIVER_ASSOCIATE only — a plain DRIVER has no revenue-split wallet, see
// server/routes/driver.routes.js's GET /api/driver/wallet.
function WalletCard() {
  const [entries, setEntries] = useState(undefined);
  useEffect(() => { api.driverWallet().then((d) => setEntries(d.entries)).catch(() => setEntries([])); }, []);
  if (!entries || entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + (e.status === 'PAID' ? 0 : e.driver_share_aed), 0);
  return (
    <Card className="mb-4">
      <Card.Content>
        <div className="flex items-center gap-2">
          <IconWallet size={16} className="text-ink-muted" />
          <p className="text-sm font-semibold text-ink">Your earnings</p>
        </div>
        <p className="mt-1 tabular font-display text-xl font-semibold text-ink">{formatMoney(total)} outstanding</p>
        <div className="mt-2 space-y-1.5">
          {entries.slice(0, 5).map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs">
              <span className="text-ink-secondary">{e.job_code}</span>
              <span className="tabular text-ink">{formatMoney(e.driver_share_aed)} <span className="text-ink-muted">· {e.status}</span></span>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

// The entire driver-seat experience — see server/middleware/auth.js's
// DRIVER_SEAT_ALLOWED_ROUTES for the matching backend boundary. Deliberately
// one self-contained page (their current job + messaging with it), not a
// navigation into JobDetail.jsx, which shows bids/documents/lifecycle
// actions a driver seat has no access to and no need for.
export default function DriverHome() {
  usePageTitle('My job');
  const { logout, actingAs } = useAuth();
  const { t, isRtl } = useLocale();
  const [job, setJob] = useState(undefined); // undefined = loading, null = none assigned
  const [error, setError] = useState('');

  function load() {
    setError('');
    api.driverJob().then((d) => setJob(d.job)).catch((err) => { setJob(null); setError(err.message); });
  }
  useEffect(load, []);

  return (
    <div className="container-page py-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">{t('driver.myJob', 'My job')}</h1>
        <Button variant="secondary" size="sm" onClick={() => logout()}>{t('driver.logout', 'Log out')}</Button>
      </div>

      <div className="mt-5">
        <TripOfferCard onResolved={load} />
        {actingAs?.seatRole === 'DRIVER_ASSOCIATE' && <WalletCard />}
        {job === undefined ? (
          <p className="text-sm text-ink-muted">{t('driver.loading', 'Loading…')}</p>
        ) : error ? (
          <ErrorState title={t('driver.loadError', "Couldn't load your job")} description={error} onRetry={load} />
        ) : job === null ? (
          <EmptyState icon={<IconTruck size={26} />} title={t('driver.empty.title', 'No job assigned yet')} description={t('driver.empty.description', "Your dispatcher will assign you to a job — check back here once you're on one.")} />
        ) : (
          <Card>
            <Card.Content>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">{job.job_code}</p>
                  <p className="mt-1 text-sm text-ink-muted">{job.equipment_type?.replace(/_/g, ' ')} · {job.cargo_type?.replace(/_/g, ' ')}</p>
                </div>
                <StatusBadge status={job.status} />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <a
                  href={directionsUrl({ destLat: job.pickup_lat, destLng: job.pickup_lng, destAddress: job.pickup_terminal?.replace(/_/g, ' ') })}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg p-3 -m-3 transition hover:bg-surface-container"
                >
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"><IconMapPin size={12} /> {t('driver.pickup', 'Pickup')}</p>
                  <p className="mt-1 text-sm font-medium text-brand-secondary underline-offset-2 hover:underline">{job.pickup_terminal?.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">{t('driver.readyAt', 'Ready {time}', { time: formatDateTime(job.ready_at) })}</p>
                </a>
                <a
                  href={directionsUrl({ originLat: job.pickup_lat, originLng: job.pickup_lng, destLat: job.delivery_lat, destLng: job.delivery_lng, destAddress: job.delivery_address || job.delivery_area?.replace(/_/g, ' ') })}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg p-3 -m-3 transition hover:bg-surface-container"
                >
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"><IconMapPin size={12} /> {t('driver.delivery', 'Delivery')}</p>
                  <p className="mt-1 text-sm font-medium text-brand-secondary underline-offset-2 hover:underline">{job.delivery_area?.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 text-sm text-ink-secondary">{job.delivery_address}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">{t('driver.dueAt', 'Due {time}', { time: formatDateTime(job.deadline) })}</p>
                </a>
              </div>
              <p className="mt-3 text-xs text-ink-muted">{t('driver.directionsHint', 'Tap pickup or delivery to open directions in Google Maps.')}</p>
            </Card.Content>
          </Card>
        )}
      </div>

      {job && <ChatPopup jobId={job.id} />}
    </div>
  );
}

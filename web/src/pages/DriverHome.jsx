import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatDateTime } from '../lib/constants.js';
import { Card, StatusBadge, EmptyState, Button } from '../components/ui.jsx';
import { IconTruck, IconMapPin } from '../components/icons.jsx';
import ChatPopup from '../features/job/ChatPopup.jsx';
import { directionsUrl } from '../lib/googleMaps.js';

// The entire driver-seat experience — see server/middleware/auth.js's
// DRIVER_SEAT_ALLOWED_ROUTES for the matching backend boundary. Deliberately
// one self-contained page (their current job + messaging with it), not a
// navigation into JobDetail.jsx, which shows bids/documents/lifecycle
// actions a driver seat has no access to and no need for.
export default function DriverHome() {
  usePageTitle('My job');
  const { logout } = useAuth();
  const [job, setJob] = useState(undefined); // undefined = loading, null = none assigned

  useEffect(() => {
    api.driverJob().then((d) => setJob(d.job)).catch(() => setJob(null));
  }, []);

  return (
    <div className="container-page py-6" dir="ltr">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">My job</h1>
        <Button variant="secondary" size="sm" onClick={() => logout()}>Log out</Button>
      </div>

      <div className="mt-5">
        {job === undefined ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : job === null ? (
          <EmptyState icon={<IconTruck size={26} />} title="No job assigned yet" description="Your dispatcher will assign you to a job — check back here once you're on one." />
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
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"><IconMapPin size={12} /> Pickup</p>
                  <p className="mt-1 text-sm font-medium text-brand-secondary underline-offset-2 hover:underline">{job.pickup_terminal?.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">Ready {formatDateTime(job.ready_at)}</p>
                </a>
                <a
                  href={directionsUrl({ originLat: job.pickup_lat, originLng: job.pickup_lng, destLat: job.delivery_lat, destLng: job.delivery_lng, destAddress: job.delivery_address || job.delivery_area?.replace(/_/g, ' ') })}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg p-3 -m-3 transition hover:bg-surface-container"
                >
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"><IconMapPin size={12} /> Delivery</p>
                  <p className="mt-1 text-sm font-medium text-brand-secondary underline-offset-2 hover:underline">{job.delivery_area?.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 text-sm text-ink-secondary">{job.delivery_address}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">Due {formatDateTime(job.deadline)}</p>
                </a>
              </div>
              <p className="mt-3 text-xs text-ink-muted">Tap pickup or delivery to open directions in Google Maps.</p>
            </Card.Content>
          </Card>
        )}
      </div>

      {job && <ChatPopup jobId={job.id} />}
    </div>
  );
}

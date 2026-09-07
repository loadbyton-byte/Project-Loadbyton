import React, { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Card, Button, Badge, ErrorState, Spinner } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { IconMapPin, IconTruck, IconSync, IconArrowRight, IconClock, IconCheckCircle } from '../components/icons.jsx';
import { LiveMap } from '../components/LiveMap.jsx';

export default function DriverLocationTracking() {
  usePageTitle('Live Tracking');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const { user, actingAs } = useAuth();

  const [job, setJob] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState('');
  const watchIdRef = useRef(null);

  // Get the driver's assigned job
  useEffect(() => {
    fetchDriverJob();
  }, []);

  async function fetchDriverJob() {
    try {
      const data = await api.driverJob();
      if (data.job) {
        setJob(data.job);
        fetchLocations(data.job.id);
      } else {
        setError('No active job assigned');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchLocations(jobId) {
    try {
      const data = await api.getLocations(jobId);
      setLocations(data.locations || []);
    } catch (e) {
      // Ignore - driver may not have locations yet
    }
  }

  function startTracking() {
    if (!navigator.geolocation) {
      addToast('Geolocation not supported', 'error');
      return;
    }
    setTracking(true);
    addToast('Live tracking started', 'success');

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        try {
          await api.postLocation(job.id, {
            lat: latitude,
            lng: longitude,
            accuracy,
            heading: heading ?? null,
            speed: speed ?? null,
          });
          // Update local state for immediate feedback
          setLocations((prev) => [
            { lat: latitude, lng: longitude, accuracy, heading, speed, timestamp: new Date().toISOString() },
            ...prev.slice(0, 49),
          ]);
        } catch (e) {
          console.error('Failed to post location:', e);
        }
      },
      (err) => {
        addToast(`Tracking error: ${err.message}`, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function stopTracking() {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    addToast('Live tracking stopped', 'info');
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} className="text-brand-primary" /></div>;
  if (error && !job) return <div className="container-page py-10"><ErrorState title="No Active Job" description={error} onRetry={fetchDriverJob} /></div>;

  return (
    <div className="container-page max-w-4xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
          <IconTruck size={24} /> {t('driver.tracking') || 'Live Location Tracking'}
        </h1>
        <p className="text-ink-muted mt-1">{t('driver.trackingDesc') || 'Share your real-time location during active jobs'}</p>
      </div>

      {job && (
        <Card className="mb-6">
          <Card.Header>
            <Card.Title className="flex items-center gap-2">
              <IconMapPin size={20} /> {job.job_code}
            </Card.Title>
          </Card.Header>
          <Card.Content className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><dt className="text-ink-muted">Status</dt><dd className="mt-0.5"><Badge color="warning">{job.status}</Badge></dd></div>
              <div><dt className="text-ink-muted">Route</dt><dd className="mt-0.5 font-medium text-ink">{job.pickup_terminal} → {job.delivery_area}</dd></div>
              <div><dt className="text-ink-muted">Assigned Driver</dt><dd className="mt-0.5 font-medium text-ink">{job.assigned_driver_name || 'You'}</dd></div>
              <div><dt className="text-ink-muted">Tracking</dt><dd className="mt-0.5 flex items-center gap-2"><Badge color={tracking ? 'success' : 'neutral'}>{tracking ? 'Active' : 'Stopped'}</Badge></dd></div>
            </div>
            <div className="flex gap-2">
              <Button variant={tracking ? 'danger' : 'primary'} onClick={tracking ? stopTracking : startTracking} disabled={!navigator.geolocation}>
                {tracking ? (<span><IconSync size={16} className="mr-2 animate-spin" /> Stop Tracking</span>) : (<span><IconMapPin size={16} className="mr-2" /> Start Tracking</span>)}
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}

      {job && (
        <Card className="mb-6">
          <Card.Header><Card.Title>Live Map</Card.Title></Card.Header>
          <Card.Content>
            <LiveMap
              jobId={job.id}
              fallbackLat={job.pickup_lat}
              fallbackLng={job.pickup_lng}
              deliveryLat={job.delivery_lat}
              deliveryLng={job.delivery_lng}
            />
          </Card.Content>
        </Card>
      )}

      {job && locations.length > 0 && (
        <Card>
          <Card.Header><Card.Title>Recent Locations</Card.Title></Card.Header>
          <Card.Content>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {locations.slice(0, 20).map((loc, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-2">
                    <IconMapPin size={16} className="text-brand-primary" />
                    <div>
                      <p className="font-mono text-ink">{loc.lat?.toFixed(6)}, {loc.lng?.toFixed(6)}</p>
                      <p className="text-xs text-ink-muted">±{loc.accuracy?.toFixed(0)}m · {loc.speed ? `${loc.speed.toFixed(1)} km/h` : '—'} · {loc.heading ? `${loc.heading}°` : '—'}</p>
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted">{loc.timestamp ? new Date(loc.timestamp).toLocaleTimeString() : '—'}</span>
                </div>
              ))}
            </div>
          </Card.Content>
        </Card>
      )}

      <Card className="mt-6 p-4">
        <div className="flex items-start gap-3">
          <IconCheckCircle size={20} className="text-brand-secondary mt-0.5" />
          <div className="text-sm text-ink-secondary space-y-1">
            <p>Live tracking sends your GPS position to the server every few seconds while active.</p>
            <p>Carriers and shippers can see your real-time location on the job map.</p>
            <p>Tracking automatically stops when the job reaches COMPLETED status.</p>
            <p>Battery usage: moderate — enable high accuracy for best results.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
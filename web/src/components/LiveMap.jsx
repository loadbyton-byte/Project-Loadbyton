import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api.js';
import { directionsUrl } from '../lib/googleMaps.js';

// Lightweight geolocation → 3-min location_logs, rendered on free
// OpenStreetMap tiles via Leaflet (no Mapbox/Google map-load billing —
// see docs/GOOGLE_MAPS_SETUP.md for why only address search uses Google).
export function useLiveTracking(jobId, isCarrier, status) {
  useEffect(() => {
    if (!isCarrier || status !== 'IN_TRANSIT' || !jobId) return;
    let timer;
    async function post() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try { await api.postLocation(jobId, { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading }); } catch {}
      }, () => {});
    }
    post();
    timer = setInterval(post, 3 * 60 * 1000);
    return () => clearInterval(timer);
  }, [jobId, isCarrier, status]);
}

// Plain colored-dot markers via L.divIcon rather than Leaflet's default
// image-based marker — sidesteps the well-known broken-icon-path problem
// under bundlers (the default marker's PNGs resolve relative to leaflet's
// own package, not the app's asset pipeline) with zero extra assets.
function dotIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function LiveMap({ jobId, fallbackLat, fallbackLng, deliveryLat, deliveryLng }) {
  const [locs, setLocs] = useState([]);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    let t;
    async function load() {
      try { const d = await api.getLocations(jobId); setLocs(d.locations || []); } catch {}
    }
    load();
    t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [jobId]);

  const last = locs[0];
  const liveLat = last?.lat;
  const liveLng = last?.lng;
  const pickupLat = fallbackLat;
  const pickupLng = fallbackLng;
  const hasAnyPoint = [liveLat, pickupLat, deliveryLat].some((v) => v != null);

  useEffect(() => {
    if (!hasAnyPoint || !containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    const bounds = [];
    function setMarker(key, lat, lng, color, label) {
      if (lat == null || lng == null) {
        if (markersRef.current[key]) { map.removeLayer(markersRef.current[key]); delete markersRef.current[key]; }
        return;
      }
      bounds.push([lat, lng]);
      if (markersRef.current[key]) markersRef.current[key].setLatLng([lat, lng]);
      else markersRef.current[key] = L.marker([lat, lng], { icon: dotIcon(color) }).addTo(map).bindTooltip(label);
    }
    setMarker('pickup', pickupLat, pickupLng, '#2563eb', 'Pickup');
    setMarker('delivery', deliveryLat, deliveryLng, '#16a34a', 'Delivery');
    setMarker('live', liveLat, liveLng, '#dc2626', 'Carrier — live');
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [32, 32] });
  }, [hasAnyPoint, pickupLat, pickupLng, deliveryLat, deliveryLng, liveLat, liveLng]);

  // Cleanup on unmount only — a fresh map per mount, not per prop change.
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; markersRef.current = {}; }, []);

  if (!hasAnyPoint) {
    return <p className="text-sm text-ink-muted">No live location yet — carrier location appears every 3 min when IN_TRANSIT.</p>;
  }

  const hasDest = deliveryLat != null && deliveryLng != null;
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
      <div ref={containerRef} className="h-[280px] w-full" />
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-ink-muted">
        <span>{last ? `Live · ${locs.length} point${locs.length === 1 ? '' : 's'} · ${new Date(last.recorded_at).toLocaleTimeString()}` : 'Waiting for first ping…'}</span>
        {hasDest && (
          <a
            href={directionsUrl({ originLat: liveLat ?? pickupLat, originLng: liveLng ?? pickupLng, destLat: deliveryLat, destLng: deliveryLng })}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-semibold text-brand-secondary hover:underline"
          >
            Get directions
          </a>
        )}
      </div>
    </div>
  );
}

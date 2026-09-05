import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api.js';
import { directionsUrl } from '../lib/googleMaps.js';

// Lightweight geolocation → 3-min location_logs, rendered on free
// OpenStreetMap-derived tiles via Leaflet (no Mapbox/Google map-load
// billing — see docs/GOOGLE_MAPS_SETUP.md for why only address search uses
// Google). Tile source is CARTO's free "Voyager" basemap rather than raw
// OSM raster tiles — same underlying OSM data, a cleaner/more modern
// styling on top of it, still free and keyless. Attribution to both
// OpenStreetMap and CARTO is a condition of using either's free tiles and
// is kept — just restyled smaller/quieter via the CSS below rather than
// Leaflet's default boxy control.
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

// Teardrop pin (SVG) rather than a plain dot — reads more like a real map
// product's marker. `pulse` adds an animated ring behind the pin, reserved
// for the carrier's live position so it's the one marker that visibly
// reads as "moving right now".
function pinIcon(color, { pulse = false } = {}) {
  const pulseHtml = pulse
    ? `<span class="lb-pin-pulse" style="background:${color}"></span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="lb-pin-wrap">${pulseHtml}<svg width="26" height="34" viewBox="0 0 26 34" style="filter:drop-shadow(0 2px 3px rgba(15,43,61,.35))">
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 21 13 21s13-11.5 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/>
        <circle cx="13" cy="13" r="5" fill="white"/>
      </svg></div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    tooltipAnchor: [0, -30],
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
      mapRef.current = L.map(containerRef.current, { attributionControl: false, zoomControl: true });
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(mapRef.current);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    const bounds = [];
    function setMarker(key, lat, lng, color, label, pulse) {
      if (lat == null || lng == null) {
        if (markersRef.current[key]) { map.removeLayer(markersRef.current[key]); delete markersRef.current[key]; }
        return;
      }
      bounds.push([lat, lng]);
      if (markersRef.current[key]) markersRef.current[key].setLatLng([lat, lng]);
      else markersRef.current[key] = L.marker([lat, lng], { icon: pinIcon(color, { pulse }) }).addTo(map).bindTooltip(label);
    }
    setMarker('pickup', pickupLat, pickupLng, '#2563eb', 'Pickup', false);
    setMarker('delivery', deliveryLat, deliveryLng, '#16a34a', 'Delivery', false);
    setMarker('live', liveLat, liveLng, '#dc2626', 'Carrier — live', true);
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
    <div className="lb-livemap overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-default)', boxShadow: '0 2px 6px rgba(15,43,61,0.10)' }}>
      <style>{`
        .lb-livemap .leaflet-control-attribution {
          background: rgba(255,255,255,0.75);
          backdrop-filter: blur(2px);
          font-size: 9px;
          line-height: 1.4;
          padding: 1px 6px;
          border-radius: 999px;
          margin: 0 6px 6px 0;
          color: var(--ink-muted, #586A72);
        }
        .lb-livemap .leaflet-control-attribution a { color: inherit; }
        .lb-livemap .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 6px rgba(15,43,61,0.15) !important; }
        .lb-pin-wrap { position: relative; width: 26px; height: 34px; }
        .lb-pin-pulse {
          position: absolute;
          left: 3px; top: 3px;
          width: 20px; height: 20px;
          border-radius: 50%;
          opacity: 0.55;
          animation: lb-pulse 1.8s ease-out infinite;
        }
        @keyframes lb-pulse {
          0% { transform: scale(0.6); opacity: 0.55; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lb-pin-pulse { animation: none; opacity: 0; }
        }
      `}</style>
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

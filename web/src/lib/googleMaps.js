// Address search only — see docs/GOOGLE_MAPS_SETUP.md. Map rendering and
// directions are deliberately NOT Google (see LiveMap.jsx and
// directionsUrl below) — per-map-load billing would dominate cost at this
// app's scale, while Places Autocomplete's session-token billing is a few
// dollars a month even at 300 jobs/day. Nothing here does anything unless
// VITE_GOOGLE_MAPS_API_KEY is set — every caller must treat that as
// optional and keep working without it (see Dashboard.jsx's LOCAL branch).
export const GOOGLE_MAPS_ENABLED = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let loadPromise = null;

export function loadGoogleMapsScript() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.resolve(false);
  if (typeof window !== 'undefined' && window.google?.maps?.places) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}

// Free Google Maps deep-link — opens the viewer's own Maps app with live
// traffic, no API call and no key required. destLat/destLng win when
// present (precise, e.g. from Places Autocomplete); destAddress is the
// fallback for jobs with no coordinates yet — a fixed terminal/depot name,
// or any job posted before Stage G's address search — since Maps' deep
// link accepts a plain place/address string as the destination just as
// well as "lat,lng".
export function directionsUrl({ originLat, originLng, destLat, destLng, destAddress }) {
  const params = new URLSearchParams({ api: '1' });
  if (originLat != null && originLng != null) params.set('origin', `${originLat},${originLng}`);
  if (destLat != null && destLng != null) params.set('destination', `${destLat},${destLng}`);
  else if (destAddress) params.set('destination', destAddress);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

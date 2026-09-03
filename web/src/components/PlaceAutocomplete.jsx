import { useEffect, useRef } from 'react';
import { loadGoogleMapsScript, GOOGLE_MAPS_ENABLED } from '../lib/googleMaps.js';
import { Input } from './ui.jsx';

// A plain text input that becomes a UAE-biased Google Places Autocomplete
// once VITE_GOOGLE_MAPS_API_KEY is set — session-token billing is
// automatic with this widget (one charge per completed search, not per
// keystroke). Renders as an ordinary <Input> and behaves identically to
// one (free typing, same onChange) when no key is configured, so callers
// never need to branch on GOOGLE_MAPS_ENABLED themselves.
export default function PlaceAutocomplete({ value, onChange, onPlaceSelect, ...props }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  onPlaceSelectRef.current = onPlaceSelect;

  useEffect(() => {
    if (!GOOGLE_MAPS_ENABLED) return;
    let cancelled = false;
    loadGoogleMapsScript().then((ok) => {
      if (!ok || cancelled || !inputRef.current || !window.google?.maps?.places) return;
      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'ae' },
        fields: ['formatted_address', 'geometry', 'name'],
      });
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (!place.geometry?.location) return;
        onPlaceSelectRef.current?.({
          address: place.formatted_address || place.name || '',
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        });
      });
    });
    return () => {
      cancelled = true;
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Input ref={inputRef} value={value} onChange={onChange} autoComplete="off" {...props} />;
}

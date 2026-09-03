# Google Maps setup — address search only

Loadbyton uses Google for exactly one thing: autocompleting a UAE address
when posting a **Local** job (`web/src/components/PlaceAutocomplete.jsx`).
Everything else — the live tracking map, pickup/delivery pins, driver
directions — is free (OpenStreetMap tiles via Leaflet, and Google's own
free `maps.google.com` deep-link for turn-by-turn directions). This split
keeps cost near-zero at 1,000 users / 300 jobs a day: Google's per-map-load
billing is what would otherwise dominate the bill, and this app never
triggers it.

## What to set up

1. **Google Cloud Console** → create a project (or reuse one) →
   **APIs & Services → Library** → enable **Places API**. Do not enable
   Maps JavaScript API's *map rendering* usage beyond what Places
   Autocomplete itself requires to run — this app never calls
   `new google.maps.Map(...)`.
2. **APIs & Services → Credentials** → create an API key.
3. **Restrict the key** (Credentials → the key → Application restrictions):
   - **API restrictions**: limit to *Places API* only, so the key can't be
     used to rack up charges against unrelated Google APIs if it ever
     leaks.
   - **Application restrictions**: HTTP referrers, set to
     `https://loadbyton.com/*` and whatever Vercel preview domain pattern
     you use — a browser-side key is visible in the page source, so this
     restriction is the actual security boundary, not secrecy.
4. **Billing**: Places Autocomplete requires a billing account attached to
   the project, but the widget used here (`google.maps.places.Autocomplete`
   bound to a plain input) bills per **session**, not per keystroke — one
   charge when a user completes a search, not one per character typed.
   Google's current published rate is a few dollars per 1,000 sessions;
   at 300 jobs/day (each with at most two address searches — pickup and
   delivery), that's roughly $15–50/month worst case, nowhere near what
   full map-load billing would cost at the same volume.
5. Set the key as `VITE_GOOGLE_MAPS_API_KEY` in Vercel's environment
   variables for the `web` project (Production and Preview).

## Nothing else changes without it

The whole integration is written to degrade to a plain text input if
`VITE_GOOGLE_MAPS_API_KEY` is unset (`web/src/lib/googleMaps.js`'s
`GOOGLE_MAPS_ENABLED`) — the Local-job pickup/delivery fields keep working
exactly as they did before this stage, just without autocomplete
suggestions or captured coordinates. The map and directions features need
no key at all and are already live.

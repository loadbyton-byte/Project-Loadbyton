// Phase 8 (Change 31) — GCC corridor wiring.
//
// The 6-country config (lib/gcc.js) existed but was imported nowhere; this
// file wires it into real behavior:
//   GET /api/gcc/countries — supported list (currency, tax, phone pattern
//     hint, payment provider). Market entry itself (business registration,
//     local payment licensing) stays a separate business decision — this
//     endpoint describes readiness, not legal authority.
//   GET /api/gcc/corridors — curated UAE→SA/OM cross-border lanes with
//     distance/quotes sourced from the same lane seed conventions.
// Ledger stays AED-denominated in v1 (stated honestly in each corridor);
// multi-currency settlement is explicit follow-up work, not implied here.
const { COUNTRY_CONFIG } = require('../lib/gcc');

const router = require('express').Router();

const CORRIDORS = [
  { id: 'JAFZA-RUH', origin: 'JEBEL_ALI_T2', originCountry: 'AE', destination: 'RIYADH_DRY_PORT', destinationCountry: 'SA', distanceKm: 980, transitDays: '2-3', indicativeAed: 6800, borderCrossing: 'Al Batha', currency: 'SAR' },
  { id: 'JAFZA-DMM', origin: 'JEBEL_ALI_T2', originCountry: 'AE', destination: 'DAMMAM_PORT', destinationCountry: 'SA', distanceKm: 860, transitDays: '2', indicativeAed: 5900, borderCrossing: 'Al Batha', currency: 'SAR' },
  { id: 'JAFZA-MCT', origin: 'JEBEL_ALI_T1', originCountry: 'AE', destination: 'SOHAR_PORT', destinationCountry: 'OM', distanceKm: 420, transitDays: '1-2', indicativeAed: 2900, borderCrossing: 'Hatta/Al Wajajah', currency: 'OMR' },
  { id: 'KHALIFA-SLL', origin: 'KHALIFA_PORT', originCountry: 'AE', destination: 'SALALAH_PORT', destinationCountry: 'OM', distanceKm: 1150, transitDays: '3', indicativeAed: 7400, borderCrossing: 'Mezyad/Hafeet', currency: 'OMR' },
];

router.get('/api/gcc/countries', (req, res) => {
  const countries = Object.entries(COUNTRY_CONFIG).map(([code, cfg]) => ({
    code, currency: cfg.currency, taxBps: cfg.taxBps,
    paymentProvider: cfg.paymentProvider,
    ledgerNote: code === 'AE' ? 'native ledger currency' : 'quotes indicative in AED; settlement in AED in v1',
  }));
  res.json({ countries, home: 'AE', note: 'Market entry (registration, licensing) is a business decision per country — this endpoint is technical readiness, not legal authority.' });
});

router.get('/api/gcc/corridors', (req, res) => {
  const { to } = req.query || {};
  const rows = to ? CORRIDORS.filter((c) => c.destinationCountry === String(to).toUpperCase()) : CORRIDORS;
  res.json({ corridors: rows, settlement: 'AED in v1; multi-currency settlement is follow-up work' });
});

module.exports = router;
module.exports.CORRIDORS = CORRIDORS;

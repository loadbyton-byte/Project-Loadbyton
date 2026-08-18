// The unified lane index — the single source of truth behind the public Lane
// Index and the admin market snapshot. In a real deployment this would be fed
// by historical job data; here it's a curated seed table that the rest of the
// product treats as ground truth. (The rate estimator and route optimizer
// that used to live here were removed product-wide — pricing on the platform
// is set by the shipper's target price and carriers' per-trip bids, not by
// an algorithmic quote.)

const unifiedLanes = [
  { terminal: 'JEBEL_ALI_T1', area: 'AL_QUOZ', distanceKm: 21, basePriceAed: 850, pricePerKm: 12, baseMinutes: 45, onTimePct: 94, monthlyLoads: 120 },
  { terminal: 'JEBEL_ALI_T2', area: 'JAFZA_SOUTH', distanceKm: 8, basePriceAed: 450, pricePerKm: 10, baseMinutes: 25, onTimePct: 96, monthlyLoads: 210 },
  { terminal: 'JEBEL_ALI_T4', area: 'DUBAI_SOUTH', distanceKm: 14, basePriceAed: 600, pricePerKm: 11, baseMinutes: 30, onTimePct: 91, monthlyLoads: 95 },
  { terminal: 'JEBEL_ALI_T1', area: 'DIP', distanceKm: 33, basePriceAed: 1150, pricePerKm: 13, baseMinutes: 55, onTimePct: 89, monthlyLoads: 60 },
  { terminal: 'JEBEL_ALI_T2', area: 'AL_QUSAIS', distanceKm: 45, basePriceAed: 1450, pricePerKm: 14, baseMinutes: 70, onTimePct: 87, monthlyLoads: 40 },
  { terminal: 'KHALIFA_PORT', area: 'MUSAFFAH', distanceKm: 27, basePriceAed: 980, pricePerKm: 12.5, baseMinutes: 48, onTimePct: 92, monthlyLoads: 55 },
  { terminal: 'PORT_KHALID', area: 'SHARJAH_INDUSTRIAL', distanceKm: 18, basePriceAed: 780, pricePerKm: 11.5, baseMinutes: 40, onTimePct: 90, monthlyLoads: 48 },
  { terminal: 'FUJAIRAH_PORT', area: 'FUJAIRAH_FREEZONE', distanceKm: 12, basePriceAed: 620, pricePerKm: 13.5, baseMinutes: 32, onTimePct: 93, monthlyLoads: 33 },
].map((lane) => ({ ...lane, laneId: `${lane.terminal}:${lane.area}` }));

module.exports = { unifiedLanes };
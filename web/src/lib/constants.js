export const CONTAINER_SIZES = ['20FT', '40FT', '40HC', 'REEFER'];
export const CONTAINER_TYPES = ['DRY', 'REEFER', 'HAZMAT', 'OPEN_TOP', 'FLAT_RACK'];
export const TERMINALS = ['JEBEL_ALI_T1', 'JEBEL_ALI_T2', 'JEBEL_ALI_T4', 'KHALIFA_PORT', 'PORT_KHALID', 'FUJAIRAH_PORT'];
export const AREAS = ['AL_QUOZ', 'JAFZA_SOUTH', 'DUBAI_SOUTH', 'DIP', 'AL_QUSAIS', 'MUSAFFAH', 'SHARJAH_INDUSTRIAL', 'FUJAIRAH_FREEZONE'];
export const SHIPMENT_TYPES = ['IMPORT', 'EXPORT', 'LOCAL'];

// How a job gets paid — set once at posting, visible to every carrier
// before they bid. SPOT_ESCROW is the default and the only tier that
// requires funds in escrow before pickup (see server/services/job.service.js's
// PICKED_UP gate); the other three exist for shippers who have a standing
// arrangement instead of per-job card payment.
export const PAYMENT_TIERS = ['SPOT_ESCROW', 'PAY_ON_DELIVERY', 'CONTRACT_CREDIT', 'OFF_PLATFORM'];
export const PAYMENT_TIER_LABELS = {
  SPOT_ESCROW: 'Escrow (pay now)',
  PAY_ON_DELIVERY: 'Pay on delivery',
  CONTRACT_CREDIT: 'Contract credit',
  OFF_PLATFORM: 'Off-platform',
};
export const PAYMENT_TIER_DESCRIPTIONS = {
  SPOT_ESCROW: 'Full price is held in escrow the moment you award a bid, released to the carrier once delivery is confirmed. Fastest to set up — needs no prior arrangement.',
  PAY_ON_DELIVERY: 'Nothing is charged at award. Payment is collected only once the job reaches Delivered.',
  CONTRACT_CREDIT: 'Draws against an approved credit limit — no payment at award or delivery. Requires Loadbyton to have approved credit terms for your account first.',
  OFF_PLATFORM: 'You and the carrier settle payment directly, outside Loadbyton. The job is still tracked and disputed here, just not the money.',
};
export function paymentTierLabel(v) { return PAYMENT_TIER_LABELS[v] || formatLabel(v); }

export function shipmentTypeLabel(st) {
  return { IMPORT: 'Import — Terminal → Customer → Depot', EXPORT: 'Export — Depot → Shipper → Terminal', LOCAL: 'Local — Loading → Delivery' }[st] || st;
}
export const DEPOTS = ['JAFZA_DEPOT', 'AL_QUSAIS_DEPOT', 'KHALIFA_DEPOT', 'SHARJAH_DEPOT', 'FUJAIRAH_DEPOT', 'DIP_DEPOT', 'MUSAFFAH_DEPOT'];

export const SHIPMENT_TYPE_LABELS = { IMPORT: 'Import', EXPORT: 'Export' };
export const DEPOT_LABELS = {
  JAFZA_DEPOT: 'JAFZA Depot',
  AL_QUSAIS_DEPOT: 'Al Qusais Depot',
  KHALIFA_DEPOT: 'Khalifa Depot',
  SHARJAH_DEPOT: 'Sharjah Depot',
  FUJAIRAH_DEPOT: 'Fujairah Depot',
  DIP_DEPOT: 'DIP Depot',
  MUSAFFAH_DEPOT: 'Musaffah Depot',
};
export function depotLabel(v) { return DEPOT_LABELS[v] || formatLabel(v); }
export const STATUS_FLOW = ['DRAFT', 'OPEN', 'AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

// Terminal → emirate/operator, for the UAE coverage section and any "which
// emirate is this in" display. Keys must match TERMINALS above.
export const TERMINAL_INFO = {
  JEBEL_ALI_T1: { emirate: 'Dubai', operator: 'DP World' },
  JEBEL_ALI_T2: { emirate: 'Dubai', operator: 'DP World' },
  JEBEL_ALI_T4: { emirate: 'Dubai', operator: 'DP World' },
  KHALIFA_PORT: { emirate: 'Abu Dhabi', operator: 'Abu Dhabi Ports' },
  PORT_KHALID: { emirate: 'Sharjah', operator: 'Gulftainer' },
  FUJAIRAH_PORT: { emirate: 'Fujairah', operator: 'Fujairah Port Authority' },
};

// Equipment/vehicle types a job can require and a carrier can bid with.
// CONTAINER_CHASSIS, the PICKUP_*T sizes and TRIPPER are retired from the
// picker (superseded by TRAILER_20FT/TRAILER_40FT and the curated lists
// below) but stay in the canonical list for backward compatibility with
// jobs already stored with those values — equipmentLabel() below still
// resolves them correctly wherever an old job is displayed.
export const EQUIPMENT_TYPES = [
  'CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET', 'LOWBED_TRAILER', 'FLATBED_TRAILER',
  'TRAILER_20FT', 'TRAILER_40FT', 'SIDE_LOADER_TRAILER',
  'BOX_TRUCK', 'CURTAIN_TRUCK', 'FLATBED_TRUCK', 'REEFER_TRUCK',
  'PICKUP_3T', 'PICKUP_5T', 'PICKUP_7T', 'PICKUP_10T', 'TRIPPER', 'CUSTOM',
];
// TRAILER_20FT/TRAILER_40FT are container-carrying (the chassis split by the
// length it's built for). TRAILER_WITH_GENSET carries a refrigerated
// shipping CONTAINER on a chassis — cold chain expressed via container
// size/type (REEFER) + this equipment, not a flag. REEFER_TRUCK is a
// standalone refrigerated truck body for non-containerized local delivery
// (produce, dairy, pharma between warehouses) — a genuinely different
// vehicle from TRAILER_WITH_GENSET, not container-carrying. CUSTOM is a
// written truck/requirement in the notes field.
export const CONTAINER_EQUIPMENT = ['CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET', 'TRAILER_20FT', 'TRAILER_40FT'];
export const EQUIPMENT_TYPE_LABELS = {
  CONTAINER_CHASSIS: 'Container chassis',
  TRAILER_WITH_GENSET: 'Trailer with genset',
  LOWBED_TRAILER: 'Lowbed trailer',
  FLATBED_TRAILER: 'Flatbed trailer',
  TRAILER_20FT: 'Trailer for 20FT container',
  TRAILER_40FT: 'Trailer for 40FT container',
  SIDE_LOADER_TRAILER: 'Side loader trailer',
  BOX_TRUCK: 'Box truck',
  CURTAIN_TRUCK: 'Curtain side',
  FLATBED_TRUCK: 'Flatbed truck',
  REEFER_TRUCK: 'Reefer truck',
  PICKUP_3T: 'Pickup — 3 tonne',
  PICKUP_5T: 'Pickup — 5 tonne',
  PICKUP_7T: 'Pickup — 7 tonne',
  PICKUP_10T: 'Pickup — 10 tonne',
  TRIPPER: 'Tripper',
  CUSTOM: 'Custom',
};
export function equipmentLabel(value) {
  return EQUIPMENT_TYPE_LABELS[value] || formatLabel(value);
}

// Vehicle class — a shipper picks this FIRST on the post-job form (trailer
// or truck), which narrows the equipment-type dropdown to just the
// relevant curated options for that class, instead of one flat list. Each
// list ends with CUSTOM (free-typed via form.customRequirement — see
// Dashboard.jsx) so neither class is ever a dead end.
export const VEHICLE_CLASSES = ['TRAILER', 'TRUCK'];
export const TRAILER_EQUIPMENT = ['LOWBED_TRAILER', 'FLATBED_TRAILER', 'TRAILER_WITH_GENSET', 'TRAILER_20FT', 'TRAILER_40FT', 'SIDE_LOADER_TRAILER', 'CUSTOM'];
export const TRUCK_EQUIPMENT = ['FLATBED_TRUCK', 'BOX_TRUCK', 'REEFER_TRUCK', 'CURTAIN_TRUCK', 'CUSTOM'];
export function vehicleClassOf(equipmentType) {
  return TRAILER_EQUIPMENT.includes(equipmentType) ? 'TRAILER' : 'TRUCK';
}
export function equipmentTypesForClass(vehicleClass) {
  return vehicleClass === 'TRAILER' ? TRAILER_EQUIPMENT : TRUCK_EQUIPMENT;
}

// What's inside the load, independent of the equipment moving it — shown
// next to equipment type on the job-post form and on job listings/details
// so a carrier can see e.g. hazmat or cold-chain cargo before bidding.
export const CARGO_TYPES = [
  'GENERAL_GOODS', 'ELECTRONICS', 'FOODSTUFF_PERISHABLES', 'PHARMACEUTICALS', 'MACHINERY_EQUIPMENT',
  'CHEMICALS_HAZMAT', 'TEXTILES_GARMENTS', 'AUTOMOTIVE_PARTS', 'CONSTRUCTION_MATERIALS',
  'FURNITURE_FIXTURES', 'OTHER',
];
export const CARGO_TYPE_LABELS = {
  GENERAL_GOODS: 'General goods',
  ELECTRONICS: 'Electronics',
  FOODSTUFF_PERISHABLES: 'Foodstuff / perishables',
  PHARMACEUTICALS: 'Pharmaceuticals',
  MACHINERY_EQUIPMENT: 'Machinery & equipment',
  CHEMICALS_HAZMAT: 'Chemicals / hazmat',
  TEXTILES_GARMENTS: 'Textiles & garments',
  AUTOMOTIVE_PARTS: 'Automotive parts',
  CONSTRUCTION_MATERIALS: 'Construction materials',
  FURNITURE_FIXTURES: 'Furniture & fixtures',
  OTHER: 'Other',
};
export function cargoTypeLabel(value) {
  return CARGO_TYPE_LABELS[value] || formatLabel(value);
}

export function formatLabel(value) {
  return value ? value.replaceAll('_', ' ') : '';
}

export function formatAED(amount) {
  if (amount === null || amount === undefined) return '—';
  return `AED ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

// A job's price columns are still literally named _aed (server never
// converts them — jobs.currency only drives which VAT rate applies,
// server/routes/currency.routes.js) but the shipper picks that currency
// specifically so "bids and payments will use this currency" (the
// selector's own copy) — carriers bid understanding the number is in
// that currency, not AED. Hardcoding "AED" on a job whose currency was
// set to something else was a real bug (found live on the one seeded
// cross-border job, priced in SAR but displayed as AED). This shows the
// job's actual currency code, defaulting to AED when unset — no value
// conversion, since none ever happened to the stored number either.
export function formatMoney(amount, currencyCode) {
  if (amount === null || amount === undefined) return '—';
  const code = (currencyCode || 'AED').toUpperCase();
  return `${code} ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const ANCILLARY_CHARGE_LABELS = { SALIK: 'Salik', ETOKEN: 'E-Token', DEMURRAGE: 'Demurrage/Waiting', INSPECTION_WAITING: 'Inspection waiting', OTHER: 'Other' };

export const CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BHD' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD' },
];

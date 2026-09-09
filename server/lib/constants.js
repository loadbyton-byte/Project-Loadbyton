const CONTAINER_SIZES = ['20FT', '40FT', '40HC', 'REEFER'];
const CONTAINER_TYPES = ['DRY', 'REEFER', 'HAZMAT', 'OPEN_TOP', 'FLAT_RACK'];
// DO/BOE/GATE_PASS/POD_TEMPLATE/INSPECTION_PROOF: the post-assignment
// document-exchange set. DO/BOE/POD_TEMPLATE-download are carrier-facing
// (delivery order, bill of entry, downloading the shipper's POD template);
// GATE_PASS and POD_TEMPLATE (the upload) are shipper-facing. All reuse
// the existing job_documents table and access pattern — see
// job-extras.routes.js's uploader/type checks.
const DOC_TYPES = ['CUSTOMS', 'RECEIPT', 'POD', 'LICENCE', 'INSURANCE', 'PACKING_LIST', 'OTHER', 'DO', 'BOE', 'GATE_PASS', 'POD_TEMPLATE', 'INSPECTION_PROOF'];

// Bumped by hand whenever web/src/pages/Terms.jsx's content materially
// changes — a user re-accepts only when this changes since their last
// recorded acceptance for that context, not on every job/signup.
const TERMS_VERSION = '2026-09-01';

const ANCILLARY_CHARGE_TYPES = ['SALIK', 'ETOKEN', 'DEMURRAGE', 'INSPECTION_WAITING', 'OTHER'];
const STATUS_ORDER = ['DRAFT', 'OPEN', 'AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

// When a shipper's payment is due — replaces the old SPOT_ESCROW/
// PAY_ON_DELIVERY/CONTRACT_CREDIT/OFF_PLATFORM tier concept. Escrow is an
// implementation detail now, not a shipper-facing choice: every term
// settles through the same platform-mediated mechanism (commission taken,
// carrier paid the net), whether the shipper pays by card or bank
// transfer — there is no more "off platform" tier that bypasses it.
// INSTANT keeps the old SPOT_ESCROW mechanics exactly (funds held at
// award, checkout required before pickup). The four NET_* terms keep the
// old CONTRACT_CREDIT mechanics exactly, generalized across more timing
// options — same credit-approval gate, same draw against
// credit_limit_aed/credit_balance_aed, same "payout at completion,
// shipper's own clock runs separately" behavior; only the due-date math
// changes, from a flat credit_terms_days to PAYMENT_TERM_DUE_HOURS below.
// jobs.payment_tier is the storage column — kept as-is (not renamed) to
// avoid an unnecessary migration; it now stores one of these five values.
const PAYMENT_TERMS = ['INSTANT', 'NET_24H', 'NET_7', 'NET_15', 'NET_28'];
const PAYMENT_TERM_DUE_HOURS = { INSTANT: 0, NET_24H: 24, NET_7: 24 * 7, NET_15: 24 * 15, NET_28: 24 * 28 };
// Which terms need the same admin-approved-credit gate CONTRACT_CREDIT
// used to have. INSTANT stays open to every shipper.
const DEFERRED_PAYMENT_TERMS = ['NET_24H', 'NET_7', 'NET_15', 'NET_28'];

// Real UAE geography, not a heuristic — every value in TERMINALS/AREAS sits
// unambiguously in one emirate, mirroring web/src/lib/constants.js's
// TERMINAL_INFO (which only covers terminals; this adds the delivery-area
// side so backload matching below can fall back to "same emirate" when a
// job has no map pin).
const TERMINAL_EMIRATE = {
  JEBEL_ALI_T1: 'Dubai', JEBEL_ALI_T2: 'Dubai', JEBEL_ALI_T4: 'Dubai',
  KHALIFA_PORT: 'Abu Dhabi', PORT_KHALID: 'Sharjah', FUJAIRAH_PORT: 'Fujairah',
};
const AREA_EMIRATE = {
  AL_QUOZ: 'Dubai', JAFZA_SOUTH: 'Dubai', DUBAI_SOUTH: 'Dubai', DIP: 'Dubai', AL_QUSAIS: 'Dubai',
  MUSAFFAH: 'Abu Dhabi', SHARJAH_INDUSTRIAL: 'Sharjah', FUJAIRAH_FREEZONE: 'Fujairah',
};

const MIN_PASSWORD_LENGTH = 8;

// Equipment/vehicle types a job can require and a carrier can bid with. The
// container-carrying types are the only ones where container_size/
// container_type mean anything — every other type is general UAE road
// freight (construction plant, palletised/boxed cargo, small-load pickups).
// CONTAINER_CHASSIS, PICKUP_3T/5T/7T/10T and TRIPPER are retired from the
// picker (see web/src/lib/constants.js's TRAILER_EQUIPMENT/TRUCK_EQUIPMENT)
// but stay here for backward compatibility with jobs already stored with
// those values. TRAILER_20FT/TRAILER_40FT are the container-chassis split
// by the length it's built for — real distinct physical equipment, not a
// cosmetic rename. REEFER_TRUCK is a standalone refrigerated truck body for
// non-containerized local reefer delivery (produce, dairy, pharma between
// warehouses) — genuinely distinct from TRAILER_WITH_GENSET, which powers a
// refrigerated shipping CONTAINER on a chassis (port drayage/cross-border).
// It replaces an OLD, unrelated "REEFER_TRUCK" that used to mean the same
// thing TRAILER_WITH_GENSET means now — that one really was retired
// product-wide (see product-gates.test.js's history) — this is a fresh,
// non-conflicting reuse of the name for the truck-class case. CUSTOM is the
// catch-all for anything the fixed list doesn't cover — it requires a
// written requirement (cargoDescription/notes).
const EQUIPMENT_TYPES = [
  'CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET', 'LOWBED_TRAILER', 'FLATBED_TRAILER',
  'TRAILER_20FT', 'TRAILER_40FT', 'SIDE_LOADER_TRAILER',
  'BOX_TRUCK', 'CURTAIN_TRUCK', 'FLATBED_TRUCK', 'REEFER_TRUCK',
  'PICKUP_3T', 'PICKUP_5T', 'PICKUP_7T', 'PICKUP_10T', 'TRIPPER', 'CUSTOM',
];
const CONTAINER_EQUIPMENT = ['CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET', 'TRAILER_20FT', 'TRAILER_40FT'];

// What's inside the load, independent of the equipment moving it — lets a
// carrier see e.g. HAZMAT or COLD_CHAIN cargo before bidding, regardless of
// which equipment type the job was posted with.
const CARGO_TYPES = [
  'GENERAL_GOODS', 'ELECTRONICS', 'FOODSTUFF_PERISHABLES', 'PHARMACEUTICALS', 'MACHINERY_EQUIPMENT',
  'CHEMICALS_HAZMAT', 'TEXTILES_GARMENTS', 'AUTOMOTIVE_PARTS', 'CONSTRUCTION_MATERIALS',
  'FURNITURE_FIXTURES', 'OTHER',
];

const SHIPMENT_TYPES = ['IMPORT', 'EXPORT', 'LOCAL'];
const DEPOTS = ['JAFZA_DEPOT', 'AL_QUSAIS_DEPOT', 'KHALIFA_DEPOT', 'SHARJAH_DEPOT', 'FUJAIRAH_DEPOT', 'DIP_DEPOT', 'MUSAFFAH_DEPOT'];

// Fixed category set — every notify() call site below is tagged with one
// of these, and a user can mute categories via
// PATCH /api/notifications/preferences (users.notification_prefs_disabled,
// a CSV of muted keys). 'system' is the untagged fallback and deliberately
// not mutable — account-level notices shouldn't be silenceable.
const NOTIFICATION_TYPES = ['bid', 'award', 'status', 'payout', 'dispute', 'verification', 'message'];

// DRIVER_ASSOCIATE: a pool driver who never bids and never sees the open
// marketplace — a carrier pushes a specific job as a trip offer they
// accept/decline over WhatsApp (see routes/whatsapp.routes.js). Distinct
// from DRIVER (a carrier's own directly-employed roster driver with a web
// login) — same restricted-seat mechanics, different acquisition model.
const SEAT_ROLES = ['OPS', 'FINANCE', 'VIEWER', 'DRIVER', 'DRIVER_ASSOCIATE'];

const BID_SORT_COLUMNS = {
  date_desc: 'b.created_at DESC',
  date_asc: 'b.created_at ASC',
  price_desc: 'b.amount_aed DESC',
  price_asc: 'b.amount_aed ASC',
};

// Priority placement (Change 30): a shipper pays a fee at posting to have
// their job sort ahead of others while boosted. This is the actual
// "boost" — without it, the fee charged at creation bought nothing (a
// real bug found in review: money moved, no effect). Prefixing every sort
// option with the boost condition means it applies regardless of which
// sort a carrier has picked, not just the default.
const PRIORITY_BOOST_ORDER = `CASE WHEN jobs.priority_boost_until IS NOT NULL AND jobs.priority_boost_until > datetime('now') THEN 0 ELSE 1 END`;
const JOB_SORT_COLUMNS = {
  date_desc: `${PRIORITY_BOOST_ORDER}, jobs.created_at DESC`,
  date_asc: `${PRIORITY_BOOST_ORDER}, jobs.created_at ASC`,
  price_desc: `${PRIORITY_BOOST_ORDER}, COALESCE(jobs.agreed_price_aed, jobs.max_budget_aed) DESC`,
  price_asc: `${PRIORITY_BOOST_ORDER}, COALESCE(jobs.agreed_price_aed, jobs.max_budget_aed) ASC`,
  deadline_asc: `${PRIORITY_BOOST_ORDER}, jobs.deadline ASC`,
  deadline_desc: `${PRIORITY_BOOST_ORDER}, jobs.deadline DESC`,
};

const ESCROW_STATUSES = ['PENDING', 'HELD', 'FUNDED', 'RELEASED', 'DISPUTED'];

const TRANSITIONS = {
  SHIPPER: { OPEN: ['CANCELLED'], DRAFT: ['CANCELLED'], AWARDED: ['CANCELLED'], DELIVERED: ['COMPLETED'] },
  CARRIER: { AWARDED: ['PICKED_UP', 'CANCELLED'], PICKED_UP: ['IN_TRANSIT'], IN_TRANSIT: ['DELIVERED'] },
};

// transition table — i.e. whatever was requested was "allowed" by
// definition, making the guard vacuous (any job could jump straight to
// COMPLETED, which releases escrow). Admin now gets exactly what a
// legitimate SHIPPER or CARRIER could have done on this job — real power to
// unstick a job or force a status a party is refusing to set, without a
// blank check to any status from any status.
const ADMIN_TRANSITIONS = {};
for (const roleMap of [TRANSITIONS.SHIPPER, TRANSITIONS.CARRIER]) {
  for (const [from, tos] of Object.entries(roleMap)) {
    ADMIN_TRANSITIONS[from] = [...new Set([...(ADMIN_TRANSITIONS[from] || []), ...tos])];
  }
}
TRANSITIONS.ADMIN = ADMIN_TRANSITIONS;

const DISPUTABLE_STATUSES = ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

const BACKLOAD_ELIGIBLE_STATUSES = ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
const BACKLOAD_MAX_DISTANCE_KM = 100;

module.exports = {
  CONTAINER_SIZES: ['20FT', '40FT', '40HC', 'REEFER'],
  CONTAINER_TYPES: ['DRY', 'REEFER', 'HAZMAT', 'OPEN_TOP', 'FLAT_RACK'],
  DOC_TYPES,
  STATUS_ORDER: ['DRAFT', 'OPEN', 'AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'],
  TERMINAL_EMIRATE, AREA_EMIRATE, MIN_PASSWORD_LENGTH,
  EQUIPMENT_TYPES, CONTAINER_EQUIPMENT, CARGO_TYPES, SHIPMENT_TYPES, DEPOTS,
  NOTIFICATION_TYPES, SEAT_ROLES,
  BID_SORT_COLUMNS, JOB_SORT_COLUMNS, ESCROW_STATUSES,
  TRANSITIONS, DISPUTABLE_STATUSES,
  BACKLOAD_ELIGIBLE_STATUSES, BACKLOAD_MAX_DISTANCE_KM,
  TERMS_VERSION, ANCILLARY_CHARGE_TYPES,
  PAYMENT_TERMS, PAYMENT_TERM_DUE_HOURS, DEFERRED_PAYMENT_TERMS,
};

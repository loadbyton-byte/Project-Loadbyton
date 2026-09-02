const CONTAINER_SIZES = ['20FT', '40FT', '40HC', 'REEFER'];
const CONTAINER_TYPES = ['DRY', 'REEFER', 'HAZMAT', 'OPEN_TOP', 'FLAT_RACK'];
const DOC_TYPES = ['CUSTOMS', 'RECEIPT', 'POD', 'LICENCE', 'INSURANCE', 'PACKING_LIST', 'OTHER'];
const STATUS_ORDER = ['DRAFT', 'OPEN', 'AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

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
// REEFER_TRUCK was replaced product-wide by TRAILER_WITH_GENSET (a chassis
// with an attached genset powers a reefer container on a standard trailer);
// CUSTOM is the catch-all for anything the fixed list doesn't cover — it
// requires a written requirement (cargoDescription/notes).
const EQUIPMENT_TYPES = [
  'CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET', 'LOWBED_TRAILER', 'FLATBED_TRAILER', 'BOX_TRUCK',
  'CURTAIN_TRUCK', 'PICKUP_3T', 'PICKUP_5T', 'PICKUP_7T', 'PICKUP_10T',
  'SIDE_LOADER_TRAILER', 'TRIPPER', 'CUSTOM',
];
const CONTAINER_EQUIPMENT = ['CONTAINER_CHASSIS', 'TRAILER_WITH_GENSET'];

// What's inside the load, independent of the equipment moving it — lets a
// carrier see e.g. HAZMAT or COLD_CHAIN cargo before bidding, regardless of
// which equipment type the job was posted with.
const CARGO_TYPES = [
  'GENERAL_GOODS', 'ELECTRONICS', 'FOODSTUFF_PERISHABLES', 'MACHINERY_EQUIPMENT',
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

const SEAT_ROLES = ['OPS', 'FINANCE', 'VIEWER'];

const BID_SORT_COLUMNS = {
  date_desc: 'b.created_at DESC',
  date_asc: 'b.created_at ASC',
  price_desc: 'b.amount_aed DESC',
  price_asc: 'b.amount_aed ASC',
};

const JOB_SORT_COLUMNS = {
  date_desc: 'jobs.created_at DESC',
  date_asc: 'jobs.created_at ASC',
  price_desc: 'COALESCE(jobs.agreed_price_aed, jobs.max_budget_aed) DESC',
  price_asc: 'COALESCE(jobs.agreed_price_aed, jobs.max_budget_aed) ASC',
  deadline_asc: 'jobs.deadline ASC',
  deadline_desc: 'jobs.deadline DESC',
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
};

// Shared constants for the ecosystem layer (master plan §3, §9).
//
// STORE_SECTORS and STORE_PLAN_LIMITS mirror Loadbyton-OS src/platform/catalog.ts.
// They are display/validation copies: the Store enforces its own limits, and
// the grant event only carries a plan code, never a number. tests assert the
// sector count so a catalogue change there is noticed here.

'use strict';

const STORE_SECTORS = [
  'freight-forwarding', 'customs-brokerage', 'road-transport', 'contract-warehouse-3pl',
  'courier-last-mile', 'ecommerce-fulfilment', 'consolidation-nvocc', 'cold-chain',
  'project-heavy-cargo', 'automotive-logistics', 'marine-agency', 'aviation-logistics',
  'moving-relocation', 'import-export-trading', 'distribution', 'container-depot',
  'dangerous-cargo', 'cross-border-transit',
];

const PLAN_STARTER_INCLUDED = 'starter_included';
const PLAN_ENTERPRISE_INCLUDED = 'enterprise_included';

// Plan ceilings from the Store catalogue (hypotheses, not guaranteed
// provider-funded consumption). Never advertise "unlimited".
const STORE_PLAN_LIMITS = {
  [PLAN_STARTER_INCLUDED]: {
    max_users: 3, max_branches: 1, max_sectors: 1, max_entities: 1, storage_mb: 2048,
    jobs_per_month: 150, trips_per_month: 150, fulfilment_orders_per_month: 500, wh_orders_per_month: 150,
    parcels_per_month: 1500, cus_cases_per_month: 50, specialist_cases_per_month: 10,
    messages_per_month: 100, ai_drafts_per_month: 50,
  },
  [PLAN_ENTERPRISE_INCLUDED]: {
    max_users: 100, max_branches: 20, max_sectors: 18, max_entities: 5, storage_mb: 204800,
    jobs_per_month: 20000, trips_per_month: 20000, fulfilment_orders_per_month: 100000, wh_orders_per_month: 20000,
    parcels_per_month: 500000, cus_cases_per_month: 6000, specialist_cases_per_month: 500,
    messages_per_month: 10000, ai_drafts_per_month: 2000,
  },
};

const EVENT_ENTITLEMENT_UPDATED = 'entitlement.updated';
const PRODUCT_STORE = 'store';

// Proposed in the master plan (§3 step 5); overridable until the commercial
// terms are signed off.
const GRACE_DAYS = Math.max(0, Number(process.env.ECOSYSTEM_GRACE_DAYS ?? 14));

const TERMS_VERSION = process.env.ECOSYSTEM_TERMS_VERSION || 'store-activation-draft-2026-10';

const DELIVERY_MAX_ATTEMPTS = 12;

module.exports = {
  STORE_SECTORS, PLAN_STARTER_INCLUDED, PLAN_ENTERPRISE_INCLUDED, STORE_PLAN_LIMITS,
  EVENT_ENTITLEMENT_UPDATED, PRODUCT_STORE, GRACE_DAYS, TERMS_VERSION, DELIVERY_MAX_ATTEMPTS,
};

// The Store's eighteen logistics sectors (slug → display name), mirrored from
// Loadbyton-OS src/platform/catalog.ts and server/lib/ecosystem/constants.js.
export const STORE_SECTORS = [
  ['freight-forwarding', 'Freight forwarding'], ['customs-brokerage', 'Customs brokerage'], ['road-transport', 'Road transport'],
  ['contract-warehouse-3pl', 'Contract warehouse / 3PL'], ['courier-last-mile', 'Courier / last mile'], ['ecommerce-fulfilment', 'E-commerce fulfilment'],
  ['consolidation-nvocc', 'Consolidation / NVOCC'], ['cold-chain', 'Cold chain'], ['project-heavy-cargo', 'Project / heavy cargo'],
  ['automotive-logistics', 'Automotive logistics'], ['marine-agency', 'Marine agency'], ['aviation-logistics', 'Aviation logistics'],
  ['moving-relocation', 'Moving / relocation'], ['import-export-trading', 'Import / export trading'], ['distribution', 'Distribution'],
  ['container-depot', 'Container depot / yard'], ['dangerous-cargo', 'Dangerous / regulated cargo'], ['cross-border-transit', 'Cross-border / transit'],
];
export const sectorName = (slug) => (STORE_SECTORS.find(([s]) => s === slug) || [null, slug])[1];

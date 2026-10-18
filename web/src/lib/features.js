// Build-time switch for the interface.
//   VITE_BRAND_V2=false  use the legacy wordmark instead of the shared outlined SVG masters

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const brandV2 = env.VITE_BRAND_V2 !== 'false';

// Build-time switches for the ecosystem surfaces. Both default to ON: the owner
// approved the premium price, the red BY logo and the Business OS scope on
// 18 Oct 2026 (master plan v1.1). Set either to 'false' to build without it.
//
//   VITE_ECOSYSTEM_UI=false  hide the ecosystem menu, six-domain footer,
//                            Business OS pages and benefits/organisation screens
//   VITE_BRAND_V2=false      use the legacy wordmark instead of the shared
//                            outlined SVG masters
//
// The server enforces everything that matters (entitlements, eligibility);
// these flags only decide what the interface shows.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const ecosystemUi = env.VITE_ECOSYSTEM_UI !== 'false';
export const brandV2 = env.VITE_BRAND_V2 !== 'false';

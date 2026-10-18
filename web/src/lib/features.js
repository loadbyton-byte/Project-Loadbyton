// Build-time switches for the ecosystem surfaces. Both default to OFF so the
// marketplace ships unchanged until the owner has approved the public promises
// they make (master plan §13: premium price, logo variant, Business OS scope).
//
//   VITE_ECOSYSTEM_UI=true   ecosystem menu, six-domain footer, Business OS
//                            pages and the benefits/organisation screens
//   VITE_BRAND_V2=true       outlined SVG wordmark from the shared brand kit
//
// The server enforces everything that matters (entitlements, eligibility);
// these flags only decide what the interface shows.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const ecosystemUi = env.VITE_ECOSYSTEM_UI === 'true';
export const brandV2 = env.VITE_BRAND_V2 === 'true';

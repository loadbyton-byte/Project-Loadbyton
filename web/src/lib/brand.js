// Single source of truth for the Loadbyton logo files (generated from the
// brand pack by scripts/generate-brand-assets.py — masters live in
// docs/brand/logo/). Use <BrandWordmark /> rather than hard-coding these.
//
// Both wordmarks are PNGs on purpose: the SVGs in the brand pack draw the
// letters with live <text>, and an SVG loaded through <img> cannot use web
// fonts, so each OS would render different letterforms (and the "BY" in the
// middle of the old SVG came out invisible on navy).
export const LOGO_FOR_DARK_BG = '/brand/logo-wordmark-dark-bg.png'; // white letters, transparent
export const LOGO_FOR_LIGHT_BG = '/brand/logo-wordmark-light-bg.png'; // navy letters, transparent
export const LOGO_ICON = '/brand/logo-icon.png'; // container app icon, 512x512
// Intrinsic size of both wordmark PNGs — set on <img> so layout doesn't shift while it loads.
export const LOGO_WORDMARK_SIZE = { width: 1200, height: 202 };

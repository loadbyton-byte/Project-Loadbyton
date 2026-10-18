import React from 'react';
import { useLocation } from 'react-router-dom';
import { LOGO_FOR_DARK_BG, LOGO_FOR_LIGHT_BG, LOGO_WORDMARK_SIZE } from '../lib/brand.js';
import { brandV2 } from '../lib/features.js';

// The one place the Loadbyton wordmark is rendered. `dark` = the surface behind
// it is dark (sidebar, footer, auth panel) so the white-lettered version is used.
//
// VITE_BRAND_V2=true switches to the outlined SVG masters from the shared brand
// kit (public/brand/v2/masters): the letters are paths, so every device draws
// identical letterforms and no web font is involved. It stays off until the
// owner approves the master (see docs/brand/ECOSYSTEM_BRAND.md).
const V2_FOR_DARK_BG = '/brand/v2/masters/logo-parent-white.svg';
const V2_FOR_LIGHT_BG = '/brand/v2/masters/logo-parent-navy.svg';
const V2_SIZE = { width: 450, height: 112 };

export default function BrandWordmark({ dark = false, className = '' }) {
  // The home page keeps the original wordmark (owner request, 18 Oct 2026).
  const useV2 = brandV2 && useLocation().pathname !== '/';
  const size = useV2 ? V2_SIZE : LOGO_WORDMARK_SIZE;
  const src = useV2 ? (dark ? V2_FOR_DARK_BG : V2_FOR_LIGHT_BG) : (dark ? LOGO_FOR_DARK_BG : LOGO_FOR_LIGHT_BG);
  return (
    <img
      src={src}
      alt="Loadbyton"
      width={size.width}
      height={size.height}
      className={className}
      decoding="async"
    />
  );
}
